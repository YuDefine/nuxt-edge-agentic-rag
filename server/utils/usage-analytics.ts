import { assertNever } from '#shared/utils/assert-never'
import type { UsageRange, UsageSnapshot, UsageTimelineBucket } from '#shared/types/usage'
import { WORKERS_AI_FREE_QUOTA_PER_DAY } from '#shared/types/usage'

/**
 * Minimal subset of a Cloudflare AI Gateway log row consumed by usage
 * aggregation. Real responses include many more fields; we intentionally
 * pick only the ones Workers AI currently surfaces for usage accounting
 * so the type stays forward-compatible when Cloudflare extends the log.
 */
export interface AnalyticsApiLog {
  created_at: string
  cached?: boolean
  tokens_in?: number
  tokens_out?: number
  neurons?: number
}

export interface AnalyticsApiResponse {
  result?: AnalyticsApiLog[]
  success: boolean
  errors?: Array<{ code?: number; message?: string }>
}

export interface AnalyticsFetchContext {
  accountId: string
  apiToken: string
  gatewayId: string
}

export interface AnalyticsFetchInput extends AnalyticsFetchContext {
  range: UsageRange
  fetchImpl?: typeof globalThis.fetch
  now?: Date
}

export interface RangeWindow {
  start: Date
  end: Date
  bucketSizeMs: number
  bucketCount: number
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
// `today` 的日界以 Asia/Taipei 為準（UTC+8）。本專案交付對象是雲科大
// （校園在台灣），admin 看「今日用量」時預期的是 Taipei 的日切換。
// 硬編 offset 比引 Intl timezone API 輕，且台灣無 DST 切換。
const TAIPEI_UTC_OFFSET_MS = 8 * HOUR_MS

/**
 * Derive [start, end] window + bucket granularity for a range.
 *
 * - `today` 以 Taipei 00:00–now 為範圍，hourly 24 buckets
 * - `7d` buckets daily (7 buckets ending at "now")
 * - `30d` buckets daily (30 buckets ending at "now")
 */
export function rangeToWindow(range: UsageRange, now: Date = new Date()): RangeWindow {
  switch (range) {
    case 'today': {
      // 轉到 Taipei 本地時間找當日 00:00，再轉回 UTC 作為 window start。
      const taipeiNow = new Date(now.getTime() + TAIPEI_UTC_OFFSET_MS)
      taipeiNow.setUTCHours(0, 0, 0, 0)
      const start = new Date(taipeiNow.getTime() - TAIPEI_UTC_OFFSET_MS)
      return {
        start,
        end: new Date(now),
        bucketSizeMs: HOUR_MS,
        bucketCount: 24,
      }
    }
    case '7d': {
      const start = new Date(now.getTime() - 7 * DAY_MS)
      return { start, end: new Date(now), bucketSizeMs: DAY_MS, bucketCount: 7 }
    }
    case '30d': {
      const start = new Date(now.getTime() - 30 * DAY_MS)
      return { start, end: new Date(now), bucketSizeMs: DAY_MS, bucketCount: 30 }
    }
    default:
      return assertNever(range, 'rangeToWindow')
  }
}

/**
 * Fetch AI Gateway logs for the given range from Cloudflare Analytics API.
 *
 * Throws on non-success status so callers can convert to 503 with a
 * sanitized user message (never leak upstream body). The raw
 * `AnalyticsApiResponse.errors` is preserved on the thrown error's
 * `cause` so evlog can record it without surfacing to the HTTP client.
 */
export async function fetchAnalyticsLogs(input: AnalyticsFetchInput): Promise<AnalyticsApiLog[]> {
  const window = rangeToWindow(input.range, input.now)
  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/ai-gateway/gateways/${input.gatewayId}/logs`,
  )
  url.searchParams.set('start_date', window.start.toISOString())
  url.searchParams.set('end_date', window.end.toISOString())

  const fetchImpl = input.fetchImpl ?? globalThis.fetch
  const response = await fetchImpl(url.toString(), {
    headers: {
      Authorization: `Bearer ${input.apiToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Cloudflare Analytics API responded ${response.status}`)
  }

  const payload = (await response.json()) as AnalyticsApiResponse
  if (!payload.success) {
    const first = payload.errors?.[0]
    throw new Error(
      `Cloudflare Analytics API error${first?.code ? ` [${first.code}]` : ''}: ${first?.message ?? 'unknown'}`,
    )
  }

  return payload.result ?? []
}

/**
 * Aggregate raw logs into the shape consumed by `/admin/usage` UI.
 *
 * - Tokens: sum `tokens_in` + `tokens_out` across all logs
 * - Neurons: prefer per-log `neurons` when present; fall back to total
 *   tokens as a conservative upper bound (Cloudflare bills Neurons based
 *   on compute, not tokens, but the rough proportionality gives admins
 *   an early warning even when the log schema omits the field).
 * - Cache hit rate: cached / total
 * - Free quota remaining: clamped at zero once consumption exceeds 10k
 * - Timeline: bucketed by window granularity (see `rangeToWindow`)
 */
export function aggregateUsage(
  logs: AnalyticsApiLog[],
  options: { range: UsageRange; now?: Date },
): UsageSnapshot {
  const now = options.now ?? new Date()
  const window = rangeToWindow(options.range, now)

  let inputTokens = 0
  let outputTokens = 0
  let cachedCount = 0
  let neuronsUsed = 0

  for (const log of logs) {
    const logTokensIn = log.tokens_in ?? 0
    const logTokensOut = log.tokens_out ?? 0
    inputTokens += logTokensIn
    outputTokens += logTokensOut
    if (log.cached) {
      cachedCount += 1
    }
    // Per-log fallback：log 若有 `neurons` 欄用原值，否則以該 log 的總 tokens
    // 當保守估計。避免 Cloudflare 逐步 rollout `neurons` 欄時「有欄的計、
    // 沒欄的貢獻 0」造成整段低估，admin 撞額度卻看到低估讀數。
    neuronsUsed += typeof log.neurons === 'number' ? log.neurons : logTokensIn + logTokensOut
  }

  const totalRequests = logs.length
  const totalTokens = inputTokens + outputTokens
  const cacheHitRate = totalRequests > 0 ? cachedCount / totalRequests : 0

  return {
    tokens: { input: inputTokens, output: outputTokens, total: totalTokens },
    neurons: {
      used: neuronsUsed,
      freeQuotaPerDay: WORKERS_AI_FREE_QUOTA_PER_DAY,
      remaining: Math.max(WORKERS_AI_FREE_QUOTA_PER_DAY - neuronsUsed, 0),
    },
    requests: {
      total: totalRequests,
      cached: cachedCount,
      cacheHitRate,
    },
    timeline: buildTimeline(logs, window),
    lastUpdatedAt: now.toISOString(),
  }
}

function buildTimeline(logs: AnalyticsApiLog[], window: RangeWindow): UsageTimelineBucket[] {
  const buckets: UsageTimelineBucket[] = []
  const startMs = window.start.getTime()

  for (let i = 0; i < window.bucketCount; i += 1) {
    const bucketStartMs = startMs + i * window.bucketSizeMs
    buckets.push({
      timestamp: new Date(bucketStartMs).toISOString(),
      tokens: 0,
      requests: 0,
      cacheHits: 0,
    })
  }

  const windowSpanMs = window.bucketCount * window.bucketSizeMs

  for (const log of logs) {
    const logMs = Date.parse(log.created_at)
    if (Number.isNaN(logMs)) continue

    const offset = logMs - startMs
    // Skip out-of-window logs so late-arriving rows (that squeaked in
    // during Cloudflare's ingestion window) don't pile into the last
    // bucket and cause a false spike.
    if (offset < 0 || offset >= windowSpanMs) continue

    const index = Math.floor(offset / window.bucketSizeMs)
    const bucket = buckets[index]
    if (!bucket) continue

    bucket.tokens += (log.tokens_in ?? 0) + (log.tokens_out ?? 0)
    bucket.requests += 1
    if (log.cached) {
      bucket.cacheHits += 1
    }
  }

  return buckets
}
