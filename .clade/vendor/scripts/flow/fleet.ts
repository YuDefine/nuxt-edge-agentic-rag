// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/fleet.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/fleet.ts
// clade flow spine — fleet reader (one site for clade + every consumer)
//
// P3 handed the spine to 13 consumers, so this machine now holds 14 unrelated `events.jsonl`
// files. Seeing what the fleet is doing meant opening each repo in turn. This reads all of them
// at once, and it is still only a projection: no server, no reporting, no sixth schema.
//
// Three properties are the whole contract, and each has a test:
//
//   1. EVENTS STAY IN THEIR OWN REPO. This reads; it NEVER copies a consumer's events into
//      clade's spine. Two copies of one fact drift, and then neither is the record.
//   2. THE ROSTER COMES FROM THE REGISTRY. `consumers.local` is generated from
//      `registry/consumers.json`; there is NEVER a second hand-written list here.
//   3. A REPO THAT CANNOT BE READ IS NAMED. Never silently skipped — a fleet view that is
//      missing three consumers but looks complete is worse than no fleet view at all.
//
// Why the roster is parsed here instead of imported: the reader for `consumers.local` lives in
// `scripts/lib/consumers-list.ts`, which is clade-only, while this directory is propagated to
// every consumer. Importing across that boundary makes the projected CLI throw
// ERR_MODULE_NOT_FOUND the moment a consumer runs it. The two parsers are pinned together by a
// test (`test/flow-fleet.test.ts`) so the duplication cannot drift.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { readEventsFile, spinePathIn } from './emit.ts'
import { type FlowEvent, type Span, type WorkItem, buildWorkItems, foldSpans } from './spine.ts'
import { DEFAULT_STALL_MINUTES, type Stall, findStalls } from './stall.ts'

/** Why a repo contributes nothing. Each value is an observable state, not a guess. */
export type RepoState =
  /** Spine read, events present. */
  | 'ok'
  /** Checkout and projection are there; nothing has been recorded yet. */
  | 'no-events'
  /** Checked out, but the flow projection was never delivered (pre-P3, or opted out). */
  | 'no-projection'
  /** In the registry, not on this machine. */
  | 'missing-checkout'
  | 'read-error'

export interface FleetRepo {
  name: string
  path: string
  spine_path: string
  state: RepoState
  events: number
}

/** A repo that contributes nothing, plus the sentence explaining which one and why. */
export interface UnreadableRepo extends FleetRepo {
  why: string
}

export interface FleetSnapshot {
  generated_at: string
  roster_path: string
  repos: FleetRepo[]
  unreadable: UnreadableRepo[]
  events: number
  /** Work items from every repo. `repo` is part of the identity — work ids collide across repos. */
  work_items: (WorkItem & { repo: string })[]
  spans: (Span & { repo: string })[]
  stalls: (Stall & { repo: string })[]
}

const WHY: Record<RepoState, string> = {
  ok: '',
  'no-events': '有 checkout 也有投影，但還沒有任何事件',
  'no-projection': '沒有 .clade/flow/ 投影（尚未散播，或這家沒開 improvement loop）',
  'missing-checkout': '在 registry 裡，但這台機器上沒有這個 checkout',
  'read-error': '事件來源讀取失敗；本次資料不可用，其他專案仍持續更新',
}

/**
 * The fleet roster: clade first, then every consumer in `consumers.local`.
 *
 * Returns `null` when the roster file is absent — that is the honest answer in a consumer
 * checkout, where this file exists (it is propagated) but there is no fleet to read. NEVER return
 * an empty list there: "no consumers" and "this repo does not have the list" are different facts.
 */
export function resolveFleetRoots(
  cladeRoot: string,
): { roster_path: string; roots: string[] } | null {
  const rosterPath = join(cladeRoot, 'consumers.local')
  if (!existsSync(rosterPath)) return null
  const roots = [resolve(cladeRoot)]
  for (const rawLine of readFileSync(rosterPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const [path] = line.split(/\s+/)
    if (path) roots.push(resolve(path))
  }
  return { roster_path: rosterPath, roots: [...new Set(roots)] }
}

/** Display name. Mirrors `scripts/lib/consumers-list.ts::consumerName`, pinned by test. */
export function repoName(root: string, cladeRoot: string): string {
  if (resolve(root) === resolve(cladeRoot)) return 'clade'
  const base = basename(root)
  if (base === 'template') return `${basename(dirname(root))}/template`
  return base || root
}

/**
 * Queue `repo` name → checkout root. **Every write path resolves the target repo through this
 * one function**, whichever surface it came from (`/decisions` endpoints, `flow answer`, the
 * Notion projector).
 *
 * Why it lives here rather than in the web server's utils, where it started: a second
 * implementation of this does not degrade gracefully. It does not mean "one surface is broken" —
 * it means **an answer lands on another repo's spine and edits that repo's file**, for a span
 * that repo has never heard of. The chat surface used to hand-resolve the root by eye, which is
 * exactly that second implementation, made of a guess and carrying no roster check at all.
 *
 * NEVER fall back to clade when the name does not resolve. Silently writing a consumer's answer
 * into clade's spine and clade's files is worse than a visible failure: the span does not exist
 * there, and the file has already been changed.
 *
 * Both spellings are accepted because the queue has two modes: fleet mode names clade itself
 * `clade` via `repoName()`, while a missing roster makes `buildSnapshot` fall back to a single
 * repo keyed by `basename(cwd)`. Accepting only the former would make the whole page inoperable
 * the moment the roster is absent — precisely when there is one repo left and operating on it
 * matters most.
 */
export function resolveRepoRootByName(repo: string | null, cladeRoot: string): string | null {
  const root = resolve(cladeRoot)
  if (!repo) return root
  const roster = resolveFleetRoots(root)
  const candidates = roster ? [...new Set([root, ...roster.roots])] : [root]
  return candidates.find((r) => repoName(r, root) === repo || basename(r) === repo) ?? null
}

/** The one sentence every surface says when the name does not resolve. */
export const REPO_NOT_ON_ROSTER = (repo: string | null): string =>
  `roster 上找不到 repo「${repo}」——不寫入，請確認這一題屬於哪個 checkout`

function stateOf(root: string, spinePath: string): { state: RepoState; events: FlowEvent[] } {
  if (!existsSync(root)) return { state: 'missing-checkout', events: [] }
  if (!existsSync(dirname(spinePath))) return { state: 'no-projection', events: [] }
  if (!existsSync(spinePath) || statSync(spinePath).size === 0) {
    return { state: 'no-events', events: [] }
  }
  const events = readEventsFile(spinePath) as FlowEvent[]
  return { state: events.length > 0 ? 'ok' : 'no-events', events }
}

/**
 * Fold every repo's stream, keeping each one separate.
 *
 * Per-repo folding is not an optimization — it is the correctness requirement. Work ids collide
 * across repos (every consumer that received the last propagate holds a `W-<date>-propagate`), so
 * folding the concatenated streams would merge unrelated work into one item.
 */
export function buildFleetSnapshot({
  cladeRoot,
  stallMinutes = DEFAULT_STALL_MINUTES,
  now = Date.now(),
}: {
  cladeRoot: string
  stallMinutes?: number
  now?: number
}): FleetSnapshot | null {
  const roster = resolveFleetRoots(cladeRoot)
  if (!roster) return null

  const repos: FleetRepo[] = []
  const unreadable: UnreadableRepo[] = []
  const work_items: (WorkItem & { repo: string })[] = []
  const spans: (Span & { repo: string })[] = []
  const stalls: (Stall & { repo: string })[] = []
  let total = 0

  for (const root of roster.roots) {
    const name = repoName(root, cladeRoot)
    const spinePath = spinePathIn(root)
    let state: RepoState
    let events: FlowEvent[]
    try {
      ;({ state, events } = stateOf(root, spinePath))
    } catch {
      state = 'read-error'
      events = []
    }
    const repo: FleetRepo = {
      name,
      path: root,
      spine_path: spinePath,
      state,
      events: events.length,
    }
    repos.push(repo)
    if (state !== 'ok') {
      unreadable.push({ ...repo, why: WHY[state] })
      continue
    }
    total += events.length
    const folded = foldSpans(events)
    for (const s of folded) spans.push({ ...s, repo: name })
    for (const w of buildWorkItems(folded)) work_items.push({ ...w, repo: name })
    for (const st of findStalls(folded, { now, thresholdMinutes: stallMinutes })) {
      stalls.push({ ...st, repo: name })
    }
  }

  return {
    generated_at: new Date(now).toISOString(),
    roster_path: roster.roster_path,
    repos,
    unreadable,
    events: total,
    work_items,
    spans,
    stalls,
  }
}

/** Terminal rendering for `flow status --all`. Unreadable repos are printed, never dropped. */
export function renderFleetStatus(snapshot: FleetSnapshot): string {
  const lines: string[] = []
  const readable = snapshot.repos.filter((r) => r.state === 'ok')
  lines.push(
    `fleet: ${readable.length}/${snapshot.repos.length} repos readable, ${snapshot.events} events  (roster: ${snapshot.roster_path})`,
    '',
  )
  for (const repo of readable) {
    const items = snapshot.work_items.filter((w) => w.repo === repo.name)
    const live = items.filter((w) => w.state === 'in-flight').length
    const stalled = snapshot.stalls.filter((s) => s.repo === repo.name).length
    lines.push(
      `${repo.name}  work=${items.length} in-flight=${live} stalled=${stalled} events=${repo.events}`,
    )
    for (const w of items.toSorted((a, b) => b.last_ts.localeCompare(a.last_ts)).slice(0, 5)) {
      lines.push(
        `    ${w.state.padEnd(9)} ${w.work_id}  spans=${w.spans} failed=${w.failed}  ${w.last_ts}`,
      )
    }
  }
  if (snapshot.unreadable.length > 0) {
    lines.push('', `讀不到（${snapshot.unreadable.length}）:`)
    for (const r of snapshot.unreadable) lines.push(`    ${r.name}  ${r.why}`)
  }
  return `${lines.join('\n')}\n`
}
