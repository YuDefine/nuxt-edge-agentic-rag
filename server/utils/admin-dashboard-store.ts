/**
 * Admin summary dashboard store.
 *
 * SECURITY / GOVERNANCE:
 * - Returns ONLY aggregate counts and coarse trend series.
 * - NEVER selects `query_text`, `raw_query`, or `token_hash` — governance §3.2.
 * - Callers must remain auth-gated via `requireRuntimeAdminSession` AND the
 *   `features.adminDashboard` runtime flag; this store does not re-check auth.
 */

export interface AdminDashboardTrendPoint {
  count: number
  date: string
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

export function createAdminDashboardStore(options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date())

  return {
    async countDocuments(): Promise<number> {
      const { db, schema } = await import('hub:db')
      const { count, ne } = await import('drizzle-orm')

      const rows = await db
        .select({ n: count() })
        .from(schema.documents)
        .where(ne(schema.documents.status, 'archived'))

      return rows[0]?.n ?? 0
    },

    async countRecentQueryLogs(sinceDays: number): Promise<number> {
      const { db, schema } = await import('hub:db')
      const { count, gte } = await import('drizzle-orm')

      const threshold = isoDaysAgo(now(), sinceDays)
      const rows = await db
        .select({ n: count() })
        .from(schema.queryLogs)
        .where(gte(schema.queryLogs.createdAt, threshold))

      return rows[0]?.n ?? 0
    },

    async countActiveTokens(): Promise<number> {
      const { db, schema } = await import('hub:db')
      const { count, eq } = await import('drizzle-orm')

      const rows = await db
        .select({ n: count() })
        .from(schema.mcpTokens)
        .where(eq(schema.mcpTokens.status, 'active'))

      return rows[0]?.n ?? 0
    },

    /**
     * Returns daily query counts for the last N days (oldest first), using
     * `substr(created_at, 1, 10)` to bucket by ISO date (UTC).
     * Days with zero queries are omitted — the UI can backfill if needed.
     */
    async listRecentQueryTrend(days: number): Promise<AdminDashboardTrendPoint[]> {
      const { db, schema } = await import('hub:db')
      const { count, gte, sql } = await import('drizzle-orm')

      const threshold = isoDaysAgo(now(), days)
      const bucketExpr = sql<string>`substr(${schema.queryLogs.createdAt}, 1, 10)`
      const rows = await db
        .select({ bucket: bucketExpr, n: count() })
        .from(schema.queryLogs)
        .where(gte(schema.queryLogs.createdAt, threshold))
        .groupBy(bucketExpr)
        .orderBy(bucketExpr)

      return rows.map((row) => ({
        count: row.n,
        date: row.bucket,
      }))
    },
  }
}
