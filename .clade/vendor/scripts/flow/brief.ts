// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/brief.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/brief.ts
// clade flow brief — the agent-side render of `board.ts`.
//
// An agent opening a session re-derives "where is everything" by reading HANDOFF.md, docs/
// tech-debt.md, tasks/, and `git log`. That sweep costs tens of thousands of tokens, is prose
// (so its past tense cannot be trusted), and produces an answer the spine already holds. This
// prints the same board a human reads, as text, under a budget.
//
// THE BUDGET IS CODE, NOT A CONVENTION. Both renders are truncated to a hard byte ceiling and a
// test asserts it against a synthetic 500-work spine. A budget with no mechanical enforcer is
// the `answeredAt` shape: 39 rows all null, a rule everybody agreed with and nothing applied.
// Truncation is always NAMED ("…另 N 件"), because a silently short list and a genuinely short
// list are the same page, and an agent cannot tell them apart the way a person might.
//
// READ-ONLY, like everything else that reads the spine.

import {
  type Board,
  type BoardCard,
  type BoardLane,
  cardFor,
  laneLabel,
  shortOrigin,
} from './board.ts'
import { artifactsOf } from './nodes/lib/artifacts.ts'
import type { FlowEvent, Span, WorkItem } from './spine.ts'
import type { Stall } from './stall.ts'

// Both ceilings are STRICT: every render below is `< maxBytes`, never `<=`. The acceptance check
// people actually run is `flow brief --json | wc -c` against the number, and an output that lands
// exactly on it reads as a failure to anyone comparing with `<`.
/** ≈2,000 tokens. The overview is read at session start, on every session. */
export const OVERVIEW_MAX_BYTES = 8192
/** ≈1,500 tokens. One work item's dossier, read when a successor picks that work up. */
export const DOSSIER_MAX_BYTES = 6144

/**
 * How many delegation legs and session hops the TEXT dossier lists before it summarises the rest.
 *
 * Dropping whole rows with a named "…另 N 筆" is how a text render should shrink; `hardCap` slicing
 * mid-line is the backstop, and a backstop that fires routinely is just a truncated file.
 */
const TEXT_LIST_MAX = 10

const FULL_SET_HINT = 'node vendor/scripts/flow/flow.ts status --json'

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`
}

/**
 * Hard ceiling, applied last.
 *
 * Every render below trims itself by dropping whole cards, which is the readable way to shrink.
 * This is the backstop for the case that cannot be trimmed that way — one pathologically long
 * field on a single card — and it exists so the ceiling is a fact about the output rather than a
 * property of the inputs the caller happens to have.
 */
function hardCap(text: string, maxBytes: number): string {
  if (bytes(text) < maxBytes) return text
  const note = `\n…（超出上界，全量：${FULL_SET_HINT}）\n`
  let cut = text.slice(0, maxBytes - bytes(note))
  while (bytes(cut) + bytes(note) >= maxBytes) cut = cut.slice(0, -16)
  return cut + note
}

/** Lanes the overview lists card-by-card, in the order it lists them. */
const LISTED: BoardLane[] = ['awaiting-you', 'blocked', 'in-flight']
/**
 * Which lane gives up a card first when the render is over budget: least urgent first.
 *
 * 已收 and 擱置 lead because they are the two lanes nobody opens a board to read — and because
 * they are the two the text render never lists card-by-card, so trimming them costs the JSON
 * reader the least. 待你 is last by construction: the budget must never buy its silence.
 */
const TRIM_ORDER: BoardLane[] = ['closed', 'parked', 'in-flight', 'blocked', 'awaiting-you']

function cardLines(card: BoardCard, actionMax: number): string[] {
  const name = card.title ?? '(無名)'
  const lines = [`  ${card.work_id}  ${name}  ${hours(card.age_minutes)}`, `      ${card.reason}`]
  if (card.action) lines.push(`      → ${clamp(card.action, actionMax)}`)
  return lines
}

function countsLine(board: Board): string {
  return board.groups.map((g) => `${g.label} ${g.cards.length}`).join(' · ')
}

function renderOverviewAt(board: Board, limits: Map<BoardLane, number>): string {
  const cards = board.groups.reduce((n, g) => n + g.cards.length, 0)
  const out: string[] = [
    `board: ${countsLine(board)}`,
    `卡 ${cards} / 工作 ${board.total_work_items} · 隱藏 ${board.hidden.count} 件無名靜置活動（近 ${board.hidden.recent_days} 天 ${board.hidden.recent} 件）`,
  ]
  for (const lane of LISTED) {
    const group = board.groups.find((g) => g.lane === lane)
    if (!group || group.cards.length === 0) continue
    const limit = limits.get(lane) ?? group.cards.length
    out.push('', `${group.label} (${group.cards.length})`)

    // Residue is summarised, never listed. An agent reading this at session start does not need
    // 21 near-identical unharvested lines to learn there are 21 of them — it needs the count, the
    // age, and the one command. The named cards below still get their full lines.
    for (const pile of group.residue) {
      const shape = pile.shape ?? 'failed-no-stall'
      out.push(
        `  ${shape}·${pile.substrate} — ${pile.cards.length} 件無名殘骸 · 最老 ${hours(pile.oldest_minutes)}`,
      )
      const first = pile.cards[0]?.action
      if (first) out.push(`      → ${clamp(first, 110)}`)
      if (pile.cards.length > 1) {
        out.push(`      （其餘 ${pile.cards.length - 1} 件同型；逐條指令見 /board 該群組的複製鈕）`)
      }
    }

    const listable = group.residue.length > 0 ? group.named : group.cards
    const shown = listable.slice(0, Math.max(0, limit))
    for (const card of shown) out.push(...cardLines(card, 110))
    const dropped = listable.length - shown.length
    if (dropped > 0) out.push(`  …另 ${dropped} 件（${FULL_SET_HINT}）`)
  }
  const parked = board.counts.parked ?? 0
  const closed = board.counts.closed ?? 0
  out.push('', `擱置 ${parked} · 已收 ${closed}（有名，本頁不逐條列；全量 ${FULL_SET_HINT}）`)
  out.push('指令: flow brief --work-id <W>｜flow status --stalled｜flow who｜flow pending')
  return `${out.join('\n')}\n`
}

/**
 * Fit a render under the ceiling by dropping cards, least urgent lane first.
 *
 * Greedy rather than proportional on purpose: the point of the budget is that 待你 survives it.
 * A proportional trim would shave the one lane a reader opened the page for.
 */
function fit<T>(
  board: Board,
  maxBytes: number,
  render: (limits: Map<BoardLane, number>) => T,
  size: (value: T) => number,
): T {
  const limits = new Map<BoardLane, number>(
    board.groups.map((g) => [g.lane, g.cards.length] as [BoardLane, number]),
  )
  let out = render(limits)
  let guard = 0
  while (size(out) >= maxBytes && guard < 10_000) {
    guard += 1
    const lane = TRIM_ORDER.find((l) => (limits.get(l) ?? 0) > 0)
    if (!lane) break
    limits.set(lane, (limits.get(lane) ?? 0) - 1)
    out = render(limits)
  }
  return out
}

export function renderOverview(board: Board, { maxBytes = OVERVIEW_MAX_BYTES } = {}): string {
  return hardCap(
    fit(board, maxBytes, (limits) => renderOverviewAt(board, limits), bytes),
    maxBytes,
  )
}

function compactCard(card: BoardCard) {
  return {
    work_id: card.work_id,
    lane: card.lane,
    title: card.title,
    state: card.state,
    origin_ref: card.origin_ref,
    reason: card.reason,
    action: card.action,
    age_minutes: card.age_minutes,
    last_ts: card.last_ts,
  }
}

/**
 * The JSON overview, under the same ceiling as the text one.
 *
 * Same budget deliberately: `--json` is the form an agent pipes into its own context, so it is
 * the one that most needs the cost bounded. Anything wanting the unbounded set asks the command
 * that never truncates (`flow status --json`), and every truncated lane says so in `truncated`.
 */
export function overviewJson(board: Board, { maxBytes = OVERVIEW_MAX_BYTES } = {}): string {
  const payload = fit(
    board,
    maxBytes,
    (limits) => {
      const truncated: Record<string, number> = {}
      const lanes = board.groups.map((g) => {
        const limit = limits.get(g.lane) ?? g.cards.length
        const shown = g.cards.slice(0, Math.max(0, limit))
        const dropped = g.cards.length - shown.length
        if (dropped > 0) truncated[g.lane] = dropped
        return {
          lane: g.lane,
          label: g.label,
          total: g.cards.length,
          cards: shown.map(compactCard),
        }
      })
      return {
        counts: board.counts,
        cards: board.groups.reduce((n, g) => n + g.cards.length, 0),
        total_work_items: board.total_work_items,
        hidden: board.hidden,
        lanes,
        truncated,
        full_set: FULL_SET_HINT,
      }
    },
    (value) => bytes(`${JSON.stringify(value)}\n`),
  )
  const line = `${JSON.stringify(payload)}\n`
  // NEVER hardCap a JSON render: a sliced object is invalid JSON, and the reader that would
  // have been told "truncated" gets a parse error instead. `fit` already dropped cards; if the
  // envelope alone still does not fit, the honest answer is the counts with no cards at all.
  return bytes(line) < maxBytes
    ? line
    : `${JSON.stringify({
        counts: board.counts,
        cards: board.groups.reduce((n, g) => n + g.cards.length, 0),
        total_work_items: board.total_work_items,
        hidden: board.hidden,
        lanes: [],
        truncated: board.counts,
        full_set: FULL_SET_HINT,
      })}\n`
}

// ---------------------------------------------------------------------------
// One work item's dossier
// ---------------------------------------------------------------------------

export interface DispatchLeg {
  span_id: string
  substrate: string
  actor: string
  label: string | null
  model: string | null
  effort: string | null
  provider: string | null
  route: string | null
  tier_basis: string | null
  table_row: string | null
  retry_of: string | null
  decision_origin: string | null
  duration_ms: number | null
  exit: number | null
  tokens: Record<string, number> | null
}

export interface SessionHop {
  session_id: string
  first_ts: string
  launcher: string | null
  mode: string | null
  relay: boolean | null
  pane_id: string | null
  actor: string | null
}

export interface DossierEvent {
  ts: string
  kind: string
  phase: string
  actor: string
  substrate: string
  outcome: string | null
}

export interface Dossier {
  work_id: string
  found: boolean
  title: string | null
  state: string | null
  lane: BoardLane | null
  lane_label: string | null
  reason: string | null
  action: string | null
  origin_ref: string | null
  age_minutes: number
  last_ts: string | null
  claim: { done_ts: string; verification: string | null; verified_by: string | null } | null
  terminal: { verdict: string; ts: string | null; reason: string | null } | null
  parked_at: string | null
  stalls: Stall[]
  pending_decisions: BoardCard['pending_decisions']
  sessions: SessionHop[]
  dispatches: DispatchLeg[]
  artifacts: { type: string; ref: string; repo?: string }[]
  events: DossierEvent[]
}

function ageOf(ts: string | null, now: number): number {
  if (!ts) return 0
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor((now - parsed) / 60_000))
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The fields a pi/codex dispatch already carries. Nothing here is collected; it is all payload. */
function dispatchLegs(spans: Span[]): DispatchLeg[] {
  const legs: DispatchLeg[] = []
  for (const s of spans) {
    const model = str(s.payload?.model)
    if (!model) continue
    const tokens = s.payload?.tokens
    legs.push({
      span_id: s.span_id,
      substrate: s.substrate,
      actor: s.actor,
      label: str(s.payload?.label),
      model,
      effort: str(s.payload?.effort),
      provider: str(s.payload?.provider),
      route: str(s.payload?.route),
      tier_basis: str(s.payload?.tier_basis),
      table_row: str(s.payload?.table_row),
      retry_of: str(s.payload?.retry_of),
      decision_origin: str(s.payload?.decision_origin),
      duration_ms: s.duration_ms ?? num(s.payload?.duration_ms),
      exit: num(s.payload?.exit),
      tokens: tokens && typeof tokens === 'object' ? (tokens as Record<string, number>) : null,
    })
  }
  return legs
}

/**
 * The session chain, joined on `session_id` — never on a work id stamped into a session record.
 *
 * A session spans many work items and a work item spans many sessions, so any rule that hangs a
 * session onto one work item attributes it wrongly for every other one. The join is the whole
 * mechanism, and it costs nothing: every span already carries the session that emitted it.
 */
function sessionHops(events: FlowEvent[]): SessionHop[] {
  const hops = new Map<string, SessionHop>()
  for (const e of events) {
    const sid = str(e.session_id)
    if (!sid) continue
    const held = hops.get(sid)
    if (!held) {
      hops.set(sid, {
        session_id: sid,
        first_ts: e.ts_utc,
        launcher: null,
        mode: null,
        relay: null,
        pane_id: null,
        actor: e.actor,
      })
    }
    if (e.kind === 'session_transport') {
      const hop = hops.get(sid) as SessionHop
      hop.launcher = hop.launcher ?? str(e.payload?.launcher)
      hop.mode = hop.mode ?? str(e.payload?.mode)
      hop.pane_id = hop.pane_id ?? str(e.payload?.pane_id)
      if (hop.relay === null && typeof e.payload?.relay === 'boolean') hop.relay = e.payload.relay
    }
  }
  return [...hops.values()].toSorted((a, b) => a.first_ts.localeCompare(b.first_ts))
}

export function buildDossier({
  workId,
  board,
  workItems,
  spans,
  stalls = [],
  events,
  now = Date.now(),
}: {
  workId: string
  board: Board
  workItems: WorkItem[]
  spans: Span[]
  stalls?: Stall[]
  events: FlowEvent[]
  now?: number
}): Dossier {
  const item = workItems.find((w) => w.work_id === workId) ?? null
  // The board's own card when it has one; otherwise the same card built off-board. A work item
  // the threshold hid is still a work item somebody asked about by name.
  const card =
    board.groups.flatMap((g) => g.cards).find((c) => c.work_id === workId) ??
    (item ? cardFor(item, stalls, spans, { now, items: workItems }) : null)
  const mine = spans.filter((s) => s.work_id === workId)
  const myEvents = events.filter((e) => e.work_id === workId)
  return {
    work_id: workId,
    found: item !== null,
    title: card?.title ?? null,
    state: item?.state ?? null,
    lane: card?.lane ?? null,
    lane_label: card ? laneLabel(card.lane) : null,
    reason: card?.reason ?? null,
    action: card?.action ?? null,
    origin_ref: item?.origin_ref ?? null,
    age_minutes: card?.age_minutes ?? ageOf(item?.last_ts ?? null, now),
    last_ts: item?.last_ts ?? null,
    claim: item?.done_ts
      ? { done_ts: item.done_ts, verification: item.verification, verified_by: item.verified_by }
      : null,
    terminal: item?.terminal
      ? { verdict: item.terminal, ts: item.terminal_ts, reason: item.terminal_reason }
      : null,
    parked_at: item?.parked_at ?? null,
    stalls: card?.stalls ?? [],
    pending_decisions: card?.pending_decisions ?? [],
    sessions: sessionHops(myEvents),
    dispatches: dispatchLegs(mine),
    artifacts: artifactsOf(mine),
    events: myEvents.slice(-10).map((e) => ({
      ts: e.ts_utc,
      kind: e.kind,
      phase: e.phase,
      actor: e.actor,
      substrate: e.substrate,
      outcome: e.outcome ?? null,
    })),
  }
}

function tokenLine(tokens: Record<string, number> | null): string {
  if (!tokens) return ''
  const parts = ['input', 'cached_input', 'output', 'reasoning']
    .filter((k) => typeof tokens[k] === 'number')
    .map((k) => `${k}=${tokens[k]}`)
  return parts.length > 0 ? ` · tok ${parts.join(' ')}` : ''
}

function renderDossierAt(
  d: Dossier,
  legLimit: number,
  sessionLimit: number,
  stallLimit: number,
): string {
  if (!d.found) {
    return `flow brief: ${d.work_id} 不在本 repo 的 spine 上（${FULL_SET_HINT}）\n`
  }
  const out: string[] = [
    `${d.work_id}  ${d.title ?? '(無名)'}`,
    `state=${d.state} lane=${d.lane_label} 年齡=${hours(d.age_minutes)} 最後事件=${d.last_ts}`,
  ]
  if (d.origin_ref) out.push(`origin: ${d.origin_ref}（${shortOrigin(d.origin_ref)}）`)
  if (d.parked_at) out.push(`park: ${d.parked_at}`)
  if (d.reason) out.push(`lane 原因: ${d.reason}`)
  if (d.claim) {
    out.push(
      `宣告完成: ${d.claim.done_ts}${d.claim.verified_by ? ` by ${d.claim.verified_by}` : ''}`,
      `  驗證: ${d.claim.verification ?? '(none)'}`,
      '  ⚠ 憑證是文本，不是現況：驗收前重跑它指的那個驗證（flow-work-tracking § 可信 / MUST 實跑）',
    )
  }
  if (d.terminal) {
    out.push(`終態: ${d.terminal.verdict}@${d.terminal.ts} — ${d.terminal.reason ?? '(no reason)'}`)
  }
  if (d.pending_decisions.length > 0) {
    out.push('', `待答決策 (${d.pending_decisions.length}):`)
    for (const p of d.pending_decisions) {
      out.push(
        `  ${p.span_id.slice(0, 8)}  ${p.question ?? '(no question)'}  ${hours(p.age_minutes)}`,
      )
    }
  }
  if (d.stalls.length > 0) {
    out.push('', `堵塞 (${d.stalls.length}):`)
    // Verbatim from stall.ts — NEVER reword here; see board.ts BoardCard.action.
    for (const s of d.stalls.slice(0, stallLimit)) {
      out.push(`  ${s.shape} ${hours(s.age_minutes)}`, `    → ${s.action}`)
    }
    if (d.stalls.length > stallLimit) {
      out.push(`  …另 ${d.stalls.length - stallLimit} 筆堵塞（--json 全量）`)
    }
  }
  const relays = d.sessions.filter((s) => s.relay === true).length
  out.push('', `sessions: ${d.sessions.length}${relays > 0 ? `（relay×${relays}）` : ''}`)
  for (const s of d.sessions.slice(0, sessionLimit)) {
    const chips = [s.launcher, s.mode, s.pane_id, s.actor].filter(Boolean).join(' · ')
    out.push(`  ${s.session_id.slice(0, 8)}  ${s.first_ts}${chips ? `  ${chips}` : ''}`)
  }
  if (d.sessions.length > sessionLimit) {
    out.push(`  …另 ${d.sessions.length - sessionLimit} 個 session（--json 全量）`)
  }
  out.push('', `外派: ${d.dispatches.length} 筆`)
  for (const leg of d.dispatches.slice(0, legLimit)) {
    const meta = [
      `model=${leg.model}`,
      leg.effort ? `effort=${leg.effort}` : '',
      leg.provider ? `provider=${leg.provider}` : '',
      leg.route ? `route=${leg.route}` : '',
      leg.tier_basis ? `tier=${leg.tier_basis}` : '',
      leg.table_row ? `row=${leg.table_row}` : '',
      leg.retry_of ? `retry_of=${leg.retry_of}` : '',
      leg.decision_origin ? `decision=${leg.decision_origin}` : '',
    ]
      .filter(Boolean)
      .join(' ')
    const tail = [
      leg.duration_ms !== null ? `${(leg.duration_ms / 1000).toFixed(1)}s` : '',
      leg.exit !== null ? `exit=${leg.exit}` : '',
    ]
      .filter(Boolean)
      .join(' ')
    out.push(`  ${leg.substrate}${leg.label ? ` [${clamp(leg.label, 40)}]` : ''}  ${meta}`)
    if (tail || leg.tokens) out.push(`    ${tail}${tokenLine(leg.tokens)}`)
  }
  if (d.dispatches.length > legLimit) {
    out.push(`  …另 ${d.dispatches.length - legLimit} 筆外派（--json 全量）`)
  }
  // Coverage boundary, printed even when the list is long: an in-process `Agent` subagent has no
  // ledger and no write point, so it can never appear here. A reader who took this list as the
  // whole delegation history would under-count exactly the delegations that leave no trace.
  out.push('  （in-process Agent subagent 無 ledger，不在軌跡內）')
  out.push(
    '',
    d.artifacts.length > 0
      ? `產出: ${d.artifacts.map((a) => `${a.type}:${a.ref}${a.repo ? `@${a.repo}` : ''}`).join(', ')}`
      : '產出: 無紀錄',
  )
  out.push('', `最近 ${d.events.length} 事件:`)
  for (const e of d.events) {
    out.push(
      `  ${e.ts}  ${e.kind}.${e.phase}  ${e.actor}/${e.substrate}${e.outcome ? `  ${e.outcome}` : ''}`,
    )
  }
  return `${out.join('\n')}\n`
}

/**
 * The dossier, trimmed by dropping whole legs and hops — never by slicing mid-line.
 *
 * The identity, the claim and the blockage are printed before either list, so a squeezed dossier
 * loses delegation detail rather than the three facts a successor needs to decide whether to pick
 * the work up at all.
 */
export function renderDossier(d: Dossier, { maxBytes = DOSSIER_MAX_BYTES } = {}): string {
  if (!d.found) return renderDossierAt(d, 0, 0, 0)
  let legs = Math.min(TEXT_LIST_MAX, d.dispatches.length)
  let sessions = Math.min(TEXT_LIST_MAX, d.sessions.length)
  // Stalls give way last: they are the one section whose rows carry a command to run.
  let stalls = Math.min(TEXT_LIST_MAX, d.stalls.length)
  let text = renderDossierAt(d, legs, sessions, stalls)
  while (bytes(text) >= maxBytes && (legs > 0 || sessions > 0 || stalls > 0)) {
    if (legs > 0) legs -= 1
    else if (sessions > 0) sessions -= 1
    else stalls -= 1
    text = renderDossierAt(d, legs, sessions, stalls)
  }
  return hardCap(text, maxBytes)
}

/**
 * The dossier as JSON, trimmed by DROPPING WHOLE FIELDS rather than by slicing the string.
 *
 * Same reason as `overviewJson`: half a JSON object is not a short answer, it is a parse error.
 * The drop order runs from most replaceable to least — event tail, then dispatch legs, then the
 * session chain — so what survives a squeeze is the identity, the claim and the blockage.
 */
export function dossierJson(d: Dossier, { maxBytes = DOSSIER_MAX_BYTES } = {}): string {
  const truncated: string[] = []
  const shrunk: Dossier & { truncated?: string[]; full_set?: string } = { ...d }
  const line = () =>
    `${JSON.stringify({ ...shrunk, ...(truncated.length > 0 ? { truncated, full_set: FULL_SET_HINT } : {}) })}\n`
  while (bytes(line()) >= maxBytes) {
    if (shrunk.events.length > 0) {
      shrunk.events = shrunk.events.slice(1)
      if (!truncated.includes('events')) truncated.push('events')
      continue
    }
    if (shrunk.dispatches.length > 0) {
      shrunk.dispatches = shrunk.dispatches.slice(0, -1)
      if (!truncated.includes('dispatches')) truncated.push('dispatches')
      continue
    }
    if (shrunk.sessions.length > 0) {
      shrunk.sessions = shrunk.sessions.slice(0, -1)
      if (!truncated.includes('sessions')) truncated.push('sessions')
      continue
    }
    if (shrunk.stalls.length > 0) {
      shrunk.stalls = shrunk.stalls.slice(0, -1)
      if (!truncated.includes('stalls')) truncated.push('stalls')
      continue
    }
    break
  }
  return line()
}
