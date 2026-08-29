// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/work-sources.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/work-sources.ts
// clade flow spine — reconciling docs/tech-debt.md against the WORK queue (TD-787)
//
// `decision-sync.ts` reconciles the same files against the DECISION queue: what is Charles waiting
// to answer. This is the other half: what pieces of work exist, and which of them are finished.
//
// The problem it removes. Work items were minted by ACTIONS — `wt-helper add` opening a worktree,
// `herdr-session-handoff` dispatching a pane — never by the work itself. Measured 2026-08-29 in
// clade: 173 TD entries, ONE work item carrying a `td:` origin; 42 named work items of which 1 was
// `done`. So "is this thing fixed?" had no answer anywhere on the spine, which is the question the
// register has been answering in prose the whole time.
//
// Three transitions, and only three:
//
//   actionable-open in the register, no card    → open one, origin `td:TD-NNN`
//   card exists, register says it closed        → work.done, verification read out of the entry
//   entry states `**Parent**: TD-NNN`           → work.link under that entry's card
//
// WHAT IT DELIBERATELY DOES NOT DO. A closed TD with no card does NOT get one minted and closed in
// the same breath: the spine is event-sourced and back-filling history is writing a past that did
// not happen. Charles ruled on this directly — only actionable-open entries are back-filled, and
// the 500+ already rotated into docs/archives stay out. A card whose TD later leaves the live
// register is REPORTED, never touched: rotation means closure, and closure is the one thing this
// module must not invent.
//
// IDENTITY IS `origin_ref`, NOT THE WORK ID. `mintWorkId` stamps today's date into the id, so
// keying on the id would mint a second card for the same TD on the second day. `buildWorkItems`
// already flattens `origin_ref` onto every row, first-origin-wins.
//
// Propagation constraint: `vendor/scripts/flow/` is copied wholesale to every consumer, so this
// file may import ONLY `node:*` and siblings in this directory.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { linkWork, markWorkDone, openWork, readEvents } from './emit.ts'
import { parseTdRegister, type TdEntry } from './nodes/lib/td-parse.ts'
import { buildWorkItems, foldSpans, type WorkItem } from './spine.ts'

const REGISTER = join('docs', 'tech-debt.md')

/** States that mean the card is already closed. Re-closing one would restate a claim as new. */
const CLOSED_STATES = new Set(['done', 'accepted', 'dropped'])

export interface WorkSyncAction {
  type: 'open' | 'done' | 'link'
  td: string
  work_id: string | null
  title: string
  /** For `done`, the verification line. For `link`, the parent TD id. */
  detail: string | null
  /**
   * A `done` whose only evidence is the register saying so.
   *
   * Counted separately because thin and thick evidence are indistinguishable once both are just a
   * string on a `work.done`, and `work.accept` is supposed to rest on the verification.
   */
  thin_evidence?: boolean
}

export interface WorkSyncResult {
  repo: string
  /** TD entries the parser could read. */
  scanned: number
  /** Of those, `isOpen && !isParked` — the back-fill population. */
  actionable: number
  /** Cards already carrying a `td:` origin before this run. */
  tracked: number
  actions: WorkSyncAction[]
  /**
   * Opens/closes reported by the emitter that are NOT on the spine afterwards.
   *
   * `openWork` returns an id whether or not `validateFlowEvent` accepted the envelope — the emit
   * library is fail-open and swallows. Trusting the return value would make a run that writes
   * nothing look identical to a run that worked, forever. Verified against the file instead.
   */
  unwritten: string[]
  thin_evidence: number
  /** Cards with a `td:` origin whose entry is no longer in the live register. Reported, not touched. */
  vanished: string[]
  /**
   * `**Parent**: TD-NNN` naming an entry that has no card — closed, parked, archived, or a typo.
   *
   * Counted rather than filed as an action. There is no work id to link TO, so an action here
   * could never be written, and a run that reports the same unwritable action forever is a queue
   * that stops being read. `flow link` tolerates a DANGLING id because a cross-repo parent still
   * names something; a TD with no card names nothing on this spine.
   */
  unresolved_parents: string[]
  skipped: string | null
}

function emptyResult(repo: string): WorkSyncResult {
  return {
    repo,
    scanned: 0,
    actionable: 0,
    tracked: 0,
    actions: [],
    unwritten: [],
    thin_evidence: 0,
    vanished: [],
    unresolved_parents: [],
    skipped: null,
  }
}

/** `TD-787` → `td-787`. Deterministic, and the id it mints reads as the thing it names. */
function slugOf(id: string): string {
  return id.toLowerCase()
}

function originOf(id: string): string {
  return `td:${id}`
}

/**
 * One line of evidence out of the entry, or null.
 *
 * Order matters: an explicit `**驗收**` / `**Acceptance**` predicate is a statement of what would
 * prove the fix; a `### 自驗` block is the commands someone ran. The predicate is the better line
 * to put in front of a human deciding whether to accept, so it wins when both are present.
 */
export function evidenceLine(entry: TdEntry): string | null {
  const lines = entry.text.split('\n')
  for (const line of lines) {
    if (/\*\*(驗收|Acceptance|Unblock predicate|解凍 predicate)\*\*\s*[:：]/i.test(line)) {
      return compact(line)
    }
  }
  const at = lines.findIndex((l) => /^#{2,6}\s*自驗/.test(l))
  if (at >= 0) {
    for (const line of lines.slice(at + 1)) {
      // Fences and blanks are the block's packaging, not its content. A `## ` line means the 自驗
      // section was empty and the next entry already started.
      if (!line.trim() || line.startsWith('```') || /^#{1,2}\s/.test(line)) continue
      return compact(line)
    }
  }
  return null
}

function compact(line: string): string {
  return line
    .replace(/^[-*+]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/**
 * The verification a `work.done` carries when the register closed an entry that has no evidence
 * carrier of its own.
 *
 * NOT a fabricated verification, and the distinction is the whole reason this is a named function:
 * it states exactly what the evidence is (a register status) and that the entry carried nothing
 * else. `work.done` is the one fail-closed write on this stream precisely so an unverifiable claim
 * cannot pass as a verified one — a line that says "no self-check section" passes that bar by
 * being true, where a line quoting the status as though it were a check would not.
 */
export function thinVerification(entry: TdEntry): string {
  return `${REGISTER}#${entry.id} 標記為 ${entry.status || '（無 Status 行）'}；該條無自驗段`
}

export function syncWork({
  repoRoot,
  dryRun = false,
  actor = 'work-source-scan',
}: {
  repoRoot: string
  dryRun?: boolean
  actor?: string
}): WorkSyncResult {
  const result = emptyResult(repoRoot)

  /*
   * Same refusal `syncDecisions` makes, for a reason specific to this half: `origin_ref` is
   * `td:TD-NNN` with no repo qualifier, because each repo keeps its own spine. Point every repo's
   * spine at one file and clade's TD-787 and a consumer's TD-787 become the same card — the second
   * repo's entry would read as already tracked and never get one.
   */
  if (process.env.CLADE_FLOW_EVENTS && !process.env.CLADE_FLOW_SYNC_ALLOW_OVERRIDE) {
    result.skipped =
      'CLADE_FLOW_EVENTS 把所有 repo 的 spine 指向同一個檔，td: origin 會跨 repo 撞號'
    return result
  }

  const registerPath = join(repoRoot, REGISTER)
  if (!existsSync(registerPath)) {
    result.skipped = `no ${REGISTER}`
    return result
  }

  const entries = parseTdRegister(readFileSync(registerPath, 'utf8'))
  result.scanned = entries.length

  const cards = buildWorkItems(foldSpans(readEvents(repoRoot) as never))
  const byOrigin = new Map<string, WorkItem>()
  for (const card of cards) {
    if (card.origin_ref) byOrigin.set(card.origin_ref, card)
  }
  result.tracked = [...byOrigin.keys()].filter((o) => o.startsWith('td:')).length

  const liveIds = new Set(entries.map((e) => e.id))
  result.vanished = [...byOrigin.keys()]
    .filter((o) => o.startsWith('td:') && !liveIds.has(o.slice(3)))
    .toSorted()

  /** Ids minted in THIS run, so a `**Parent**` on a freshly opened entry still resolves. */
  const mintedNow = new Map<string, string>()
  const workIdFor = (id: string): string | null =>
    mintedNow.get(id) ?? byOrigin.get(originOf(id))?.work_id ?? null

  for (const entry of entries) {
    const actionable = entry.isOpen && !entry.isParked
    if (actionable) result.actionable += 1
    const existing = byOrigin.get(originOf(entry.id))

    if (actionable && !existing) {
      const action: WorkSyncAction = {
        type: 'open',
        td: entry.id,
        work_id: null,
        title: entry.title,
        detail: null,
      }
      if (!dryRun) {
        const { work_id } = openWork({
          slug: slugOf(entry.id),
          actor,
          origin: originOf(entry.id),
          title: entry.title,
          substrate: 'file-scan',
          cwd: repoRoot,
        })
        action.work_id = work_id
        mintedNow.set(entry.id, work_id)
      }
      result.actions.push(action)
    }

    // Closed in the register, and a card exists that has not been closed on the spine. A parked
    // entry is NOT closed — `wontfix-until-signal` is waiting, which is the state `settled`
    // already expresses honestly.
    if (!actionable && !entry.isParked && existing && !CLOSED_STATES.has(existing.state)) {
      const evidence = evidenceLine(entry)
      const verification = evidence ?? thinVerification(entry)
      if (!evidence) result.thin_evidence += 1
      const action: WorkSyncAction = {
        type: 'done',
        td: entry.id,
        work_id: existing.work_id,
        title: entry.title,
        detail: verification,
        thin_evidence: !evidence,
      }
      if (!dryRun) {
        markWorkDone({
          work_id: existing.work_id,
          verification,
          verifiedBy: 'tech-debt-register',
          actor,
          substrate: 'file-scan',
          cwd: repoRoot,
        })
      }
      result.actions.push(action)
    }

    if (entry.parent) {
      const child = workIdFor(entry.id)
      const parent = workIdFor(entry.parent)
      // Only file an edge whose CHILD exists — `flow link` refuses an unknown child for the same
      // reason. A missing PARENT is filed anyway and warned about, which is the semantics `flow
      // link` already holds: on a 12-repo fleet an unresolvable parent is normal, not a defect.
      if (child && !parent) {
        // The parent entry exists in prose but carries no card. Say so once per run; NEVER file an
        // action that can never be written.
        result.unresolved_parents.push(`${entry.id}→${entry.parent}`)
      } else if (child && parent !== child) {
        const already = byOrigin.get(originOf(entry.id))?.parent_work_id
        if (already !== parent) {
          const action: WorkSyncAction = {
            type: 'link',
            td: entry.id,
            work_id: child,
            title: entry.title,
            detail: entry.parent,
          }
          if (!dryRun) {
            /*
             * `linkWork`'s own header says NEVER emit this from a hook or any automatic path. This
             * path is inside its stated exception: the assertion is `**Parent**: TD-NNN`, which a
             * person typed into the register on purpose, and nothing here infers an edge from
             * prose. The scan transcribes a human's claim; it does not make one. It also only ever
             * writes under `--apply`.
             */
            linkWork({
              work_id: child,
              parent_work_id: parent,
              reason: `${REGISTER}#${entry.id} **Parent**: ${entry.parent}`,
              actor,
              substrate: 'file-scan',
              cwd: repoRoot,
            })
          }
          result.actions.push(action)
        }
      }
    }
  }

  if (!dryRun && result.actions.length > 0) {
    // Verified against the file, not against the return values — see `unwritten`.
    const after = buildWorkItems(foldSpans(readEvents(repoRoot) as never))
    const seen = new Map(after.map((c) => [c.work_id, c]))
    for (const action of result.actions) {
      const card = action.work_id ? seen.get(action.work_id) : null
      const landed =
        action.type === 'open'
          ? card?.origin_ref === originOf(action.td)
          : action.type === 'done'
            ? card?.done_ts !== null && card?.done_ts !== undefined
            : card?.parent_work_id !== null && card?.parent_work_id !== undefined
      if (!landed) result.unwritten.push(`${action.type}:${action.td}`)
    }
  }

  return result
}

export function syncWorkFleet({
  roots,
  dryRun = false,
}: {
  roots: string[]
  dryRun?: boolean
}): WorkSyncResult[] {
  return roots.map((root) => {
    try {
      return syncWork({ repoRoot: root, dryRun })
    } catch (error) {
      // Named, never silently dropped — same rule `fleet.ts` and `syncFleet` hold.
      const failed = emptyResult(root)
      failed.skipped = error instanceof Error ? error.message : String(error)
      return failed
    }
  })
}
