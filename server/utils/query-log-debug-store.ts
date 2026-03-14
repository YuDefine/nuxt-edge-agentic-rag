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

export function createQueryLogDebugStore() {
  return {
    async getDebugQueryLogById(id: string): Promise<DebugQueryLogDetail | null> {
      const { db, schema } = await import('hub:db')
      const { eq } = await import('drizzle-orm')

      const [row] = await db
        .select({
          id: schema.queryLogs.id,
          channel: schema.queryLogs.channel,
          status: schema.queryLogs.status,
          environment: schema.queryLogs.environment,
          queryRedactedText: schema.queryLogs.queryRedactedText,
          riskFlagsJson: schema.queryLogs.riskFlagsJson,
          allowedAccessLevelsJson: schema.queryLogs.allowedAccessLevelsJson,
          redactionApplied: schema.queryLogs.redactionApplied,
          configSnapshotVersion: schema.queryLogs.configSnapshotVersion,
          createdAt: schema.queryLogs.createdAt,
          firstTokenLatencyMs: schema.queryLogs.firstTokenLatencyMs,
          completionLatencyMs: schema.queryLogs.completionLatencyMs,
          retrievalScore: schema.queryLogs.retrievalScore,
          judgeScore: schema.queryLogs.judgeScore,
          decisionPath: schema.queryLogs.decisionPath,
          refusalReason: schema.queryLogs.refusalReason,
        })
        .from(schema.queryLogs)
        .where(eq(schema.queryLogs.id, id))
        .limit(1)

      if (!row) {
        return null
      }

      return {
        allowedAccessLevels: parseStringArrayJson(row.allowedAccessLevelsJson),
        channel: row.channel,
        citationsJson: '[]', // detail store doesn't join messages; reserved for future.
        completionLatencyMs: row.completionLatencyMs,
        configSnapshotVersion: row.configSnapshotVersion,
        createdAt: row.createdAt,
        decisionPath: row.decisionPath,
        environment: row.environment,
        firstTokenLatencyMs: row.firstTokenLatencyMs,
        id: row.id,
        judgeScore: row.judgeScore,
        queryRedactedText: row.queryRedactedText,
        redactionApplied: Boolean(row.redactionApplied),
        refusalReason: row.refusalReason,
        retrievalScore: row.retrievalScore,
        riskFlags: parseStringArrayJson(row.riskFlagsJson),
        status: row.status,
      }
    },

    async summarizeLatency(options: LatencySummaryOptions): Promise<LatencySummary> {
      const { db, schema } = await import('hub:db')
      const { gte } = await import('drizzle-orm')

      const now = options.now ?? new Date()
      const sinceMs = now.getTime() - options.days * 24 * 60 * 60 * 1000
      const since = new Date(sinceMs).toISOString()

      const rows = await db
        .select({
          channel: schema.queryLogs.channel,
          status: schema.queryLogs.status,
          decisionPath: schema.queryLogs.decisionPath,
          firstTokenLatencyMs: schema.queryLogs.firstTokenLatencyMs,
          completionLatencyMs: schema.queryLogs.completionLatencyMs,
        })
        .from(schema.queryLogs)
        .where(gte(schema.queryLogs.createdAt, since))

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
        bucket.firstToken.push(row.firstTokenLatencyMs)
        bucket.completion.push(row.completionLatencyMs)
        const category = classifyOutcome({
          status: row.status,
          decision_path: row.decisionPath,
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
        }),
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
