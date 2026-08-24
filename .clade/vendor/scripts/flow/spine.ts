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

export type WorkState = 'in-flight' | 'failed' | 'settled'

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

/** One row per work item. `state` is derived, never stored: the stream is the only authority. */
export function buildWorkItems(spans: Span[]): WorkItem[] {
  const byWork = new Map<string, WorkItem>()
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
    }
    cur.spans += 1
    if (!s.end_ts) cur.in_flight += 1
    if (s.outcome === 'fail') cur.failed += 1
    if (s.kind === 'work.open' && typeof s.payload?.slug === 'string') cur.slug = s.payload.slug
    const ts = s.end_ts ?? s.start_ts ?? ''
    if (ts > cur.last_ts) cur.last_ts = ts
    if (s.start_ts && (!cur.first_ts || s.start_ts < cur.first_ts)) cur.first_ts = s.start_ts
    byWork.set(s.work_id, cur)
  }
  for (const item of byWork.values()) {
    item.state = item.in_flight > 0 ? 'in-flight' : item.failed > 0 ? 'failed' : 'settled'
  }
  return [...byWork.values()].toSorted((a, b) => a.last_ts.localeCompare(b.last_ts))
}
