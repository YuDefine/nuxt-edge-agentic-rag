// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/pm-view.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/pm-view.ts
// clade flow PM view — the second PROJECTION of the board, not a second board.
//
// WHY THIS EXISTS. `/board` answers an operator's question: "who has to move, and what do they
// run". Its entry threshold is tuned for that — an anonymous `orphan-<hex>` with a 52h stall is
// the single most important row on the page, because the stall is the thing needing clearing.
// A PM or a client asks a different question: "what are we building, how far along, and what is
// waiting on me". Measured 2026-08-29 the same threshold answers that question with three lanes
// of `orphan-<hex>` and the named work folded into an uncounted "擱置 29".
//
// One threshold cannot be right for both readers. That is an argument for a second PROJECTION,
// and NEVER for a second lane derivation: this file takes the `Board` that `buildBoardLanes`
// already produced and re-groups it. It cannot disagree with `/board` about which lane a work
// item is in, because it never decides that — it reads the decision. Anything that wants to
// change a lane changes `board.ts`; anything that wants to change what a PM sees changes here.
//
// READ-ONLY, like everything else on this spine. No store, no cache, no fourth data model.

import type { Board, BoardCard, BoardLane } from './board.ts'
import type { Span, WorkItem, WorkParentState } from './spine.ts'
import { indexWorkItems, workParentState } from './spine.ts'

/**
 * The PM's vocabulary. A pure function of the lane the board already assigned plus, for closed
 * work, the terminal verdict — so a reader comparing the two pages sees one translation, never a
 * second opinion.
 *
 * `parked` deliberately translates to 靜置 and carries "無人宣告完成" in its own line rather than
 * being rounded up to 進行中. Reporting stalled work as in progress is the one lie a status board
 * can tell that nobody catches, because it is the answer everyone hoped for.
 */
export type PmStatus = 'in-progress' | 'awaiting-you' | 'blocked' | 'idle' | 'delivered' | 'dropped'

export const PM_STATUS_LABEL: Record<PmStatus, string> = {
  'in-progress': '進行中',
  'awaiting-you': '等待你確認',
  blocked: '受阻',
  idle: '靜置',
  delivered: '已交付',
  dropped: '已作廢',
}

/** Display order — what a PM scans top-down. Deliberately NOT the board's operator priority. */
export const PM_STATUS_ORDER: PmStatus[] = [
  'awaiting-you',
  'in-progress',
  'blocked',
  'idle',
  'delivered',
  'dropped',
]

/**
 * Size, entirely derived. NEVER add a hand-filled `size` field: the one thing worse than no
 * estimate is an estimate nobody updated, and on a fleet where most work is opened by an agent
 * there is no moment at which a human would fill it in honestly.
 */
export interface PmScale {
  /** Spans recorded against this work item — how much activity it actually took. */
  spans: number
  /** Distinct substrates (herdr / pi / codex / …) — how many kinds of machinery it needed. */
  substrates: number
  /** Distinct actors — how many separate workers touched it. */
  actors: number
  /** first_ts → last_ts in days. Elapsed, NOT effort: a 30-day card may be 30 days of waiting. */
  elapsed_days: number
  /**
   * Direct children — work items linked under this one. The one scale figure that is about
   * BREADTH rather than effort, and the reason an initiative reads as big even when the initiative
   * card itself carries two spans. NEVER a replacement for `spans`: a parent with ten children and
   * no activity of its own is a plan, not progress, and the two numbers say which.
   */
  children: number
  /**
   * `S` / `M` / `L`, by span-count quantile WITHIN THIS VIEW.
   *
   * Relative by construction, and it says so: there is no absolute scale for "how big is a piece
   * of work" on a fleet whose work items range from a typo fix to a fleet-wide migration. The
   * cost is that a tier can move when the set changes — which is why the raw numbers above travel
   * with it and every renderer MUST show at least one of them. NEVER render the tier alone.
   */
  tier: 'S' | 'M' | 'L'
}

export interface PmCard {
  work_id: string
  /** MUST be non-null: an unnamed work item does not enter this view at all. See `buildPmView`. */
  title: string
  status: PmStatus
  status_label: string
  /** The board's own one-liner for why this card is where it is. Passed through, never reworded. */
  reason: string
  origin_ref: string | null
  origin_kind: string | null
  /** Raw parent id from the fold. Kept even when it resolves to nothing — see `parent_state`. */
  parent_work_id: string | null
  /**
   * What that id resolves to HERE. `dangling` and `cycle` are the two a renderer MUST show: a
   * parent in another repo's spine and a typo look identical locally, and a card silently drawn
   * as a root makes the typo permanently invisible — nothing local will ever resolve it, and no
   * later signal names it again.
   */
  parent_state: WorkParentState
  repo: string | null
  /**
   * Evidence of completion, when completion was claimed. Null while nothing has been claimed;
   * the empty string is NEVER used — a renderer must be able to tell "not finished yet" from
   * "said finished, showed nothing", and those want different words on the page.
   */
  verification: string | null
  /** True when the work claims done with no evidence attached — rendered as such, not hidden. */
  unverified_claim: boolean
  last_ts: string
  age_minutes: number
  scale: PmScale
}

/**
 * One initiative: every card sharing an `origin_ref`.
 *
 * This is the PROVISIONAL hierarchy. `origin_ref` points at prose (a TD entry, a Notion page, a
 * `tasks/` file) rather than at an entity with a state of its own, so a group here can say what
 * its members are but not whether IT is finished. That is a real limit and this type does not
 * paper over it: there is no group-level status field. The real hierarchy is a `parent_work_id`
 * carried by a `work.link` event, which is a schema change and a separate step.
 *
 * A group of ONE is not an initiative, it is a card with extra chrome, so singletons are folded
 * into the ungrouped bucket instead of each getting a heading. Measured 2026-08-29 that is every
 * group: all 32 named origins were `wt:<slug>` minted by `wt-helper add`, one per work item, so
 * grouping by origin produced 33 groups of 1. The fold keeps this view honest while nothing
 * shares an origin, and starts grouping on its own the moment something does.
 */
export interface PmGroup {
  /**
   * What this heading MEANS, kept as a field because the three cases are not interchangeable and
   * a renderer that guesses from the key's shape will eventually guess wrong.
   *
   * `parent` is the real hierarchy: a work item other work items were linked under. `origin` is
   * the fallback — work that shares where it was born but was never linked. `none` is the
   * ungrouped bucket.
   */
  kind: 'parent' | 'origin' | 'none'
  /** The parent's `work_id`, the shared `origin_ref`, or null for the ungrouped bucket. */
  key: string | null
  /** The parent's own title, the short origin form, or 未分類. */
  label: string
  /**
   * The parent's own card, when the parent is itself admitted to this view.
   *
   * It stays inside `cards` as well rather than being lifted out: an initiative is an ORDINARY
   * work item, with its own status, its own scale and its own claim to being finished, and a
   * heading is not a place a reader looks for any of those. This field only says which of the
   * cards is the one the heading is named after.
   */
  lead_work_id: string | null
  cards: PmCard[]
  /** Status counts within the group — a one-line answer to "how is this initiative doing". */
  counts: Record<PmStatus, number>
  /** Oldest card's age. What makes a quiet group visible next to a busy one. */
  oldest_minutes: number
}

export interface PmView {
  groups: PmGroup[]
  counts: Record<PmStatus, number>
  cards: number
  /**
   * What this view does NOT show, as a number rather than as silence.
   *
   * `unnamed` is agent activity that never got a name — real work, invisible here on purpose,
   * and still fully visible on `/board` where clearing it is somebody's job. Printing the count
   * is the difference between a filtered view and a view that pretends the fleet is smaller than
   * it is. NEVER drop this line from a renderer.
   */
  excluded: { unnamed: number; total_work_items: number }
  /**
   * True when NOTHING shares an origin — every card is its own island and the grouping axis is
   * carrying no information. A renderer MUST say so rather than presenting a flat list as though
   * it were a considered hierarchy: "we have no initiatives" and "we never recorded any" look
   * identical on the page, and only one of them is a project-management fact.
   */
  no_shared_origin: boolean
  /**
   * True when NOT ONE admitted card has a parent registered — the hierarchy axis is empty, not
   * flat. Same honesty as `no_shared_origin` one level up: "this project has no sub-structure"
   * and "nobody has ever run `flow link`" produce an identical page, and only one of them is a
   * fact about the work.
   */
  no_hierarchy: boolean
}

const EMPTY_COUNTS = (): Record<PmStatus, number> => ({
  'in-progress': 0,
  'awaiting-you': 0,
  blocked: 0,
  idle: 0,
  delivered: 0,
  dropped: 0,
})

/** The lane → status map. Closed splits on the terminal verdict; everything else is 1:1. */
function statusOf(card: BoardCard): PmStatus {
  const byLane: Record<BoardLane, PmStatus> = {
    'awaiting-you': 'awaiting-you',
    blocked: 'blocked',
    'in-flight': 'in-progress',
    parked: 'idle',
    closed: card.state === 'dropped' ? 'dropped' : 'delivered',
  }
  return byLane[card.lane]
}

function elapsedDays(first: string, last: string): number {
  const a = Date.parse(first)
  const b = Date.parse(last)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round(((b - a) / 86_400_000) * 10) / 10)
}

/**
 * p50 / p80 of span counts across the admitted set, as the S/M/L cut points.
 *
 * Quantiles rather than fixed thresholds because the distribution is what it is: on 2026-08-29
 * the named set ran from 1 span to well over 100, and any constant would have put ~everything in
 * one bucket. Fewer than three cards makes a quantile meaningless, so the tier collapses to `M`
 * for everyone — an honest "we cannot rank three things" rather than a confident ranking of noise.
 */
function tierCuts(spanCounts: number[]): { p50: number; p80: number } | null {
  if (spanCounts.length < 3) return null
  const sorted = spanCounts.toSorted((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return { p50: at(0.5), p80: at(0.8) }
}

function tierOf(spans: number, cuts: { p50: number; p80: number } | null): 'S' | 'M' | 'L' {
  if (!cuts) return 'M'
  if (spans > cuts.p80) return 'L'
  if (spans > cuts.p50) return 'M'
  return 'S'
}

/** Short display form of an origin for a group heading: the tail, not the whole path. */
function groupLabel(ref: string | null): string {
  if (!ref) return '未分組單件（沒有其他工作共用同一個來源）'
  const cut = ref.indexOf(':')
  if (cut === -1) return ref
  const rest = ref.slice(cut + 1)
  const tail = rest.includes('/') ? (rest.split('/').pop() ?? rest) : rest
  return `${ref.slice(0, cut)}:${tail}`
}

/**
 * Heading for a parent group whose parent is NOT itself admitted — an initiative that never got a
 * title of its own. Falls back through the same order `cardTitle` uses, and ends at the raw id
 * rather than at 未分類: the children genuinely do share a parent, and saying so with an ugly id
 * is more useful than implying they share nothing.
 */
function parentLabel(key: string | null, byWorkId: Map<string, WorkItem>): string {
  if (!key) return '未分組單件（沒有其他工作共用同一個來源）'
  const parent = byWorkId.get(key)
  return parent?.title ?? parent?.slug ?? parent?.origin_ref ?? key
}

/** Work items carry `repo` only under the fleet aggregation; local runs have the field absent. */
type MaybeFleetWorkItem = WorkItem & { repo?: string | null }

/**
 * The PM view.
 *
 * `board` is the already-classified board — this function derives no lane. `workItems` and
 * `spans` supply only the things a card needs that a `BoardCard` does not carry: the repo, the
 * first timestamp, and the substrate/actor spread behind the scale figures.
 */
export function buildPmView(board: Board, workItems: MaybeFleetWorkItem[], spans: Span[]): PmView {
  const itemById = new Map<string, MaybeFleetWorkItem>()
  for (const w of workItems) if (!itemById.has(w.work_id)) itemById.set(w.work_id, w)

  const spread = new Map<string, { substrates: Set<string>; actors: Set<string> }>()
  for (const s of spans) {
    const held = spread.get(s.work_id) ?? { substrates: new Set(), actors: new Set() }
    held.substrates.add(s.substrate)
    held.actors.add(s.actor)
    spread.set(s.work_id, held)
  }

  // The entry threshold, and the whole difference between this view and the board: a card a
  // reader cannot recognise is not a status report, it is a task for whoever maintains the fleet.
  const admitted = board.groups
    .flatMap((g) => g.cards)
    .filter((c): c is BoardCard & { title: string } => c.title !== null)

  const cuts = tierCuts(admitted.map((c) => itemById.get(c.work_id)?.spans ?? 0))

  // Parentage is resolved against EVERY work item, not just the admitted ones: an initiative whose
  // own card never got a title is still a real parent, and treating its id as unresolvable here
  // would scatter its children as roots while the fold plainly knows where they belong.
  const byWorkId = indexWorkItems(workItems)
  const childCount = new Map<string, number>()
  for (const w of workItems) {
    if (w.parent_work_id)
      childCount.set(w.parent_work_id, (childCount.get(w.parent_work_id) ?? 0) + 1)
  }

  const cards: PmCard[] = admitted.map((c) => {
    const item = itemById.get(c.work_id)
    const sp = spread.get(c.work_id)
    const spanCount = item?.spans ?? 0
    const status = statusOf(c)
    const parentState: WorkParentState = item ? workParentState(item, byWorkId) : 'none'
    return {
      work_id: c.work_id,
      title: c.title,
      status,
      status_label: PM_STATUS_LABEL[status],
      reason: c.reason,
      origin_ref: c.origin_ref,
      origin_kind: c.origin_kind,
      parent_work_id: item?.parent_work_id ?? null,
      parent_state: parentState,
      repo: item?.repo ?? null,
      verification: c.verification,
      unverified_claim: Boolean(c.done_ts) && !c.verification,
      last_ts: c.last_ts,
      age_minutes: c.age_minutes,
      scale: {
        spans: spanCount,
        substrates: sp?.substrates.size ?? 0,
        actors: sp?.actors.size ?? 0,
        elapsed_days: item ? elapsedDays(item.first_ts, item.last_ts) : 0,
        children: childCount.get(c.work_id) ?? 0,
        tier: tierOf(spanCount, cuts),
      },
    }
  })

  // HIERARCHY FIRST, origin as the fallback. A registered parent is a stated fact about where the
  // work belongs; a shared origin is an inference from where two things were born. When both are
  // available the stated one wins, and the origin stays on the card so nothing is lost.
  //
  // A parent lands in its OWN children's group rather than in a group of its own, which is what
  // makes the heading and the initiative card the same thing. The tree is therefore rendered two
  // levels deep: a grandchild groups under its direct parent, not under the top of its chain.
  // Deeper nesting is representable on the spine and deliberately not rendered here — a PM page
  // that indents four times answers "what are we building" worse, not better.
  const keyOf = (card: PmCard): { kind: PmGroup['kind']; key: string | null } => {
    if (card.parent_state === 'resolved' && card.parent_work_id) {
      return { kind: 'parent', key: card.parent_work_id }
    }
    if ((childCount.get(card.work_id) ?? 0) > 0) return { kind: 'parent', key: card.work_id }
    return { kind: card.origin_ref ? 'origin' : 'none', key: card.origin_ref }
  }

  const byKey = new Map<string | null, { kind: PmGroup['kind']; cards: PmCard[] }>()
  for (const card of cards) {
    const { kind, key } = keyOf(card)
    const held = byKey.get(key) ?? { kind, cards: [] }
    held.cards.push(card)
    byKey.set(key, held)
  }

  // Singletons are not initiatives — see PmGroup. They join the null bucket, keeping their own
  // `origin_ref` and `parent_work_id` on the card so nothing about the card is lost by the fold.
  // This applies to a parent group of one as well: an initiative whose only member is itself is
  // an ordinary card, and giving it a heading of its own says otherwise.
  const singletons: PmCard[] = []
  const shared = new Map<string | null, { kind: PmGroup['kind']; cards: PmCard[] }>()
  for (const [key, held] of byKey) {
    if (key !== null && held.cards.length === 1) singletons.push(held.cards[0])
    else shared.set(key, held)
  }
  if (singletons.length > 0) {
    const bucket = shared.get(null) ?? { kind: 'none' as const, cards: [] }
    shared.set(null, { kind: 'none', cards: [...bucket.cards, ...singletons] })
  }

  const groups: PmGroup[] = [...shared.entries()].map(([key, held]) => {
    const groupCards = held.cards
    const counts = EMPTY_COUNTS()
    for (const c of groupCards) counts[c.status] += 1
    const lead = held.kind === 'parent' ? (groupCards.find((c) => c.work_id === key) ?? null) : null
    return {
      kind: held.kind,
      key,
      lead_work_id: lead?.work_id ?? null,
      label: held.kind === 'parent' ? (lead?.title ?? parentLabel(key, byWorkId)) : groupLabel(key),
      // Inside a group, the order a PM reads: what needs them, then what is moving, then the rest.
      // The lead first, then what a PM reads: what needs them, then what is moving, then the rest.
      // The initiative card leads regardless of its own status — it is the row the heading names,
      // and a reader who has to hunt for it down the list reads the group as a flat pile.
      cards: groupCards.toSorted(
        (a, b) =>
          Number(b.work_id === key) - Number(a.work_id === key) ||
          PM_STATUS_ORDER.indexOf(a.status) - PM_STATUS_ORDER.indexOf(b.status) ||
          b.age_minutes - a.age_minutes,
      ),
      counts,
      oldest_minutes: groupCards.reduce((n, c) => Math.max(n, c.age_minutes), 0),
    }
  })

  // Ungrouped last, and never dropped: it is where a work item with no registered origin lands,
  // and burying it would make "we never wrote down why we are doing this" the invisible category.
  groups.sort((a, b) => {
    if (a.key === null) return 1
    if (b.key === null) return -1
    const aNeeds = a.counts['awaiting-you'] + a.counts.blocked
    const bNeeds = b.counts['awaiting-you'] + b.counts.blocked
    return bNeeds - aNeeds || b.oldest_minutes - a.oldest_minutes
  })

  const counts = EMPTY_COUNTS()
  for (const c of cards) counts[c.status] += 1

  return {
    groups,
    counts,
    cards: cards.length,
    excluded: {
      unnamed: board.total_work_items - cards.length,
      total_work_items: board.total_work_items,
    },
    no_shared_origin: groups.every((g) => g.kind !== 'origin'),
    no_hierarchy: cards.every((c) => c.parent_work_id === null),
  }
}

// ── Renderers ───────────────────────────────────────────────────────────────
//
// These live here rather than in `brief.ts` because `brief.ts` is built around a byte budget:
// its readers are agents piping an overview into their own context, so every render there goes
// through `fit`/`hardCap`. The PM view's readers are a person at a terminal and a page, neither
// of which has a context window — importing that machinery would add a truncation path with no
// reader that needs it, and a truncated status report is worse than a long one.

function hoursOf(minutes: number): string {
  return minutes >= 48 * 60 ? `${(minutes / 1440).toFixed(1)}d` : `${(minutes / 60).toFixed(1)}h`
}

/** The scale figures as one parenthetical. NEVER the tier alone — see `PmScale.tier`. */
function scaleLine(c: PmCard): string {
  const bits = [`${c.scale.spans} span`]
  if (c.scale.children > 0) bits.push(`${c.scale.children} 件子工作`)
  if (c.scale.substrates > 1) bits.push(`${c.scale.substrates} 種載體`)
  if (c.scale.actors > 1) bits.push(`${c.scale.actors} 個執行者`)
  if (c.scale.elapsed_days >= 1) bits.push(`歷時 ${c.scale.elapsed_days}d`)
  return `${c.scale.tier} · ${bits.join(' · ')}`
}

/**
 * The verification line for a delivered / claimed card.
 *
 * Three distinct outputs on purpose: evidence, an explicit "claimed with nothing attached", and
 * nothing at all. Collapsing the middle case into the third is how an unevidenced claim becomes
 * indistinguishable from work that never claimed anything.
 */
function verificationLine(c: PmCard): string | null {
  if (c.verification) return `驗證：${c.verification}`
  if (c.unverified_claim) return '驗證：宣告完成但未附驗證'
  return null
}

/**
 * The parent line for a card whose registered parent cannot be drawn here.
 *
 * `resolved` and `none` print nothing — the first is already expressed by which group the card is
 * in, the second is the ordinary case. The other two MUST print: a dangling parent is either a
 * teammate's repo or a typo, and a cycle is two legal re-parents that met. Both look exactly like
 * a root once drawn, which is how either survives forever.
 */
function parentLine(c: PmCard): string | null {
  if (c.parent_state === 'dangling')
    return `上層 ${c.parent_work_id}（不在本地 spine，可能在別的 repo）`
  if (c.parent_state === 'cycle') return `上層 ${c.parent_work_id}（歸屬成環，需要有人重新指定）`
  return null
}

export function renderPmView(view: PmView): string {
  const out: string[] = []
  const summary = PM_STATUS_ORDER.filter((s) => view.counts[s] > 0)
    .map((s) => `${PM_STATUS_LABEL[s]} ${view.counts[s]}`)
    .join(' · ')
  out.push(`專案視圖: ${summary || '（無有名工作）'}`)
  out.push(
    `${view.cards} 件有名工作 / 共 ${view.excluded.total_work_items} 件 · ` +
      `${view.excluded.unnamed} 件未命名的 agent 活動不在本頁（見 /board）`,
  )
  if (view.no_hierarchy && view.cards > 1) {
    out.push(
      '⚠ 沒有任何一件工作登記過上層歸屬（flow link），所以本頁的層級是空的而不是扁的 —— ' +
        '這是「沒有人跑過 flow link」，不是「這些工作沒有上層」。',
    )
  }
  // Only when NEITHER axis carries anything. Printing "本頁沒有可用的專案分組" next to a page that
  // is visibly grouped by parent would be a false statement about what the reader is looking at —
  // the origin axis being empty stops mattering the moment the hierarchy is not.
  if (view.no_shared_origin && view.no_hierarchy && view.cards > 1) {
    out.push('⚠ 也沒有任何兩件工作共用同一個來源（origin），所以本頁沒有任何可用的分組軸。')
  }
  for (const g of view.groups) {
    const needs = g.counts['awaiting-you'] + g.counts.blocked
    out.push('')
    const axis = g.kind === 'parent' ? '' : g.kind === 'origin' ? '（同來源）' : ''
    out.push(`▍${g.label}${axis}  (${g.cards.length} 件${needs > 0 ? ` · ${needs} 件需要你` : ''})`)
    for (const c of g.cards) {
      out.push(`  ${c.work_id === g.lead_work_id ? '▸' : ' '} [${c.status_label}] ${c.title}`)
      out.push(`      ${c.reason}`)
      const p = parentLine(c)
      if (p) out.push(`      ${p}`)
      const v = verificationLine(c)
      if (v) out.push(`      ${v}`)
      out.push(
        `      ${scaleLine(c)} · 最後活動 ${hoursOf(c.age_minutes)} 前` +
          `${c.repo ? ` · ${c.repo}` : ''}` +
          `${g.key === null && c.origin_ref ? ` · 來源 ${groupLabel(c.origin_ref)}` : ''}` +
          ` · ${c.work_id}`,
      )
    }
  }
  out.push('')
  out.push('指令: flow brief（operator 視圖）｜flow brief --work-id <W>（單件細節）')
  return `${out.join('\n')}\n`
}

export function pmViewJson(view: PmView): string {
  return `${JSON.stringify(view)}\n`
}
