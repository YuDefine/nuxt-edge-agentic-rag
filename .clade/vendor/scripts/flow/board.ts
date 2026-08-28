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
    return {
      lane: 'awaiting-you',
      reason: `宣告完成待驗收 · 驗證: ${item.verification ? clamp(item.verification, 72) : '(none)'}`,
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
      reason: `${item.in_flight} 個 span 進行中 · 最後事件 ${hours(ageMinutes(item.last_ts, now))} 前`,
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
): BoardCard {
  const { lane, reason, action } = classify(item, stalls, pending, now)
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
  { now = Date.now() }: { now?: number } = {},
): BoardCard {
  const mine = stalls.filter((s) => s.work_id === item.work_id)
  const pending = pendingDecisionsByWork(spans, now).get(item.work_id) ?? []
  return makeCard(item, mine, pending, now)
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
    const card = makeCard(item, itemStalls, pending, now)
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
