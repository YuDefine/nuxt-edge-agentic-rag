// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/stall.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/stall.ts
// clade flow spine — stall query (P2)
//
// `herdr-patrol --stalled` answers "what has stopped moving and nobody will notice" for one
// substrate, by reading live Herdr panes plus the durable dispatch records. This asks the same
// question of the spine, which means it answers it for every substrate at once: a pi dispatch that
// died mid-run, a node that ended blocked, a pane that reported and was never harvested.
//
// COVERAGE BOUNDARY — NEVER read this as "patrol is now redundant". Patrol reports three classes of
// fact that are not events and therefore cannot be on the spine at all:
//   1. pane geometry disagreeing with the dispatch record (a `pane swap` nobody recorded)
//   2. orphaned dev-tool processes a dead session left running
//   3. whether the session that may act on a pane still exists — which decides between `--reclaim`
//      and `--recover-orphan`, two different instructions for one stalled pane
// It is also machine-wide, while a spine is repo-local: a dispatch whose cwd is another repo lands
// on that repo's events.jsonl and is invisible here. What moves onto the spine is the *stall
// verdict* — abandoned dispatches, reported-but-unharvested ones, work that failed with nothing
// after it — for every substrate at once rather than for Herdr alone.
//
// Measured 2026-08-24 on one live pane: patrol said `orphan-recoverable [blocked]`, this said
// `unharvested`. Same pane, same stall, and the actions differ exactly where patrol knows something
// the stream cannot: the coordinator session is gone.
//
// Every predicate below is a pure function of the folded spans plus `now`. There is no second
// store, no bookkeeping file, and nothing to keep in sync.

import type { Span } from './spine.ts'

export type StallShape = 'in-flight-overdue' | 'unharvested' | 'failed-open'

export interface Stall {
  shape: StallShape
  span_id: string
  work_id: string
  substrate: string
  kind: string
  actor: string
  /** Minutes since the moment that makes this a stall (start for in-flight, end for the others). */
  age_minutes: number
  since: string
  /** What a reader should do about it — the same contract patrol's `action` column carries. */
  action: string
  label: string | null
}

/**
 * Default grace period. Matches `herdr-patrol.ts`'s `ABANDONED_RECORD_MIN_AGE_MS` (60 minutes) on
 * purpose: a dispatch record is written before its pane finishes launching, so a young record with
 * no outcome is a race, not a leak, and the two surfaces must not disagree about where that line is.
 */
export const DEFAULT_STALL_MINUTES = 60

function ageMinutes(ts: string | null, now: number): number | null {
  if (!ts) return null
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return null
  return Math.floor((now - parsed) / 60000)
}

function labelOf(span: Span): string | null {
  const label = span.payload?.label ?? span.payload?.slug ?? span.payload?.node
  return typeof label === 'string' ? label : null
}

/** Point events emitted by a reclaim, keyed by the dispatch span they close out. */
function reclaimedSpanIds(spans: Span[]): Set<string> {
  const out = new Set<string>()
  for (const s of spans) {
    if (s.is_point && s.payload?.transport_event === 'reclaim' && s.parent_span) {
      out.add(s.parent_span)
    }
  }
  return out
}

/** The latest start timestamp per work item, so "nothing happened after this failure" is checkable. */
function lastStartByWork(spans: Span[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of spans) {
    if (!s.start_ts) continue
    const cur = out.get(s.work_id)
    if (!cur || s.start_ts > cur) out.set(s.work_id, s.start_ts)
  }
  return out
}

export function findStalls(
  spans: Span[],
  {
    now = Date.now(),
    thresholdMinutes = DEFAULT_STALL_MINUTES,
  }: { now?: number; thresholdMinutes?: number } = {},
): Stall[] {
  const reclaimed = reclaimedSpanIds(spans)
  const lastStart = lastStartByWork(spans)
  const stalls: Stall[] = []

  for (const span of spans) {
    // A point event is an instant; it can never be in flight and never be harvested.
    if (span.is_point) continue
    const base = {
      span_id: span.span_id,
      work_id: span.work_id,
      substrate: span.substrate,
      kind: span.kind,
      actor: span.actor,
      label: labelOf(span),
    }

    if (!span.end_ts) {
      const age = ageMinutes(span.start_ts, now)
      if (age !== null && age >= thresholdMinutes) {
        stalls.push({
          ...base,
          shape: 'in-flight-overdue',
          age_minutes: age,
          since: span.start_ts as string,
          action:
            span.substrate === 'herdr'
              ? `pane never reported an outcome; read its scrollback, then redispatch or close it out with \`herdr-session-handoff.ts --adjudicate\``
              : `span opened and never closed — the process died or is still running; confirm which before assuming the work landed`,
        })
      }
      continue
    }

    const endAge = ageMinutes(span.end_ts, now)
    if (endAge === null) continue

    // Reported, but nobody harvested it. Closing the span is what a completion does; taking the
    // pane back is a separate act, and only the reclaim point event proves it happened.
    if (
      span.substrate === 'herdr' &&
      span.payload?.closed_by === 'completion' &&
      !reclaimed.has(span.span_id) &&
      endAge >= thresholdMinutes
    ) {
      const dispatchId =
        typeof span.payload?.dispatch_id === 'string' ? span.payload.dispatch_id : ''
      const paneId = typeof span.payload?.pane_id === 'string' ? span.payload.pane_id : '<pane>'
      stalls.push({
        ...base,
        shape: 'unharvested',
        age_minutes: endAge,
        since: span.end_ts,
        // Only the dispatching session may reclaim. If it is gone the reclaim refuses, and
        // `herdr-patrol` is the surface that can tell you so — hence the pointer rather than a
        // promise that this one command will work.
        action: `outcome reported, pane not reclaimed: node vendor/scripts/herdr-session-handoff.ts --reclaim ${paneId} --verified${dispatchId ? `  (dispatch ${dispatchId})` : ''} — if that refuses, the dispatching session is gone: check \`herdr-patrol\``,
      })
      continue
    }

    // Failed or blocked, and nothing in this work item started afterwards — the shape of
    // "everyone stopped and nobody is going to wake anyone", including a node that returned
    // blocked because it refuses to run unattended.
    if (
      (span.outcome === 'fail' || span.outcome === 'blocked') &&
      endAge >= thresholdMinutes &&
      (lastStart.get(span.work_id) ?? '') <= span.end_ts
    ) {
      stalls.push({
        ...base,
        shape: 'failed-open',
        age_minutes: endAge,
        since: span.end_ts,
        action:
          span.outcome === 'blocked'
            ? `blocked and nothing followed — this is the awaiting-attended state; an attended session has to pick it up`
            : `failed and nothing followed in this work item; either retry it or record why it was dropped`,
      })
    }
  }

  return stalls.toSorted((a, b) => b.age_minutes - a.age_minutes)
}

export function renderStalls(stalls: Stall[]): string {
  if (stalls.length === 0) return 'no stalls on the spine\n'
  const lines = [`STALLED (${stalls.length}):`, '']
  for (const s of stalls) {
    const hours = (s.age_minutes / 60).toFixed(1)
    lines.push(
      `${s.shape}  ${s.substrate}:${s.kind}${s.label ? ` [${s.label}]` : ''}  ${hours}h  ${s.work_id}  ${s.span_id.slice(0, 8)}`,
    )
    lines.push(`    → ${s.action}`)
  }
  return `${lines.join('\n')}\n`
}
