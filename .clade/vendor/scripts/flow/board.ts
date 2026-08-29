// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/board.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/board.ts
// clade flow board — the one lane projection both a human page and an agent CLI read.
//
// `flow status` answers "what is on the spine" with one line per work item, all 92 of them. That
// is the right answer for a fold and the wrong answer for a person opening a page or an agent
// opening a session: 78% of those rows are unnamed activity nobody can act on, and a list where
// four out of five rows are noise is a list people stop reading.
//
// This file is the shared half of the fix. It is a pure function of the same fold every other
// view reads — no store, no cache, no second data model — and it produces exactly two things:
// an ENTRY THRESHOLD (what deserves a card at all) and a LANE (which of five questions this card
// is the answer to). `flow brief` renders it as text; `/board` renders it as columns. Neither
// derives a lane of its own: two copies of "which lane is this in" is two boards that can
// disagree about the same work item, and neither would be wrong about its own copy — the same
// reason `buildWhoRows` is one function serving both a CLI and a page.
//
// READ-ONLY. Nothing here writes, and the board has no write actions at all: the one action a
// board card would want (accept the work) is a question a human answers in `/decisions`, which
// is the surface that already owns questions.

import type { SpanArtifact } from './nodes/lib/artifacts.ts'
import type { Span, WorkItem, WorkState } from './spine.ts'
import type { Stall, StallShape } from './stall.ts'

export type BoardLane = 'awaiting-you' | 'blocked' | 'in-flight' | 'parked' | 'closed'

/**
 * The five lanes, in derivation priority (highest first) and in display order — deliberately the
 * same list, so the column a reader scans first is also the one that wins a tie.
 *
 * `done` lands in 待你, NOT in 已收: accept is human-only, so a claimed-finished work item is
 * waiting on a person exactly as much as an unanswered question is. Filing it under "已收" would
 * report the claim as the verdict, which is the one confusion the six-state fold exists to avoid.
 */
export const BOARD_LANES: { lane: BoardLane; label: string }[] = [
  { lane: 'awaiting-you', label: '待你' },
  { lane: 'blocked', label: '受阻' },
  { lane: 'in-flight', label: '進行中' },
  { lane: 'parked', label: '擱置' },
  { lane: 'closed', label: '已收' },
]

const LANE_LABEL = new Map(BOARD_LANES.map((l) => [l.lane, l.label]))

export function laneLabel(lane: BoardLane): string {
  return LANE_LABEL.get(lane) ?? lane
}

export interface PendingDecision {
  span_id: string
  question: string | null
  age_minutes: number
  since: string
}

/**
 * How one work item's DIRECT children are doing.
 *
 * WHY THIS EXISTS. Measured on this repo 2026-08-29: the parent card of this very plan read
 * `lane=擱置 · 無 span 在跑、無人宣告完成 · 2.6h 未動` at a moment when all three of its children
 * were in flight and two of its cuts had already landed on main. That is not a card lacking
 * detail, it is a card saying the OPPOSITE of what was happening — and it happens to every work
 * item big enough to be split, which is every work item worth tracking.
 *
 * ONE HOP, deliberately. `workParentState` / `workDepth` in `spine.ts` own hierarchy derivation
 * and this file NEVER grows a second copy of it — but it also cannot call them: `board.ts` is the
 * one flow module the browser bundle imports, and it stays importable only because every import
 * in it is `import type` (see `review-gui-web/lib/spine-types.ts` header). Importing a function
 * from `spine.ts` would drag `node:child_process` and `node:fs` into the page. A single-hop
 * group-by is not a hierarchy derivation: it elects no root, computes no depth, and resolves no
 * cycle. Grandchildren therefore count toward their own parent's card, not their grandparent's —
 * stated here because a reader MUST NOT infer from a green parent that the whole subtree moved.
 */
export interface ChildProgress {
  total: number
  in_flight: number
  /** Claimed finished, not yet accepted — 待你 on the child's own card. */
  done: number
  blocked: number
  parked: number
  /** Accepted or dropped: the only two that mean nobody owes anything on that child any more. */
  closed: number
}

/**
 * One child's output, kept under that child's own name.
 *
 * THE `work_id`/`title` PAIR IS THE POINT. A parent's output view that flattened every child's
 * artifacts into one list would answer 「這件工作交付了什麼」 while destroying 「是誰交付的」,
 * and on a card whose whole reason for existing is that the work happens one level down, the
 * second question is the one a reader actually has.
 */
export interface ChildArtifactGroup {
  work_id: string
  /** Same derivation as the child's own card, so the two surfaces name it identically. */
  title: string | null
  artifacts: SpanArtifact[]
  /** The child's own `artifact_waiver`. Non-null only when `artifacts` is empty. */
  waiver: string | null
}

/**
 * What a work item's DIRECT children left behind — the aggregation `artifacts` deliberately is not.
 *
 * `WorkItem.artifacts` is one level of aggregation by design (spine.ts:104): a work item's output is
 * the union of ITS OWN spans. That is right, and this is a separate field rather than a deeper
 * `artifactsOf` for exactly that reason — a parent that adopted its children's artifacts as its own
 * would claim to have produced them, which is the confident-and-wrong answer.
 *
 * ONE HOP, like `childProgress`: grandchildren are their own children's business. This module is the
 * only flow module a browser can load (everything else here is `import type`), so recursing would
 * mean importing `workDepth` from `spine.ts` and dragging `node:fs` into the bundle.
 *
 * The three empty kinds are counted SEPARATELY because they are three different facts and the board
 * exists to stop them rendering as one blank: `waived` claimed done and said why there is nothing,
 * `silent` never recorded anything, `unclaimed` has not finished yet so there is nothing to record.
 */
export interface ChildArtifacts {
  /** Direct children, the same one-hop set `childProgress` counts. */
  total: number
  /** Flattened artifact count across `groups` — a heading can state it without summing in a template. */
  count: number
  /** Children that left at least one artifact. */
  with_output: number
  /** Children that claimed completion and explained the absence. */
  waived: number
  /** Children that claimed completion and left nothing, with no explanation. */
  silent: number
  /** Children that have not claimed completion — nothing is owed yet. */
  unclaimed: number
  /** One entry per child with something to show or a waiver to explain, in board order. */
  groups: ChildArtifactGroup[]
}

/**
 * One dispatch, as the stream recorded it — the fields that were on the spine all along and that
 * no projection ever took.
 *
 * THE TWO ANNOTATIONS ARE SEPARATE FIELDS AND MUST STAY SEPARATE. `backfilled` says WHEN the row
 * was written (afterwards, from the pi ledger, rather than as it happened); `cwd_inferred` says
 * how its REPO ATTRIBUTION was decided (the dispatch's own directory was gone, so the
 * `<repo>-wt/<slug>` shape of the path was used). Collapsing them into one "this data may be
 * approximate" flag loses both facts: a reader can no longer tell a faithfully recorded row that
 * was merely filed late from a live row whose repo is a guess.
 */
export interface DispatchDetail {
  span_id: string
  /** `ledger_label` (the pi/codex join key) or the span's own label. Null for neither. */
  label: string | null
  actor: string
  substrate: string
  model: string | null
  exit: number | null
  duration_ms: number | null
  error_class: string | null
  outcome: string | null
  ts: string | null
  pane_id: string | null
  /** FACT: written after the event, not as it happened. */
  backfilled: boolean
  /** The raw verdict, verbatim from the ingest node. `cwd` = direct, anything else = inferred. */
  cwd_resolved_via: string | null
  /** INFERENCE: this row's repo was derived from the shape of a path, not read off the dispatch. */
  cwd_inferred: boolean
}

/**
 * One leg of a relay: a contiguous run of spans carried by one actor.
 *
 * BASIS IS `actor`, NOT `session_id`, and the difference is visible in `ProgressView.basis`
 * because it is an inference rather than a reading. `foldSpans` does not carry `session_id` onto
 * a span (it is dropped at the fold, spine.ts:144), and `spine.ts` is not this cut's to change —
 * so the closest observable proxy for "somebody else picked this up" is the actor changing. It is
 * right whenever a handoff crosses a model, a pane, or a substrate, and wrong when one actor's
 * work is split across two sessions. A view MUST say which of those it is showing.
 */
export interface RelayLeg {
  /** 1-based. This is the 「第 N 棒」 a reader counts. */
  index: number
  actor: string
  substrate: string
  start_ts: string | null
  /** Null while the leg is still running. */
  end_ts: string | null
  spans: number
  in_flight: number
  /** What this leg handed over. Empty is honest: not every leg leaves a coordinate. */
  artifacts: SpanArtifact[]
  outcome: string | null
  pane_id: string | null
}

export interface ProgressView {
  legs: RelayLeg[]
  /** 1-based index of the leg still running, or of the last one when nothing is. 0 when empty. */
  current: number
  /** True when the last leg ended and nobody picked it up — the handoff nobody caught. */
  handed_off: boolean
  /** Named so a reader can weigh it. See `RelayLeg`. */
  basis: 'actor-runs'
}

export interface BoardCard {
  work_id: string
  lane: BoardLane
  lane_label: string
  /** title → slug → origin_ref, in that order. Null only for a card admitted by "needs eyes". */
  title: string | null
  state: WorkState
  origin_ref: string | null
  origin_kind: string | null
  /** One line saying why this card is in this lane — the stall shape, the question, the claim. */
  reason: string
  /**
   * The next step, as a command or a named act. Stall actions are passed through VERBATIM from
   * `stall.ts`: rewording them here would make two surfaces phrase one state two ways, and a
   * reader who saw both would read two states. To change the wording, change `stall.ts`.
   */
  action: string | null
  age_minutes: number
  last_ts: string
  stalls: Stall[]
  pending_decisions: PendingDecision[]
  parked_at: string | null
  done_ts: string | null
  verification: string | null
  /** What this work item left behind — aggregated by the fold, never typed onto the card. */
  artifacts: SpanArtifact[]
  /** Why a claim of completion stands with no artifact. Null when there was nothing to waive. */
  artifact_waiver: string | null
  /** Delivery estimate: declared, derived, overdue, or an honest refusal to guess. */
  eta: EtaView
  /** Raw, unresolved. A parent living in another repo's spine is normal, not a defect. */
  parent_work_id: string | null
  /** Null when this work item has no children at all — NEVER a zeroed record, which reads as「有子卡但都沒動」. */
  children: ChildProgress | null
  /**
   * What the direct children produced, kept apart from `artifacts`. Null when there are no children,
   * for the same reason `children` is: an empty record reads as「有子卡但什麼都沒交付」.
   */
  child_artifacts: ChildArtifacts | null
  /** Every dispatch this work item made, newest last. The board's answer to 「這一步跑了什麼」. */
  dispatches: DispatchDetail[]
  /** Who carried this work, in order. The board's answer to 「進展到哪」. */
  progress: ProgressView
}

/** The two bases a person can DECLARE. `derived` is never declared — it is computed at read time. */
export type EtaBasis = 'human' | 'agent-estimate' | 'derived'

/**
 * One card's delivery estimate, as four mutually exclusive states.
 *
 * There is no fifth state for "blank". A board that answers 「預計交付期」 with an empty cell is
 * the board this layer exists to replace: a reader cannot tell an unestimated card from a card
 * whose estimate failed to render, so 「估不出來」 is a rendered STATE and carries its own reason.
 *
 * `label` is the badge text, and it always names its own basis. A bare date is exactly the template
 * number the estimate discipline forbids — the discipline is not against estimating, it is against
 * numbers that cannot say where they came from.
 */
export interface EtaView {
  state: 'declared' | 'derived' | 'overdue' | 'unknown'
  target_ts: string | null
  basis: EtaBasis | null
  /** When the declaration was made. Null for a derived estimate — nobody declared it. */
  declared_ts: string | null
  /** Comparable finished work behind a derived estimate, or behind the refusal to make one. */
  sample: number
  /** The pessimistic half of a derived estimate. A median alone reads as a promise. */
  p80_ts: string | null
  /** A declaration older than a week on work still moving. An old date looks like information. */
  stale: boolean
  overdue_days: number | null
  label: string
}

/**
 * One pile of dispatch residue: the same stall shape on the same substrate.
 *
 * WHY THIS EXISTS. Measured 2026-08-28 across the fleet: 受阻 held 52 cards and every one of them
 * was anonymous — 43 Herdr panes, 12 pi, 4 codex, all of them dead dispatches rather than work
 * anybody is doing. Read as 52 equal cards that list is unactionable, and the failure it produces
 * is documented: the 2026-08-27 stalls sat 67.3h and 33.6h with correct actions nobody ran. The
 * pile is not 52 decisions, it is four or five, and this is the type that says so.
 *
 * NEVER let this become a filter. Nothing is dropped: every card in a cluster is also in the
 * lane's `cards`. Grouping changes how many things a reader must look at, not how many exist —
 * hiding a residue card is how the oldest stall on the fleet stops being anybody's problem.
 */
export interface ResidueCluster {
  /** `<shape>·<substrate>` — stable, and the DOM key a renderer folds on. */
  key: string
  /** Null for the residue admitted by "needs eyes" with no stall at all (a failed anonymous run). */
  shape: StallShape | null
  substrate: string
  cards: BoardCard[]
  /** Oldest card in the pile. A collapsed group MUST still be able to show this. */
  oldest_minutes: number
  /**
   * Every card's `action`, verbatim, one per line — what a "copy this pile" control hands over.
   *
   * NEVER replace this with one synthesised loop command. `--reclaim <pane> --verified` asserts a
   * human checked three things; a `for` loop over 22 panes performs that assertion 22 times and
   * checks it zero times. Concatenation keeps every judgement where it was, and only removes the
   * cost of copying 22 lines one at a time — which is the actual complaint.
   */
  actions: string
  /** Pane ids present in this pile, for locating them in Herdr. May be shorter than `cards`. */
  pane_ids: string[]
}

export interface BoardLaneGroup {
  lane: BoardLane
  label: string
  cards: BoardCard[]
  /**
   * `cards` split into work with a name and anonymous dispatch residue. Both are always present
   * and always sum to `cards` — a renderer picks the split or the flat list, and gets the same
   * set either way. Non-blocked lanes leave `residue` empty: 擱置 is 27 *named* work items, a
   * different failure needing a different answer (see `classify`'s parked branch).
   */
  named: BoardCard[]
  residue: ResidueCluster[]
}

export interface Board {
  groups: BoardLaneGroup[]
  counts: Record<BoardLane, number>
  /**
   * What the threshold kept out, as a count rather than as silence. The aggregate line is the
   * R3 orphan ratio made visible: a board that simply omitted them would answer "how much of
   * this fleet's activity cannot say what work it belongs to" with nothing at all.
   */
  hidden: { count: number; recent: number; recent_days: number; by_state: Record<string, number> }
  total_work_items: number
}

const HIDDEN_RECENT_DAYS = 7

function ageMinutes(ts: string | null | undefined, now: number): number {
  if (!ts) return 0
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor((now - parsed) / 60_000))
}

/** Longest question fragment a card line carries before it stops being scannable. Matches stall.ts. */
const LABEL_MAX = 60

function clamp(text: string, max = LABEL_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function questionOf(span: Span): string | null {
  const q = span.payload?.question
  return typeof q === 'string' && q.length > 0 ? clamp(q) : null
}

/** Short display form of an origin: `td:TD-664`, `tasks:…/foo.md` → the tail, not the whole path. */
export function shortOrigin(ref: string | null): string | null {
  if (!ref) return null
  const cut = ref.indexOf(':')
  if (cut === -1) return clamp(ref, 48)
  const scheme = ref.slice(0, cut)
  const rest = ref.slice(cut + 1)
  const tail = rest.includes('/') ? (rest.split('/').pop() ?? rest) : rest
  return clamp(`${scheme}:${tail}`, 48)
}

export function cardTitle(item: WorkItem): string | null {
  return item.title ?? item.slug ?? shortOrigin(item.origin_ref)
}

/**
 * A work item has a name iff a human could recognise it from the board without opening it.
 *
 * R2 says small ad-hoc changes deliberately mint no name; this is the predicate that lets that
 * stay true without those changes becoming 71 anonymous rows on a page.
 */
export function isNamed(item: WorkItem): boolean {
  return Boolean(item.slug ?? item.origin_ref ?? item.title)
}

/**
 * The entry threshold: `named ∨ needs-eyes`.
 *
 * The second half is why an unnamed item can still be a card, and it is NOT a nicety — the two
 * oldest stalls on this repo (88.5h and 54.8h unharvested) carry orphan work ids, and a
 * name-only threshold would have hidden exactly the two rows the board exists to surface.
 *
 * fail-open by construction: this is a projection-layer filter with no write path, and
 * `flow status --json` stays the full set for anything that needs all of it.
 */
export function passesEntryThreshold(item: WorkItem, stalls: Stall[]): boolean {
  if (isNamed(item)) return true
  return (
    item.state === 'in-flight' ||
    item.state === 'failed' ||
    item.state === 'done' ||
    stalls.length > 0
  )
}

/**
 * Stalls that mean "someone other than the human at the board has to move".
 *
 * A stall hanging off a `decision.request` span is the human's own queue — it belongs in 待你,
 * where the action is answering it. The one exception is `clarification-requested`: there a
 * human already said the question is not answerable as written, so the ball is back with the
 * asking agent, and reporting it as "waiting on you" would be reporting it to the wrong person.
 */
function isBlockingStall(stall: Stall): boolean {
  return stall.shape === 'clarification-requested' || stall.kind !== 'decision.request'
}

/**
 * The one stall a blocked card speaks for: the oldest of the blocking ones.
 *
 * Shared by `classify` (which words the card) and `clusterResidue` (which piles the card up) so
 * the heading a reader folds open and the sentence they find inside can never name two different
 * stalls. Two copies of "which stall is this card about" is the same bug as two copies of "which
 * lane is this card in", one level down.
 */
function worstStall(blocking: Stall[]): Stall | undefined {
  return blocking.toSorted((a, b) => b.age_minutes - a.age_minutes)[0]
}

function pendingDecisionsByWork(spans: Span[], now: number): Map<string, PendingDecision[]> {
  const dismissed = new Set<string>()
  for (const s of spans) {
    if (s.kind === 'decision.dismiss' && s.parent_span) dismissed.add(s.parent_span)
  }
  const out = new Map<string, PendingDecision[]>()
  for (const s of spans) {
    if (s.kind !== 'decision.request' || s.end_ts || dismissed.has(s.span_id)) continue
    const held = out.get(s.work_id) ?? []
    held.push({
      span_id: s.span_id,
      question: questionOf(s),
      age_minutes: ageMinutes(s.start_ts, now),
      since: s.start_ts ?? '',
    })
    out.set(s.work_id, held)
  }
  return out
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`
}

const ACCEPT_ACTION = (workId: string) =>
  `node vendor/scripts/flow/flow.ts accept ${workId} --reason '<why>'   (或 drop)`

/**
 * The parked branch's next step — deliberately TWO options, never one.
 *
 * 27 named work items sat parked with `action: null` (measured 2026-08-28): the board had nothing
 * to say about any of them. That silence is the documented failure — 登記是紀錄, relay 是送達 —
 * and a parked item nobody relayed is one nobody will do.
 *
 * NEVER cut this down to the relay half. Some of those 27 are stale and want dropping, and an
 * action that only knows how to dispatch would send zombie work to a fresh pane; 27 zombie panes
 * is strictly worse than 27 quiet cards. The two halves are also deliberately asymmetric in form:
 * the relay half names an act and the skill that performs it, because this file does not know the
 * consumer, cwd or brief a real dispatch needs, and a command template that fails when pasted
 * costs the whole action column its credibility. Only the half we can state exactly is a command.
 */
const PARKED_TRIAGE_ACTION = (workId: string) =>
  `還要做 → 交給一個 session：/handoff relay（brief 指向這件工作的 origin）` +
  `｜不做了 → node vendor/scripts/flow/flow.ts drop ${workId} --reason '<why>'`

const ANSWER_ACTION = (spanId: string) =>
  `answer it in review-gui /decisions, or: node vendor/scripts/flow/flow.ts answer ${spanId} --answer '<text>'`

/**
 * How many comparable finished work items a derived estimate needs before it is shown.
 *
 * Five is not a statistical claim; it is the point below which a median is one anecdote wearing a
 * number. Under it the honest output is 「估不出來」 WITH the sample size, so a reader can see the
 * estimate is missing because the evidence is missing — never because the feature is broken.
 */
export const MIN_ETA_SAMPLE = 5

/** A declaration older than this, on work still moving, is annotated rather than trusted. */
export const STALE_DECLARATION_DAYS = 7

/** Work states that mean nothing is expected to land any more, so nothing can be overdue. */
const ETA_FINISHED: ReadonlySet<WorkState> = new Set<WorkState>(['done', 'accepted', 'dropped'])

/**
 * How long comparable work has historically taken, per `origin_kind`.
 *
 * The sample is `first_ts → done_ts` over FINISHED work, which is the only duration this spine can
 * observe without anybody promising anything. It is recomputed on every read and NEVER written:
 * a percentile stored on a work item is stale the next time any comparable work finishes, and a
 * stale number that renders as a date is worse than no number at all.
 *
 * Bucketed by `origin_kind` because that is the closest thing to "same sort of work" the fold
 * already holds — a TD entry and a Notion request are not comparable, and pooling them produces a
 * median that describes neither. Work with no origin buckets under `''`, together: absent is a
 * category, and pretending otherwise would silently deny the whole residue population an estimate.
 */
export interface DurationBaseline {
  origin_kind: string | null
  sample: number
  p50_ms: number
  p80_ms: number
}

export function durationBaselines(items: readonly WorkItem[]): Map<string, DurationBaseline> {
  const buckets = new Map<string, number[]>()
  for (const item of items) {
    if (item.state !== 'done' && item.state !== 'accepted') continue
    if (!item.done_ts || !item.first_ts) continue
    const ms = Date.parse(item.done_ts) - Date.parse(item.first_ts)
    // A non-positive duration is a clock artefact (an event backfilled ahead of the open), not a
    // work item that took no time. Counting it would drag the median toward a delivery nobody made.
    if (!Number.isFinite(ms) || ms <= 0) continue
    const key = item.origin_kind ?? ''
    const held = buckets.get(key) ?? []
    held.push(ms)
    buckets.set(key, held)
  }
  const out = new Map<string, DurationBaseline>()
  for (const [key, values] of buckets) {
    const sorted = values.toSorted((a, b) => a - b)
    out.set(key, {
      origin_kind: key === '' ? null : key,
      sample: sorted.length,
      p50_ms: percentile(sorted, 0.5),
      p80_ms: percentile(sorted, 0.8),
    })
  }
  return out
}

/** Nearest-rank, so every reported number is a duration that actually happened to some work item. */
function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.max(1, Math.min(sorted.length, Math.ceil(p * sorted.length)))
  return sorted[rank - 1]
}

/** `2026-09-05` — the only precision an estimate has. Hours on a forecast are false precision. */
function day(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts)
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString().slice(0, 10)
}

const DERIVED_BASIS = (sample: number) => `依 ${sample} 件同類歷史中位`

/**
 * One card's estimate. Pure, and deliberately the ONLY place the four states are decided.
 *
 * Declared beats derived on every card that has one: a percentile describes a population, and a
 * person who committed to a date is making a statement about THIS work. The derived layer exists so
 * that a card nobody estimated still says something with a basis, not so that it can overrule one.
 */
export function etaFor(
  item: WorkItem,
  baselines: Map<string, DurationBaseline>,
  now: number,
): EtaView {
  const active = !ETA_FINISHED.has(item.state)
  const base: EtaView = {
    state: 'unknown',
    target_ts: null,
    basis: null,
    declared_ts: null,
    sample: 0,
    p80_ts: null,
    stale: false,
    overdue_days: null,
    label: '',
  }

  if (item.eta_target && item.eta_basis) {
    const target = Date.parse(item.eta_target)
    const overdue = active && Number.isFinite(target) && target < now
    const stale =
      active &&
      item.eta_declared_ts !== null &&
      now - Date.parse(item.eta_declared_ts) > STALE_DECLARATION_DAYS * 86_400_000
    const who = item.eta_basis === 'human' ? '人工填寫' : 'agent 估算'
    const declared = item.eta_declared_ts ? day(item.eta_declared_ts) : '(unknown)'
    if (overdue) {
      const days = Math.floor((now - target) / 86_400_000)
      return {
        ...base,
        state: 'overdue',
        target_ts: item.eta_target,
        basis: item.eta_basis,
        declared_ts: item.eta_declared_ts,
        stale,
        overdue_days: days,
        label: `逾期 ${days} 天（原估 ${day(item.eta_target)}，${who}，估於 ${declared}）`,
      }
    }
    return {
      ...base,
      state: 'declared',
      target_ts: item.eta_target,
      basis: item.eta_basis,
      declared_ts: item.eta_declared_ts,
      stale,
      // The declaration timestamp is already in the label, so 「估算過時」 does not repeat it: a
      // badge that prints the same date twice reads as two dates.
      label: `預計 ${day(item.eta_target)}（${who}，估於 ${declared}）${stale ? '・估算過時' : ''}`,
    }
  }

  const baseline = baselines.get(item.origin_kind ?? '')
  const sample = baseline?.sample ?? 0
  if (!baseline || sample < MIN_ETA_SAMPLE || !item.first_ts) {
    return {
      ...base,
      sample,
      label: `估不出來——無宣告且同類已結案樣本 <${MIN_ETA_SAMPLE} 件（N=${sample}）`,
    }
  }
  const start = Date.parse(item.first_ts)
  const target = start + baseline.p50_ms
  const p80 = new Date(start + baseline.p80_ms).toISOString()
  if (active && target < now) {
    const days = Math.floor((now - target) / 86_400_000)
    return {
      ...base,
      state: 'overdue',
      target_ts: new Date(target).toISOString(),
      basis: 'derived',
      sample,
      p80_ts: p80,
      overdue_days: days,
      label: `逾期 ${days} 天（原估 ${day(target)}，${DERIVED_BASIS(sample)}）`,
    }
  }
  return {
    ...base,
    state: 'derived',
    target_ts: new Date(target).toISOString(),
    basis: 'derived',
    sample,
    p80_ts: p80,
    label: `預計 ${day(target)}（${DERIVED_BASIS(sample)}，p80 ${day(p80)}）`,
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Direct children per parent, counted by the state the child's own card would show.
 *
 * Self-parenting is skipped rather than counted: `work.link` is last-write-wins, so `A → A` is a
 * reachable pair of legal writes, and a card reporting itself as its own child in flight would be
 * the same confident-and-upside-down answer `workDepth` refuses to give.
 */
export function childProgress(items: readonly WorkItem[]): Map<string, ChildProgress> {
  const out = new Map<string, ChildProgress>()
  for (const child of items) {
    const parent = child.parent_work_id
    if (!parent || parent === child.work_id) continue
    const held = out.get(parent) ?? {
      total: 0,
      in_flight: 0,
      done: 0,
      blocked: 0,
      parked: 0,
      closed: 0,
    }
    held.total += 1
    if (child.state === 'in-flight') held.in_flight += 1
    else if (child.state === 'done') held.done += 1
    else if (child.state === 'failed') held.blocked += 1
    else if (child.state === 'accepted' || child.state === 'dropped') held.closed += 1
    else held.parked += 1
    out.set(parent, held)
  }
  return out
}

/**
 * Direct children's artifacts per parent, attributed to the child that produced them.
 *
 * Same one-hop group-by as `childProgress`, same self-parenting skip, and deliberately the same
 * shape of pass: both are properties of the population, and a second traversal that disagreed about
 * which cards are children would let a parent report 「3 件子卡」 above a list drawn from 2.
 *
 * A child is only LISTED when it has artifacts or a waiver — something to show, or a stated reason
 * there is nothing. Silent and unclaimed children are COUNTED, never listed: a row bearing a name
 * and no content reads as a failed render rather than as an absence.
 */
export function childArtifacts(items: readonly WorkItem[]): Map<string, ChildArtifacts> {
  const out = new Map<string, ChildArtifacts>()
  for (const child of items) {
    const parent = child.parent_work_id
    if (!parent || parent === child.work_id) continue
    const held = out.get(parent) ?? {
      total: 0,
      count: 0,
      with_output: 0,
      waived: 0,
      silent: 0,
      unclaimed: 0,
      groups: [],
    }
    held.total += 1
    if (child.artifacts.length > 0) {
      held.with_output += 1
      held.count += child.artifacts.length
      held.groups.push({
        work_id: child.work_id,
        title: cardTitle(child),
        artifacts: child.artifacts,
        waiver: null,
      })
    } else if (child.artifact_waiver) {
      held.waived += 1
      held.groups.push({
        work_id: child.work_id,
        title: cardTitle(child),
        artifacts: [],
        waiver: child.artifact_waiver,
      })
    } else if (child.done_ts) {
      // Claimed finished with nothing to show and nothing said about it. This is the case
      // `artifact_waiver` was introduced to separate out, so it keeps its own count.
      held.silent += 1
    } else {
      held.unclaimed += 1
    }
    out.set(parent, held)
  }
  return out
}

/**
 * 「N 件中 M 件已收」 plus whatever else is non-zero. Only states with cards get a word.
 *
 * The words come from `laneLabel`, not from four string literals: a child's bucket IS the lane its
 * own card sits in, and typing 「進行中」 here would be the second copy of a label the lane table
 * already owns (the same rule `board-page-sources.test.ts` enforces on the page). 「待驗收」 is
 * the one exception and deliberately NOT `laneLabel('awaiting-you')`: on the child's own card that
 * lane means 「待你」, and a parent's summary saying 「1 待你」 would report whose turn it is with
 * a word that, in this position, names nothing.
 */
export function childSummary(kids: ChildProgress): string {
  const parts: string[] = []
  if (kids.in_flight > 0) parts.push(`${kids.in_flight} ${laneLabel('in-flight')}`)
  if (kids.done > 0) parts.push(`${kids.done} 待驗收`)
  if (kids.blocked > 0) parts.push(`${kids.blocked} ${laneLabel('blocked')}`)
  if (kids.parked > 0) parts.push(`${kids.parked} ${laneLabel('parked')}`)
  return `子卡 ${kids.total} 件中 ${kids.closed} 件${laneLabel('closed')}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
}

/** A span that IS a dispatch: a pi/codex row (it carries the ledger join key) or a Herdr pane. */
function isDispatchSpan(span: Span): boolean {
  return typeof span.payload?.ledger_label === 'string' || span.kind === 'session_transport'
}

/**
 * Every dispatch on one work item, oldest first.
 *
 * The fields were all in `payload` already — this function exists because no projection ever
 * read them, which is why 「codex secure 執行狀況」 was unanswerable from a page while sitting
 * complete in the stream.
 */
export function dispatchesOf(spans: readonly Span[]): DispatchDetail[] {
  const out: DispatchDetail[] = []
  for (const span of spans) {
    if (!isDispatchSpan(span)) continue
    const p = span.payload ?? {}
    const via = str(p.cwd_resolved_via)
    out.push({
      span_id: span.span_id,
      label: str(p.ledger_label) ?? str(p.label),
      actor: span.actor,
      substrate: span.substrate,
      model: str(p.model),
      exit: num(p.exit),
      duration_ms: num(p.duration_ms) ?? span.duration_ms,
      error_class: str(p.error_class),
      outcome: span.outcome,
      ts: span.start_ts ?? span.end_ts,
      pane_id: str(p.pane_id),
      backfilled: p.backfilled === true,
      cwd_resolved_via: via,
      // `cwd` means the dispatch's own directory still resolved; anything else is a path shape
      // that looked right. Absent is not inference — it is a dispatch that never needed resolving.
      cwd_inferred: via !== null && via !== 'cwd',
    })
  }
  return out.toSorted((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''))
}

/** Chronological, with in-flight spans (no `end_ts`) ordered by when they started. */
function spanOrder(a: Span, b: Span): number {
  return (a.start_ts ?? a.end_ts ?? '').localeCompare(b.start_ts ?? b.end_ts ?? '')
}

/**
 * The relay, as legs. See `RelayLeg` for why the boundary is `actor` and why that is an inference.
 */
// 落差（TD-820）：計畫 Q2 要 session_id 分段；foldSpans 丟棄 session_id（spine.ts:144），改 actor 連續段推導 —— 要改成真 session_id 需動 spine.ts，屬另一刀
export function progressOf(spans: readonly Span[]): ProgressView {
  const ordered = [...spans].toSorted(spanOrder)
  const legs: RelayLeg[] = []
  for (const span of ordered) {
    let leg = legs.at(-1)
    if (!leg || leg.actor !== span.actor || leg.substrate !== span.substrate) {
      leg = {
        index: legs.length + 1,
        actor: span.actor,
        substrate: span.substrate,
        start_ts: span.start_ts ?? span.end_ts,
        end_ts: null,
        spans: 0,
        in_flight: 0,
        artifacts: [],
        outcome: null,
        pane_id: null,
      }
      legs.push(leg)
    }
    leg.spans += 1
    // A point event is an instant, never something still running: `work.open` with no end is not
    // an open span, and counting it would report every work item as mid-flight forever.
    if (!span.end_ts && !span.is_point) leg.in_flight += 1
    if (span.end_ts && span.end_ts > (leg.end_ts ?? '')) {
      leg.end_ts = span.end_ts
      leg.outcome = span.outcome
    }
    leg.pane_id = leg.pane_id ?? str(span.payload?.pane_id)
    const list = span.payload?.artifacts
    if (Array.isArray(list)) {
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as Record<string, unknown>
        const ref = str(item.ref)
        if (!ref) continue
        const repo = str(item.repo)
        leg.artifacts.push({ type: str(item.type) ?? 'file', ref, ...(repo ? { repo } : {}) })
      }
    }
  }
  const running = legs.findIndex((l) => l.in_flight > 0)
  return {
    legs,
    current: running >= 0 ? running + 1 : legs.length,
    handed_off: legs.length > 0 && running < 0,
    basis: 'actor-runs',
  }
}

/**
 * Lane + the one line that says why, for one work item.
 *
 * Priority is the BOARD_LANES order, highest first. A terminal verdict does not short-circuit it:
 * an accepted work item that still has an unanswered question on it is still a question somebody
 * has to close, and hiding it under 已收 would retire the only surface that says so.
 */
function classify(
  item: WorkItem,
  stalls: Stall[],
  pending: PendingDecision[],
  now: number,
  kids: ChildProgress | null,
): { lane: BoardLane; reason: string; action: string | null } {
  const blocking = stalls.filter(isBlockingStall)

  if (pending.length > 0 && blocking.length === 0) {
    const first = pending[0]
    const more = pending.length > 1 ? `（另 ${pending.length - 1} 題）` : ''
    return {
      lane: 'awaiting-you',
      reason: `待答：${first.question ?? first.span_id.slice(0, 8)} · ${hours(first.age_minutes)}${more}`,
      action: ANSWER_ACTION(first.span_id),
    }
  }
  if (item.state === 'done') {
    // The artifact half of the line is not decoration: accepting work is supposed to rest on the
    // verification, and until now a claim with output and a claim with nothing to show rendered
    // identically. A waived claim says so IN the reason — a waiver nobody sees is a waiver nobody
    // can refuse.
    const output =
      item.artifacts.length > 0
        ? `${item.artifacts.length} 個產出物`
        : item.artifact_waiver
          ? `宣告完成・無產出物（waiver: ${clamp(item.artifact_waiver, 48)}）`
          : '宣告完成・無產出物'
    return {
      lane: 'awaiting-you',
      reason: `宣告完成待驗收 · ${output} · 驗證: ${item.verification ? clamp(item.verification, 72) : '(none)'}`,
      action: ACCEPT_ACTION(item.work_id),
    }
  }
  if (item.state === 'failed' || blocking.length > 0) {
    const worst = worstStall(blocking)
    return {
      lane: 'blocked',
      reason: worst
        ? `${worst.shape} · ${hours(worst.age_minutes)}${worst.label ? ` · ${clamp(worst.label, 40)}` : ''}`
        : `失敗且無後續 · 最後事件 ${hours(ageMinutes(item.last_ts, now))} 前`,
      // Verbatim from stall.ts — see BoardCard.action.
      action:
        worst?.action ??
        `失敗後這件工作沒有任何 span 再開始：重跑它，或記下為什麼放棄（node vendor/scripts/flow/flow.ts drop ${item.work_id} --reason '<why>'）`,
    }
  }
  if (item.state === 'in-flight') {
    return {
      lane: 'in-flight',
      reason: kids
        ? `${childSummary(kids)} · 自身 ${item.in_flight} 個 span 進行中`
        : `${item.in_flight} 個 span 進行中 · 最後事件 ${hours(ageMinutes(item.last_ts, now))} 前`,
      action: null,
    }
  }
  if (item.state === 'accepted' || item.state === 'dropped') {
    return {
      lane: 'closed',
      reason: `${item.state} · ${item.terminal_reason ? clamp(item.terminal_reason, 60) : '(no reason)'}`,
      action: null,
    }
  }
  // A work item that was SPLIT does not run spans of its own — the children do. Reading its own
  // (empty) span set and reporting 「無 span 在跑」 is how the board told this repo that a plan
  // with three live children was stalled: true about the row, false about the work, and false in
  // the direction that makes a reader stop looking. Children in flight put the parent in 進行中;
  // children that are all finished leave it parked, but NEVER under the 「無 span 在跑」 sentence.
  if (kids) {
    if (kids.in_flight > 0) {
      return {
        lane: 'in-flight',
        reason: `${childSummary(kids)} · 自身無 span（工作在子卡上）`,
        action: null,
      }
    }
    return {
      lane: 'parked',
      reason: `${childSummary(kids)} · 沒有子卡在跑 · ${hours(ageMinutes(item.last_ts, now))} 未動`,
      action: PARKED_TRIAGE_ACTION(item.work_id),
    }
  }
  return {
    lane: 'parked',
    reason: item.parked_at
      ? `park@${item.parked_at} · ${hours(ageMinutes(item.last_ts, now))} 未動`
      : `無 span 在跑、無人宣告完成 · ${hours(ageMinutes(item.last_ts, now))} 未動`,
    action: PARKED_TRIAGE_ACTION(item.work_id),
  }
}

function makeCard(
  item: WorkItem,
  stalls: Stall[],
  pending: PendingDecision[],
  now: number,
  baselines: Map<string, DurationBaseline>,
  kids: ChildProgress | null,
  kidArts: ChildArtifacts | null,
  mySpans: readonly Span[],
): BoardCard {
  const { lane, reason, action } = classify(item, stalls, pending, now, kids)
  return {
    work_id: item.work_id,
    lane,
    lane_label: laneLabel(lane),
    title: cardTitle(item),
    state: item.state,
    origin_ref: item.origin_ref,
    origin_kind: item.origin_kind,
    reason,
    action,
    age_minutes: ageMinutes(item.last_ts, now),
    last_ts: item.last_ts,
    stalls,
    pending_decisions: pending,
    parked_at: item.parked_at,
    done_ts: item.done_ts,
    verification: item.verification,
    artifacts: item.artifacts,
    artifact_waiver: item.artifact_waiver,
    eta: etaFor(item, baselines, now),
    parent_work_id: item.parent_work_id,
    children: kids,
    child_artifacts: kidArts,
    dispatches: dispatchesOf(mySpans),
    progress: progressOf(mySpans),
  }
}

/**
 * One card for one work item, IGNORING the entry threshold.
 *
 * The threshold answers "does this deserve a column on a page nobody asked to be long"; a reader
 * who named a work id has already asked. Returning null there would make the dossier of a
 * deliberately unnamed change — R2's whole category — report `lane: null`, which reads as a work
 * item with no state rather than as one the board chose not to list.
 */
export function cardFor(
  item: WorkItem,
  stalls: Stall[],
  spans: Span[],
  { now = Date.now(), items = [] }: { now?: number; items?: readonly WorkItem[] } = {},
): BoardCard {
  const mine = stalls.filter((s) => s.work_id === item.work_id)
  const pending = pendingDecisionsByWork(spans, now).get(item.work_id) ?? []
  // `items` is what the derived estimate is derived FROM. A caller that has only one work item in
  // hand gets 「估不出來（N=0）」, which is the truthful answer for a reader holding no history —
  // NEVER a silent blank, and NEVER a median over a population of one. The same argument carries
  // the child counts: a caller holding one work item sees `children: null`, which reads as「沒有
  // 子卡」 and is exactly right for the set it was handed.
  return makeCard(
    item,
    mine,
    pending,
    now,
    durationBaselines(items),
    childProgress(items).get(item.work_id) ?? null,
    childArtifacts(items).get(item.work_id) ?? null,
    spans.filter((s) => s.work_id === item.work_id),
  )
}

/**
 * Split one lane's cards into named work and piles of residue.
 *
 * A card is residue when it has no name at all — `title === null`, i.e. `isNamed` was false and
 * the card got in on "needs eyes" alone. That predicate is deliberate rather than convenient: an
 * anonymous card cannot be recognised, cannot be searched for, and cannot be resumed; the only
 * thing a reader can do with it is clear it. Named blocked work is the opposite — it has a thing
 * to go back to — so it stays as individual cards.
 *
 * Piles are keyed by `shape × substrate` because that pair is exactly what decides the command:
 * `unharvested·herdr` reclaims, `in-flight-overdue·pi` closes, and mixing them into one pile
 * would produce a copy button whose lines do different things.
 */
function clusterResidue(cards: BoardCard[]): { named: BoardCard[]; residue: ResidueCluster[] } {
  const named: BoardCard[] = []
  const piles = new Map<string, ResidueCluster>()
  for (const card of cards) {
    if (card.title !== null) {
      named.push(card)
      continue
    }
    // The same stall `classify` spoke for, so the heading and the card agree. A residue card with
    // no stall at all is real — the 10 anonymous `failed` runs measured 2026-08-28 — and it gets
    // its own pile rather than being dropped for not fitting the shape vocabulary.
    const worst = worstStall(card.stalls.filter(isBlockingStall))
    const shape = worst?.shape ?? null
    const substrate = worst?.substrate ?? 'unknown'
    const key = `${shape ?? 'failed-no-stall'}·${substrate}`
    const held = piles.get(key) ?? {
      key,
      shape,
      substrate,
      cards: [],
      oldest_minutes: 0,
      actions: '',
      pane_ids: [],
    }
    held.cards.push(card)
    held.oldest_minutes = Math.max(held.oldest_minutes, card.age_minutes)
    if (worst?.pane_id && !held.pane_ids.includes(worst.pane_id)) held.pane_ids.push(worst.pane_id)
    piles.set(key, held)
  }
  for (const pile of piles.values()) {
    pile.cards.sort((a, b) => b.age_minutes - a.age_minutes)
    // Built after the sort so the copied lines arrive in the same order the reader sees them.
    pile.actions = pile.cards
      .map((c) => c.action)
      .filter((a): a is string => Boolean(a))
      .join('\n')
  }
  // Biggest pile first: it is both the most cards cleared per decision and, being a pile, the
  // most likely to be one systemic cause rather than N separate ones.
  const residue = [...piles.values()].toSorted(
    (a, b) => b.cards.length - a.cards.length || b.oldest_minutes - a.oldest_minutes,
  )
  return { named, residue }
}

/**
 * The board. Pure function of the fold plus `now`; the three inputs are exactly what every other
 * view already computed (`buildWorkItems`, `findStalls`, `foldSpans`), so no caller has to build
 * a fourth thing to render a fifth view.
 */
export function buildBoardLanes(
  workItems: WorkItem[],
  stalls: Stall[],
  spans: Span[],
  {
    now = Date.now(),
    hiddenRecentDays = HIDDEN_RECENT_DAYS,
  }: { now?: number; hiddenRecentDays?: number } = {},
): Board {
  const stallsByWork = new Map<string, Stall[]>()
  for (const s of stalls) {
    const held = stallsByWork.get(s.work_id) ?? []
    held.push(s)
    stallsByWork.set(s.work_id, held)
  }
  const pendingByWork = pendingDecisionsByWork(spans, now)
  // Computed once for the whole board: the baseline is a property of the population, and
  // recomputing it per card would make a 500-work board quadratic for an identical answer.
  const baselines = durationBaselines(workItems)
  // One pass each, for the same reason as the baselines: both are properties of the population.
  const kidsByParent = childProgress(workItems)
  const kidArtsByParent = childArtifacts(workItems)
  const spansByWork = new Map<string, Span[]>()
  for (const s of spans) {
    const held = spansByWork.get(s.work_id) ?? []
    held.push(s)
    spansByWork.set(s.work_id, held)
  }

  const groups: BoardLaneGroup[] = BOARD_LANES.map((l) => ({
    lane: l.lane,
    label: l.label,
    cards: [],
    named: [],
    residue: [],
  }))
  const byLane = new Map(groups.map((g) => [g.lane, g]))
  const hiddenCutoff = new Date(now - hiddenRecentDays * 86_400_000).toISOString()
  const hidden = {
    count: 0,
    recent: 0,
    recent_days: hiddenRecentDays,
    by_state: {} as Record<string, number>,
  }

  for (const item of workItems) {
    const itemStalls = stallsByWork.get(item.work_id) ?? []
    if (!passesEntryThreshold(item, itemStalls)) {
      hidden.count += 1
      if (item.last_ts >= hiddenCutoff) hidden.recent += 1
      hidden.by_state[item.state] = (hidden.by_state[item.state] ?? 0) + 1
      continue
    }
    const pending = pendingByWork.get(item.work_id) ?? []
    const card = makeCard(
      item,
      itemStalls,
      pending,
      now,
      baselines,
      kidsByParent.get(item.work_id) ?? null,
      kidArtsByParent.get(item.work_id) ?? null,
      spansByWork.get(item.work_id) ?? [],
    )
    byLane.get(card.lane)?.cards.push(card)
  }

  // Oldest first inside a lane: the thing that has been waiting longest is the thing a reader
  // should see first, and "newest on top" would bury exactly the rows a stall list is for.
  for (const g of groups) g.cards.sort((a, b) => b.age_minutes - a.age_minutes)

  // Clustering runs on 受阻 only. Every other lane keeps `residue` empty and `named === cards`:
  // 擱置's 27 are all named, and piling up 待你 would hide questions behind a fold.
  for (const g of groups) {
    if (g.lane === 'blocked') {
      const split = clusterResidue(g.cards)
      g.named = split.named
      g.residue = split.residue
    } else {
      g.named = g.cards
    }
  }

  const counts = Object.fromEntries(groups.map((g) => [g.lane, g.cards.length])) as Record<
    BoardLane,
    number
  >
  return { groups, counts, hidden, total_work_items: workItems.length }
}

/** Cards across every lane, in lane priority then age order — what a flat renderer iterates. */
export function boardCards(board: Board): BoardCard[] {
  return board.groups.flatMap((g) => g.cards)
}
