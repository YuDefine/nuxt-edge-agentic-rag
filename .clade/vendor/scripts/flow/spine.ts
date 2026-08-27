// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/spine.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/spine.ts
// clade flow spine — the one projection every view reads (P2)
//
// P0-min put this fold inside `flow.ts` because there was exactly one view. P2 adds four more
// (`serve`, `status --stalled`, `viz --md`, `viz --fleet`), and a second copy of "how events
// become spans" would be a second data model: two views could then disagree about whether the
// same work item is in flight, and neither would be wrong about its own copy.
//
// Everything here is derived. There is NEVER a stored span, a cache, or a second file — the
// events stream is the only state, and every function below is a pure function of it.

export interface FlowEvent {
  work_id: string
  span_id: string
  parent_span?: string | null
  phase: 'start' | 'end' | 'point'
  kind: string
  actor: string
  substrate: string
  ts_utc: string
  session_id?: string
  payload?: Record<string, unknown>
  outcome?: string | null
}

export interface Span {
  span_id: string
  work_id: string
  parent_span: string | null
  kind: string
  actor: string
  substrate: string
  start_ts: string | null
  end_ts: string | null
  outcome: string | null
  duration_ms: number | null
  /**
   * True when the span was built from a `phase: 'point'` event — an instant, not an interval.
   * Views render these as markers: a zero-width bar reads as a suspiciously fast span, and
   * `work.open` would otherwise look like a piece of work that took 0ms.
   */
  is_point: boolean
  payload: Record<string, unknown>
}

/**
 * Six states, in the priority the fold applies them: a human verdict outranks an agent's claim,
 * which outranks anything still moving.
 *
 * `settled` is deliberately kept and is deliberately NOT a synonym for `done`. It means "no span is
 * running and nobody claimed completion" — the ambiguous state that the four questions this layer
 * exists to answer (progress / blocked / finished / accepted) keep landing on. Collapsing it into
 * `done` would answer "is it finished?" with "nothing is running", which is the wrong answer given
 * confidently.
 */
export type WorkState = 'in-flight' | 'failed' | 'settled' | 'done' | 'accepted' | 'dropped'

export interface WorkItem {
  work_id: string
  spans: number
  in_flight: number
  failed: number
  first_ts: string
  last_ts: string
  state: WorkState
  /** Slug from the `work.open` point event, when the work item was opened through `flow open`. */
  slug: string | null
  /**
   * Where this work item was born, as `<scheme>:<id>` — the join key back to the prose world
   * (a Notion page, a TD entry, a `tasks/` file). Null for anything opened without one, which
   * includes every work item minted before origins existed: absent is not a defect here.
   */
  origin_ref: string | null
  /** Scheme half of `origin_ref`, split once at the fold so no reader has to re-parse it. */
  origin_kind: string | null
  /** One human line naming the problem. Views prefer it over the slug when both are present. */
  title: string | null
  /** When completion was claimed, and with what evidence — the row a human accepts or rejects. */
  done_ts: string | null
  verification: string | null
  verified_by: string | null
  /** The human verdict, once given. Terminal: nothing after it changes the state. */
  terminal: 'accepted' | 'dropped' | null
  terminal_ts: string | null
  terminal_reason: string | null
  /** Prose carrier this work stopped at (`/handoff park`), when it did. Not a state — a pointer. */
  parked_at: string | null
}

/**
 * Fold start/end pairs into spans. An unmatched start stays visible as in-flight: that is a
 * reportable state (the pane died, the dispatch never came back), not a defect to be tidied away.
 */
export function foldSpans(events: FlowEvent[]): Span[] {
  const spans = new Map<string, Span>()
  for (const e of events) {
    const cur: Span = spans.get(e.span_id) ?? {
      span_id: e.span_id,
      work_id: e.work_id,
      parent_span: e.parent_span ?? null,
      kind: e.kind,
      actor: e.actor,
      substrate: e.substrate,
      start_ts: null,
      end_ts: null,
      outcome: null,
      duration_ms: null,
      is_point: false,
      payload: {},
    }
    cur.payload = { ...cur.payload, ...e.payload }
    if (e.phase === 'start') cur.start_ts = e.ts_utc
    else if (e.phase === 'end') {
      cur.end_ts = e.ts_utc
      cur.outcome = e.outcome ?? null
      cur.duration_ms = (e.payload?.duration_ms as number) ?? null
    } else {
      cur.is_point = true
      cur.start_ts = cur.start_ts ?? e.ts_utc
      cur.end_ts = cur.end_ts ?? e.ts_utc
      cur.outcome = e.outcome ?? null
      cur.duration_ms = cur.duration_ms ?? 0
    }
    spans.set(e.span_id, cur)
  }
  return [...spans.values()].toSorted((a, b) =>
    String(a.start_ts).localeCompare(String(b.start_ts)),
  )
}

export function latestWorkId(events: FlowEvent[]): string | null {
  return events.length > 0 ? events[events.length - 1].work_id : null
}

/**
 * Depth by `parent_span`, so a herdr pane under a pi dispatch reads as nested rather than as a
 * peer. Cycle-guarded: the id is generated, but a malformed line on the stream must not hang a view.
 */
export function spanDepth(span: Span, byId: Map<string, Span>, seen = new Set<string>()): number {
  if (!span.parent_span || seen.has(span.span_id)) return 0
  const parent = byId.get(span.parent_span)
  if (!parent) return 0
  seen.add(span.span_id)
  return 1 + spanDepth(parent, byId, seen)
}

export function indexById(spans: Span[]): Map<string, Span> {
  return new Map(spans.map((s) => [s.span_id, s]))
}

/** Children of one span, in start order. The DAG the views draw is exactly this relation. */
export function childrenOf(spans: Span[], spanId: string): Span[] {
  return spans.filter((s) => s.parent_span === spanId)
}

/** Spans with no parent present in the same set — the roots each view starts drawing from. */
export function rootsOf(spans: Span[]): Span[] {
  const ids = new Set(spans.map((s) => s.span_id))
  return spans.filter((s) => !s.parent_span || !ids.has(s.parent_span))
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** One row per work item. `state` is derived, never stored: the stream is the only authority. */
export function buildWorkItems(spans: Span[]): WorkItem[] {
  const byWork = new Map<string, WorkItem>()
  // Latest real (non-point) span start per work item. A `done` claim is invalidated by work that
  // starts AFTER it — that is how "sent back for rework" is expressed, with no reopen event to
  // forget to emit. Points are excluded on purpose: a park note or a second verdict is not rework.
  const lastRealStart = new Map<string, string>()
  for (const s of spans) {
    if (s.is_point || !s.start_ts) continue
    if ((lastRealStart.get(s.work_id) ?? '') < s.start_ts) lastRealStart.set(s.work_id, s.start_ts)
  }

  for (const s of spans) {
    const cur: WorkItem = byWork.get(s.work_id) ?? {
      work_id: s.work_id,
      spans: 0,
      in_flight: 0,
      failed: 0,
      first_ts: s.start_ts ?? '',
      last_ts: '',
      state: 'settled',
      slug: null,
      origin_ref: null,
      origin_kind: null,
      title: null,
      done_ts: null,
      verification: null,
      verified_by: null,
      terminal: null,
      terminal_ts: null,
      terminal_reason: null,
      parked_at: null,
    }
    cur.spans += 1
    if (!s.end_ts) cur.in_flight += 1
    if (s.outcome === 'fail') cur.failed += 1
    if (s.kind === 'work.open') {
      if (typeof s.payload?.slug === 'string') cur.slug = s.payload.slug
      // First origin wins. A work item is born once; a later `work.open` on the same id is a
      // collision or a replay, and letting it rewrite the origin would silently re-parent the
      // history of everything already folded under it.
      if (cur.origin_ref === null && typeof s.payload?.origin_ref === 'string') {
        cur.origin_ref = s.payload.origin_ref
        cur.origin_kind =
          typeof s.payload?.origin_kind === 'string'
            ? s.payload.origin_kind
            : (s.payload.origin_ref.split(':')[0] ?? null)
      }
      if (cur.title === null && typeof s.payload?.title === 'string') cur.title = s.payload.title
    }
    const at = s.start_ts ?? ''
    // Last write wins on each of these: re-doing a work item after rework, or a human overriding
    // their own earlier verdict, both read naturally as "the most recent one is the one that holds".
    if (s.kind === 'work.done' && at >= (cur.done_ts ?? '')) {
      cur.done_ts = at
      cur.verification = str(s.payload?.verification)
      cur.verified_by = str(s.payload?.verified_by)
    }
    if ((s.kind === 'work.accept' || s.kind === 'work.drop') && at >= (cur.terminal_ts ?? '')) {
      cur.terminal = s.kind === 'work.accept' ? 'accepted' : 'dropped'
      cur.terminal_ts = at
      cur.terminal_reason = str(s.payload?.reason)
    }
    if (s.kind === 'work.park' && typeof s.payload?.carrier === 'string') {
      cur.parked_at = s.payload.carrier
    }
    const ts = s.end_ts ?? s.start_ts ?? ''
    if (ts > cur.last_ts) cur.last_ts = ts
    if (s.start_ts && (!cur.first_ts || s.start_ts < cur.first_ts)) cur.first_ts = s.start_ts
    byWork.set(s.work_id, cur)
  }
  for (const item of byWork.values()) {
    // A claim of completion that real work outlived is no longer a claim about the current state.
    // `done_ts` and `verification` stay on the row regardless: they record that the claim WAS made,
    // which is exactly what a reviewer needs to see when asking why the work came back.
    const claimStands =
      item.done_ts !== null && (lastRealStart.get(item.work_id) ?? '') <= item.done_ts
    item.state = item.terminal
      ? item.terminal
      : claimStands
        ? 'done'
        : item.in_flight > 0
          ? 'in-flight'
          : item.failed > 0
            ? 'failed'
            : 'settled'
  }
  return [...byWork.values()].toSorted((a, b) => a.last_ts.localeCompare(b.last_ts))
}

/** Exactly what `resolveWorkId` mints with no ambient id: `W-<date>-orphan-<6 hex>`. */
const ORPHAN_WORK_ID = /^W-\d{4}-\d{2}-\d{2}-orphan-[0-9a-f]{6}$/

/** True only for a minted orphan id. A named work whose slug contains the word is not one. */
export function isOrphanWorkId(workId: string | null | undefined): boolean {
  return ORPHAN_WORK_ID.test(String(workId ?? ''))
}

/**
 * How much of the recent stream cannot say which work item it belongs to.
 *
 * The `orphan-` prefix exists so an unattributed span stays countable instead of invisible, and
 * this is the thing that counts it. Only RECENT events are measured: the backlog is not
 * retroactively fixable, and folding it in would keep the ratio pinned high long after the
 * entry points were fixed — a number that cannot move is a number nobody acts on.
 *
 * Deliberately a ratio and not a count: the fleet emits more events every week, so a count
 * crosses any fixed threshold eventually through growth alone.
 *
 * Recent events are NOT the same as recently minted work ids, and only the second one answers
 * the question this signal is asked (TD-684, measured 2026-08-27). `workIdFromLabel` is
 * ambient-first by design, so a pane holding an orphan id passes that same id to every pane it
 * dispatches: one work id minted at 01:38 rode four dispatches under four different labels to
 * 07:30. A bloodline like that does not heal — it ends when those pre-fix panes retire — so
 * folding it into the warned number reproduces exactly the pinned-high ratio the window was
 * added to avoid. `minted` counts only events whose work id was first seen INSIDE the window;
 * that is the one that moves when an entry point regresses, and it is the one thresholded.
 *
 * The predicate is anchored (`isOrphanWorkId`), not a substring: a named work whose label
 * happens to contain the word — `W-2026-08-27-td-684-orphan-work-id`, the work item that
 * investigated this very signal — matched `includes('orphan-')` and was counted against itself.
 */
export interface OrphanRatio {
  window_days: number
  total: number
  orphan: number
  /** Orphan events whose work id was first seen inside the window — the entry-point signal. */
  minted: number
  /** Orphan events inheriting a work id minted before the window — pre-existing bloodlines. */
  inherited: number
  ratio: number
  over_threshold: boolean
  threshold: number
  /** Minted orphans bucketed by the entry point that minted them, biggest first. */
  by_entry: OrphanEntry[]
}

/**
 * One minting entry point's share of the window.
 *
 * The warning's whole ask is "which entry point regressed", and the answer is derivable from the
 * stream the warning already reads: an orphan id is minted by whatever emitted its FIRST event,
 * and every later event under that id is a descendant of that one mint. Leaving it out made every
 * reader re-derive it by hand — measured 2026-08-28, that is a `python3` pass over the JSONL and
 * about twenty minutes, per reader, for a fact the counter had in front of it.
 *
 * `newest_mint` is what separates "this entry is regressing right now" from "this entry was fixed
 * and its pre-fix mints have not aged out of the window yet". Without it the two are the same
 * number: the window is 7 days, so a fix lands with a week of its own backlog still inside.
 */
export interface OrphanEntry {
  /** `<kind>|<actor>|<substrate>` of the first event under each id this entry minted. */
  entry: string
  /** Distinct orphan work ids minted here inside the window. */
  ids: number
  /** Events carried by those ids inside the window — the bloodline, not just the mint. */
  events: number
  /** `ts_utc` of the most recent mint here. */
  newest_mint: string
}

export function orphanRatio(
  events: FlowEvent[],
  {
    days = 7,
    threshold = 0.25,
    now = new Date(),
  }: { days?: number; threshold?: number; now?: Date } = {},
): OrphanRatio {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
  // First sighting is taken over the WHOLE stream, not the window: an id first seen at the
  // window's edge is only distinguishable from a pre-fix bloodline by what came before it.
  const firstSeen = new Map<string, string>()
  for (const e of events) {
    if (!e.work_id || !e.ts_utc) continue
    const prev = firstSeen.get(e.work_id)
    if (prev === undefined || e.ts_utc < prev) firstSeen.set(e.work_id, e.ts_utc)
  }
  // The event that OPENED each id — the mint site. Taken over the whole stream for the same
  // reason `firstSeen` is: an id whose first event predates the window was not minted here.
  const mintEvent = new Map<string, FlowEvent>()
  for (const e of events) {
    if (!e.work_id || !e.ts_utc) continue
    const held = mintEvent.get(e.work_id)
    if (held === undefined || e.ts_utc < held.ts_utc) mintEvent.set(e.work_id, e)
  }
  let total = 0
  let minted = 0
  let inherited = 0
  const buckets = new Map<string, { ids: Set<string>; events: number; newest_mint: string }>()
  for (const e of events) {
    if (!e.ts_utc || e.ts_utc < cutoff) continue
    total += 1
    if (!isOrphanWorkId(e.work_id)) continue
    if ((firstSeen.get(e.work_id as string) ?? e.ts_utc) < cutoff) {
      inherited += 1
      continue
    }
    minted += 1
    const mint = mintEvent.get(e.work_id)
    if (!mint) continue
    const entry = `${mint.kind}|${mint.actor}|${mint.substrate}`
    const held = buckets.get(entry) ?? { ids: new Set<string>(), events: 0, newest_mint: '' }
    held.ids.add(e.work_id)
    held.events += 1
    if (mint.ts_utc > held.newest_mint) held.newest_mint = mint.ts_utc
    buckets.set(entry, held)
  }
  const by_entry: OrphanEntry[] = [...buckets]
    .map(([entry, held]) => ({
      entry,
      ids: held.ids.size,
      events: held.events,
      newest_mint: held.newest_mint,
    }))
    .toSorted((a, b) => b.events - a.events || a.entry.localeCompare(b.entry))
  const orphan = minted + inherited
  const ratio = total > 0 ? minted / total : 0
  // An empty window is not a clean window. With nothing to measure the honest answer is "no
  // signal", and reporting that as 0% would read as a passing grade nobody earned.
  return {
    window_days: days,
    total,
    orphan,
    minted,
    inherited,
    ratio,
    threshold,
    over_threshold: total > 0 && ratio > threshold,
    by_entry,
  }
}
