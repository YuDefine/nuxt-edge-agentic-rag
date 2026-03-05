/**
 * Admin summary dashboard store.
 *
 * SECURITY / GOVERNANCE:
 * - Returns ONLY aggregate counts and coarse trend series.
 * - NEVER selects `query_text`, `raw_query`, or `token_hash` — governance §3.2.
 * - Callers must remain auth-gated via `requireRuntimeAdminSession` AND the
 *   `features.adminDashboard` runtime flag; this store does not re-check auth.
 */

interface D1PreparedStatementLike {
  all<T>(): Promise<{ results?: T[] }>
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export interface AdminDashboardTrendPoint {
  count: number
  date: string
}

interface TrendRow {
  bucket: string
  n: number
}

/**
 * Build an ISO 8601 timestamp N days before `now` (UTC, midnight).
 * Exported for tests; consumers typically call via `createAdminDashboardStore`.
 */
export function isoDaysAgo(now: Date, days: number): string {
  const copy = new Date(now.getTime())
  copy.setUTCDate(copy.getUTCDate() - days)
  copy.setUTCHours(0, 0, 0, 0)
  return copy.toISOString()
}

export function createAdminDashboardStore(
  database: D1DatabaseLike,
  options: { now?: () => Date } = {}
) {
  const now = options.now ?? (() => new Date())

  return {
    async countDocuments(): Promise<number> {
      const row = await database
        .prepare("SELECT COUNT(*) AS n FROM documents WHERE status != 'archived'")
        .first<{ n: number }>()
      return row?.n ?? 0
    },

    async countRecentQueryLogs(sinceDays: number): Promise<number> {
      const threshold = isoDaysAgo(now(), sinceDays)
      const row = await database
        .prepare('SELECT COUNT(*) AS n FROM query_logs WHERE created_at >= ?')
        .bind(threshold)
        .first<{ n: number }>()
      return row?.n ?? 0
    },

    async countActiveTokens(): Promise<number> {
      const row = await database
        .prepare("SELECT COUNT(*) AS n FROM mcp_tokens WHERE status = 'active'")
        .first<{ n: number }>()
      return row?.n ?? 0
    },

    /**
     * Returns daily query counts for the last N days (oldest first), using
     * `substr(created_at, 1, 10)` to bucket by ISO date (UTC).
     * Days with zero queries are omitted — the UI can backfill if needed.
     */
    async listRecentQueryTrend(days: number): Promise<AdminDashboardTrendPoint[]> {
      const threshold = isoDaysAgo(now(), days)
      const result = await database
        .prepare(
          [
            'SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS n',
            'FROM query_logs',
            'WHERE created_at >= ?',
            'GROUP BY bucket',
            'ORDER BY bucket ASC',
          ].join('\n')
        )
        .bind(threshold)
        .all<TrendRow>()

      return (result.results ?? []).map((row) => ({
        count: row.n,
        date: row.bucket,
      }))
    },
  }
}
