// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/coordination.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/coordination.ts
/**
 * coordination.ts — the on-disk contract for the release pipeline's holder, phase and receipt.
 *
 * ## Why this exists
 *
 * `clade-role-and-todo-discipline.md § Commit 前 MUST 先確認沒有任何 publish 在飛` had to tell
 * every reader to run `pgrep`, and then spend three paragraphs explaining that `pgrep` answers a
 * different question than the one being asked. Measured 2026-08-29: a single publish run has
 * **three** distinct windows where both processes are absent — queued (nothing spawned yet),
 * handing over (`publish.ts` exited, `propagate.ts` not started), and genuinely finished. A process
 * probe returns 0 in all three, and the tag is new in two of them.
 *
 * The discriminator the prose landed on is a PAIR: `tag 已建` ＋ **the lane that ran it saying
 * propagate finished**. This file is the machine-readable half of that sentence — the lane says it
 * by appending to a journal instead of by broadcasting into a pane that may not be watched.
 *
 * ## Shape of the contract
 *
 * One append-only JSONL journal per repo, `.clade/coordination/journal.jsonl`. Writers are
 * `scripts/lib/coordination-holder.ts` only (plan section 4.2: the flow controller owns
 * coordination lock, holder, phase and completion receipt). This module READS it, and folds it into
 * one row per resource so `stall.ts` can stay a pure function of its arguments.
 *
 * `.clade/` is gitignored on purpose: a receipt is a fact about this machine's run, not about the
 * repo's content. Committing them would make every publish dirty the tree it is about to publish.
 *
 * ## READ-ONLY
 *
 * Nothing here writes. The fold is derived; persisting a derived verdict is where drift starts
 * (same rule as `who.ts` / `serve.ts`).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Journal path relative to the repo root. Single source for reader and writer. */
export const COORDINATION_JOURNAL_PATH = '.clade/coordination/journal.jsonl'

export function coordinationJournalPath(root: string): string {
  return join(root, COORDINATION_JOURNAL_PATH)
}

/**
 * The one resource publish and propagate contend for.
 *
 * They share a single lock file by design (`scripts/lib/publish-lock.ts`: one path so that either
 * one excludes the other), so they are ONE resource with two operations — NEVER two resources.
 * Two names over one lock would read as mutual exclusion and provide none.
 */
export const RELEASE_PIPELINE_RESOURCE = 'release-pipeline'

/**
 * The pipeline's phase ladder, in order.
 *
 * A phase is recorded by whoever performs it: `publish.ts` writes `gate` → `bump` → `tag`,
 * `propagate.ts` writes `propagate` → `done`. `push` sits between them and is performed by neither
 * script (publish prints `下一步：git push && git push --tags`), so a publish receipt names it as
 * the phase it is `awaiting` rather than one it reached. That gap IS the handover window this file
 * exists to make visible — collapsing it by having a script claim a phase it did not perform would
 * delete the only evidence that distinguishes 換手 from 中止.
 */
export const PIPELINE_PHASES = ['gate', 'bump', 'tag', 'push', 'propagate', 'done'] as const
export type PipelinePhase = (typeof PIPELINE_PHASES)[number]

/** Herdr location of a holder (section 3: pane/session identity, never a title or a slug). */
export interface HolderIdentity {
  pane: string | null
  tab?: string | null
  workspace?: string | null
  session?: string | null
}

export type CoordinationKind = 'claim' | 'phase' | 'receipt' | 'notification' | 'evidence-lookup'

/**
 * Terminal outcome of one holder's run.
 *
 * `handoff` = finished its half, another half remains — the ONLY outcome that leaves the pipeline
 * owing something, and therefore the only one `foldCoordination` turns into a non-settled row.
 *
 * `dropped` closes an open handoff deliberately: the owed phase will not be performed, and the
 * reason is on the record. It is a separate value from `aborted` on purpose — `aborted` says a run
 * died mid-way (the debt still stands), `dropped` says a human looked at the debt and cancelled it.
 * Collapsing them would make "nobody will finish this" indistinguishable from "nobody finished it",
 * which is the distinction the whole handover window exists to expose.
 *
 * That distinction is only real if the FOLD keeps it. `aborted` therefore folds to its own
 * non-settled state, not to `settled`: an interrupted publish leaves a repo whose tag, version
 * files and consumers may disagree, and settling it would make the one outcome that always needs a
 * human decision the one outcome that produces no row. `done` and `failed` do settle — `failed`
 * says the run reached a verdict and stopped, and a verdict owes nothing.
 */
export type ReceiptOutcome = 'done' | 'handoff' | 'aborted' | 'failed' | 'dropped'

export interface CoordinationEntry {
  ts: string
  kind: CoordinationKind
  resource: string
  operation: string | null
  phase: string | null
  outcome?: ReceiptOutcome | null
  /** Receipt only: the phase this receipt hands the pipeline over to. */
  awaiting?: string | null
  identity?: HolderIdentity | null
  pid?: number | null
  host?: string | null
  detail?: Record<string, unknown>
}

/**
 * One resource, folded.
 *
 * `state` is the question the prose could not answer with a process probe:
 *   - `in-flight`  — a holder claimed it and no receipt followed. `phase` says how far it got.
 *   - `handoff`    — a receipt closed one half and named the half still owed (`awaiting`).
 *   - `aborted`    — a receipt says the run died mid-way. Nothing names what is owed, because the
 *                    run never got to decide; that is exactly why it is not `settled`.
 *   - `settled`    — a receipt closed it with nothing owed. A `dropped` receipt lands here too: the
 *                    debt was cancelled on the record, so it is settled even though the owed phase
 *                    never ran. `failed` lands here as well: a run that reached a verdict and
 *                    stopped owes nothing.
 * Absent journal / absent resource yields no row at all, which is NOT `settled`: never having run
 * and having finished are different facts and must not share a value.
 */
export interface PipelineRow {
  resource: string
  operation: string | null
  phase: string | null
  identity: HolderIdentity | null
  state: 'in-flight' | 'handoff' | 'aborted' | 'settled'
  awaiting: string | null
  /** Timestamp of the fact that makes this row's age meaningful (last transition or the receipt). */
  since: string
  outcome: ReceiptOutcome | null
}

function isEntry(value: unknown): value is CoordinationEntry {
  if (typeof value !== 'object' || value === null) return false
  const held = value as Record<string, unknown>
  return (
    typeof held.ts === 'string' &&
    typeof held.kind === 'string' &&
    typeof held.resource === 'string'
  )
}

/**
 * Read the journal. Malformed lines are skipped, an absent file is an empty list.
 *
 * Fail-open and quiet, for the same reason `findRuntimeLeaseStalls` is: a stall query that throws
 * on an unreadable journal reports "nothing is stalled", which is the one answer it must never
 * invent. A repo that has never published has no journal, and that is the normal case.
 */
export function readCoordinationJournal(root: string): CoordinationEntry[] {
  const path = coordinationJournalPath(root)
  if (!existsSync(path)) return []
  let body = ''
  try {
    body = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const entries: CoordinationEntry[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isEntry(parsed)) entries.push(parsed)
    } catch {
      // A truncated last line is what a killed writer leaves. Skipping it loses one fact; throwing
      // loses every fact in the file, including the stall this query was opened to find.
    }
  }
  return entries
}

/**
 * Fold the journal into one row per resource.
 *
 * Only `claim`, `phase` and `receipt` move the state machine. `notification` and `evidence-lookup`
 * are the audit trail of how a conflict was delivered — they are facts ABOUT a claim, and letting
 * them advance the state would make "we told someone" indistinguishable from "someone started".
 */
export function foldCoordination(entries: CoordinationEntry[]): PipelineRow[] {
  const rows = new Map<string, PipelineRow>()
  for (const entry of entries) {
    if (entry.kind === 'claim') {
      rows.set(entry.resource, {
        resource: entry.resource,
        operation: entry.operation ?? null,
        phase: entry.phase ?? null,
        identity: entry.identity ?? null,
        state: 'in-flight',
        awaiting: null,
        since: entry.ts,
        outcome: null,
      })
      continue
    }
    const row = rows.get(entry.resource)
    if (!row) continue // a phase or receipt with no claim before it: nothing to advance
    if (entry.kind === 'phase') {
      row.phase = entry.phase ?? row.phase
      row.since = entry.ts
      row.state = 'in-flight'
      row.awaiting = null
      row.outcome = null
      continue
    }
    if (entry.kind === 'receipt') {
      row.phase = entry.phase ?? row.phase
      row.since = entry.ts
      row.outcome = entry.outcome ?? null
      row.awaiting = entry.awaiting ?? null
      // Three-way, NEVER two-way: `aborted` is the outcome a killed run leaves behind, and folding
      // it with `done` would let SIGTERM produce the same row as a clean finish.
      row.state =
        entry.outcome === 'handoff'
          ? 'handoff'
          : entry.outcome === 'aborted'
            ? 'aborted'
            : 'settled'
    }
  }
  return [...rows.values()]
}

/** The last receipt recorded for a resource, or null. Powers `holderReceipt`. */
export function lastReceipt(
  entries: CoordinationEntry[],
  resource: string,
): CoordinationEntry | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.kind === 'receipt' && entry.resource === resource) return entry
  }
  return null
}

/** Every notification attempt recorded for a resource, oldest first. Powers the fallback audit. */
export function notificationsFor(
  entries: CoordinationEntry[],
  resource: string,
): CoordinationEntry[] {
  return entries.filter((e) => e.kind === 'notification' && e.resource === resource)
}

/** Read + fold in one call — what `flow status --stalled` wants. */
export function readPipelineRows(root: string): PipelineRow[] {
  return foldCoordination(readCoordinationJournal(root))
}
