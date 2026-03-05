/**
 * observability-and-debug §2 / §3 — debug-store for the internal
 * `/admin/debug/*` surfaces. Separate from `query-log-admin-store.ts` (which
 * powers the redaction-safe admin list) because debug queries intentionally
 * project the 6 additional observability columns.
 *
 * SECURITY: Still never exposes raw query text. The only query-body column
 * returned is `query_redacted_text`, same as the admin store. Consumers of
 * this store MUST sit behind `requireInternalDebugAccess`.
 *
 * NULL semantics (see tasks.md §0.1 / §3.3): latency / score / path / reason
 * columns are nullable. NULL means "not measured / not applicable" and MUST
 * NOT be coerced to 0 / '' / 'unknown'.
 */

import { parseStringArrayJson } from '#shared/utils/parse-string-array'

interface D1PreparedStatementLike {
  all<T>(): Promise<{ results?: T[] }>
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export interface DebugQueryLogDetail {
  allowedAccessLevels: string[]
  channel: string
  citationsJson: string
  completionLatencyMs: number | null
  configSnapshotVersion: string
  createdAt: string
  decisionPath: string | null
  environment: string
  firstTokenLatencyMs: number | null
  id: string
  judgeScore: number | null
  queryRedactedText: string
  redactionApplied: boolean
  refusalReason: string | null
  retrievalScore: number | null
  riskFlags: string[]
  status: string
}

interface DebugQueryLogRow {
  allowed_access_levels_json: string
  channel: string
  completion_latency_ms: number | null
  config_snapshot_version: string
  created_at: string
  decision_path: string | null
  environment: string
  first_token_latency_ms: number | null
  id: string
  judge_score: number | null
  query_redacted_text: string
  redaction_applied: number
  refusal_reason: string | null
  retrieval_score: number | null
  risk_flags_json: string
  status: string
}

export interface LatencyBucket {
  p50: number | null
  p95: number | null
  sampleCount: number
}

export interface OutcomeBreakdown {
  /** `decision_path IN (direct_answer, judge_pass, self_correction_retry)` */
  answered: number
  /** `decision_path IN (judge_pass_refuse, self_correction_refuse, no_citation_refuse, sensitive_refuse)` or `status='rejected'` */
  refused: number
  /** `status='blocked'` — audit layer stopped the query */
  forbidden: number
  /** `decision_path='pipeline_error'` */
  error: number
}

export interface ChannelLatencySummary {
  channel: string
  completionMs: LatencyBucket
  firstTokenMs: LatencyBucket
  outcomes: OutcomeBreakdown
}

export interface LatencySummary {
  channels: ChannelLatencySummary[]
  days: number
}

export interface LatencySummaryOptions {
  days: number
  /** Optional `now` injection for deterministic tests. */
  now?: Date
}

function toDebugDetail(row: DebugQueryLogRow): DebugQueryLogDetail {
  return {
    allowedAccessLevels: parseStringArrayJson(row.allowed_access_levels_json),
    channel: row.channel,
    citationsJson: '[]', // detail store doesn't join messages; reserved for future.
    completionLatencyMs: row.completion_latency_ms,
    configSnapshotVersion: row.config_snapshot_version,
    createdAt: row.created_at,
    decisionPath: row.decision_path,
    environment: row.environment,
    firstTokenLatencyMs: row.first_token_latency_ms,
    id: row.id,
    judgeScore: row.judge_score,
    queryRedactedText: row.query_redacted_text,
    redactionApplied: row.redaction_applied === 1,
    refusalReason: row.refusal_reason,
    retrievalScore: row.retrieval_score,
    riskFlags: parseStringArrayJson(row.risk_flags_json),
    status: row.status,
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null
  }
  if (sorted.length === 1) {
    return sorted[0] ?? null
  }
  // Nearest-rank method — simple and deterministic for small samples.
  const rank = Math.ceil((p / 100) * sorted.length)
  const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1))
  return sorted[idx] ?? null
}

function summarizeBucket(values: Array<number | null>): LatencyBucket {
  const present = values.filter((v): v is number => typeof v === 'number').toSorted((a, b) => a - b)
  return {
    p50: percentile(present, 50),
    p95: percentile(present, 95),
    sampleCount: present.length,
  }
}

interface OutcomeRow {
  status: string
  decision_path: string | null
}

function channelOrdinal(channel: string): number {
  if (channel === 'web') return 0
  if (channel === 'mcp') return 1
  return 2
}

function classifyOutcome(row: OutcomeRow): keyof OutcomeBreakdown {
  // `status='blocked'` always means audit layer forbade the request, even if
  // a decision_path was recorded alongside it.
  if (row.status === 'blocked') {
    return 'forbidden'
  }
  switch (row.decision_path) {
    case 'pipeline_error':
      return 'error'
    case 'judge_pass_refuse':
    case 'self_correction_refuse':
    case 'no_citation_refuse':
    case 'sensitive_refuse':
    case 'restricted_blocked':
      return 'refused'
    case 'direct_answer':
    case 'judge_pass':
    case 'self_correction_retry':
      return 'answered'
    case null:
    case undefined:
      // Legacy rows / still-accepted rows without a decision path. Status
      // = 'rejected' counts as refused; otherwise treat as answered (best
      // effort — these rows predate observability and cannot be better
      // classified without fabrication).
      return row.status === 'rejected' ? 'refused' : 'answered'
    default:
      return 'answered'
  }
}

export function createQueryLogDebugStore(database: D1DatabaseLike) {
  return {
    async getDebugQueryLogById(id: string): Promise<DebugQueryLogDetail | null> {
      const row = await database
        .prepare(
          [
            'SELECT id, channel, status, environment, query_redacted_text,',
            '  risk_flags_json, allowed_access_levels_json, redaction_applied,',
            '  config_snapshot_version, created_at,',
            '  first_token_latency_ms, completion_latency_ms,',
            '  retrieval_score, judge_score, decision_path, refusal_reason',
            'FROM query_logs',
            'WHERE id = ?',
            'LIMIT 1',
          ].join('\n')
        )
        .bind(id)
        .first<DebugQueryLogRow>()

      if (!row) {
        return null
      }

      return toDebugDetail(row)
    },

    async summarizeLatency(options: LatencySummaryOptions): Promise<LatencySummary> {
      const now = options.now ?? new Date()
      const sinceMs = now.getTime() - options.days * 24 * 60 * 60 * 1000
      const since = new Date(sinceMs).toISOString()

      const result = await database
        .prepare(
          [
            'SELECT channel, status, decision_path,',
            '  first_token_latency_ms, completion_latency_ms',
            'FROM query_logs',
            'WHERE created_at >= ?',
          ].join('\n')
        )
        .bind(since)
        .all<{
          channel: string
          completion_latency_ms: number | null
          decision_path: string | null
          first_token_latency_ms: number | null
          status: string
        }>()

      const rows = result.results ?? []

      const byChannel = new Map<
        string,
        {
          completion: Array<number | null>
          firstToken: Array<number | null>
          outcomes: OutcomeBreakdown
        }
      >()

      for (const row of rows) {
        const bucket = byChannel.get(row.channel) ?? {
          completion: [],
          firstToken: [],
          outcomes: { answered: 0, refused: 0, forbidden: 0, error: 0 },
        }
        bucket.firstToken.push(row.first_token_latency_ms)
        bucket.completion.push(row.completion_latency_ms)
        const category = classifyOutcome({
          status: row.status,
          decision_path: row.decision_path,
        })
        bucket.outcomes[category] += 1
        byChannel.set(row.channel, bucket)
      }

      const channels: ChannelLatencySummary[] = Array.from(byChannel.entries()).map(
        ([channel, bucket]) => ({
          channel,
          completionMs: summarizeBucket(bucket.completion),
          firstTokenMs: summarizeBucket(bucket.firstToken),
          outcomes: bucket.outcomes,
        })
      )

      // Stable order: web first (primary), then mcp (internal), then the rest
      // alphabetical so the UI is deterministic run-to-run.
      const sortedChannels = channels.toSorted((a, b) => {
        const ord = channelOrdinal(a.channel) - channelOrdinal(b.channel)
        return ord !== 0 ? ord : a.channel.localeCompare(b.channel)
      })

      return {
        channels: sortedChannels,
        days: options.days,
      }
    },
  }
}
