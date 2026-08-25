// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/decisions.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/decisions.ts
// clade flow spine — the decision queue (what is waiting on a human)
//
// The rest of the spine records what happened. This projection answers the opposite question:
// what has *not* happened because nobody has answered yet. The `\my` contract states outright
// that pending decisions "mostly exist only in the conversation", which no tool could read —
// this is the surface that makes them queryable.
//
// Two buckets, and the second one is the reason this file exists rather than a one-line filter:
//
//   1. ASKED — a `decision.request` span with no `end`. The question was emitted deliberately.
//   2. GATED — any span that ended `blocked` with nothing following it in the same work item.
//      Nobody wrote a question for these, yet they are exactly as stuck: a publish that refused
//      to run as a runner child, a pane that reported `blocked`. Reading only bucket 1 would
//      show an empty queue while the fleet sits waiting on an attended session.
//
// Bucket 2 shares `lastStartByWork` and the action sentence with `findStalls` rather than copying
// either: two copies of "did anything follow" would let `/flow` and this queue disagree about
// whether the same span is still waiting. It does NOT filter `findStalls` output, because a
// blocked herdr pane that was also never reclaimed is classified `unharvested` there and returns
// before the blocked branch — that is the live case this queue exists for, so it must not depend
// on the classification, only on the oracle.

import type { Span } from './spine.ts'
import { AWAITING_ATTENDED_ACTION, lastStartByWork } from './stall.ts'

export interface AskedDecision {
  span_id: string
  work_id: string
  repo: string | null
  asked_at: string
  actor: string
  substrate: string
  age_minutes: number
  question: string
  options: string[]
  recommended: string | null
  /** `\my` bucket. Only bucket 1 ("ruling") is answerable by picking a letter. */
  category: string
  /** Where the answer has to land: a TD id, a HANDOFF section, a `tasks/` path. */
  carrier: string | null
}

export interface GatedWork {
  span_id: string
  work_id: string
  repo: string | null
  blocked_at: string
  actor: string
  substrate: string
  kind: string
  label: string | null
  age_minutes: number
  /** The sentence `findStalls` already writes for this shape — never a second wording. */
  action: string
}

export interface DecisionQueue {
  generated_at: string
  asked: AskedDecision[]
  gated: GatedWork[]
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Same fields `findStalls` reads for its label — a decision span has none of them, a pane does. */
function labelOf(span: Span): string | null {
  const label = span.payload?.label ?? span.payload?.slug ?? span.payload?.node
  return typeof label === 'string' ? label : null
}

function ageMinutes(ts: string | null, now: number): number {
  if (!ts) return 0
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor((now - parsed) / 60000))
}

/**
 * Per-repo, never over the concatenated stream.
 *
 * Same correctness requirement `buildFleetSnapshot` documents: work ids collide across repos, so
 * "nothing followed in this work item" folded across repos would silently mark a blocked span in
 * one repo as resolved by unrelated activity in another.
 */
function groupByRepo(spans: (Span & { repo?: string })[]): Map<string | null, Span[]> {
  const byRepo = new Map<string | null, Span[]>()
  for (const span of spans) {
    const key = span.repo ?? null
    const bucket = byRepo.get(key)
    if (bucket) bucket.push(span)
    else byRepo.set(key, [span])
  }
  return byRepo
}

export function buildDecisionQueue(
  spans: (Span & { repo?: string })[],
  { now = Date.now() }: { now?: number } = {},
): DecisionQueue {
  const asked: AskedDecision[] = []
  const gated: GatedWork[] = []

  for (const [repo, repoSpans] of groupByRepo(spans)) {
    for (const span of repoSpans) {
      if (span.kind !== 'decision.request' || span.end_ts) continue
      const payload = span.payload ?? {}
      asked.push({
        span_id: span.span_id,
        work_id: span.work_id,
        repo,
        asked_at: span.start_ts ?? '',
        actor: span.actor,
        substrate: span.substrate,
        age_minutes: ageMinutes(span.start_ts, now),
        question: str(payload.question, '(沒有記下問題)'),
        options: Array.isArray(payload.options) ? payload.options.map((o) => String(o)) : [],
        recommended: typeof payload.recommended === 'string' ? payload.recommended : null,
        category: str(payload.category, 'ruling'),
        carrier: typeof payload.carrier === 'string' ? payload.carrier : null,
      })
    }

    // No grace period, unlike `findStalls`: a stall needs one because a young span with no outcome
    // is a race, but `blocked` is a *reported* state — it is waiting the moment it is written, and
    // holding it back for an hour is exactly the silence this queue removes.
    const lastStart = lastStartByWork(repoSpans)
    for (const span of repoSpans) {
      if (span.is_point || span.outcome !== 'blocked' || !span.end_ts) continue
      if ((lastStart.get(span.work_id) ?? '') > span.end_ts) continue
      gated.push({
        span_id: span.span_id,
        work_id: span.work_id,
        repo,
        blocked_at: span.end_ts,
        actor: span.actor,
        substrate: span.substrate,
        kind: span.kind,
        label: labelOf(span),
        age_minutes: ageMinutes(span.end_ts, now),
        action: AWAITING_ATTENDED_ACTION,
      })
    }
  }

  return {
    generated_at: new Date(now).toISOString(),
    asked: asked.toSorted((a, b) => b.age_minutes - a.age_minutes),
    gated: gated.toSorted((a, b) => b.age_minutes - a.age_minutes),
  }
}
