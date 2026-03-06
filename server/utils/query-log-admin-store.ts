/**
 * Admin-scoped query_logs store for admin list / detail endpoints.
 *
 * SECURITY: The SELECT projection deliberately excludes any raw / un-redacted
 * query text. The only query-body column returned is `query_redacted_text`.
 * Do NOT add columns that could leak source text (governance §3.2).
 */

import { parseStringArrayJson } from '#shared/utils/parse-string-array'

export interface AdminQueryLogListFilter {
  channel?: string
  endDate?: string
  environment?: string
  limit: number
  offset: number
  redactionApplied?: boolean
  startDate?: string
  status?: string
}

export interface AdminQueryLogRow {
  channel: string
  configSnapshotVersion: string
  createdAt: string
  environment: string
  id: string
  queryRedactedText: string
  redactionApplied: boolean
  riskFlagsJson: string
  status: string
}

export interface AdminQueryLogDetail extends AdminQueryLogRow {
  allowedAccessLevels: string[]
  riskFlags: string[]
}

/**
 * Build Drizzle WHERE conditions shared by list and count queries. Keeping
 * this in one place prevents drift when a new filter column is added.
 */
async function buildQueryLogConditions(filter: Omit<AdminQueryLogListFilter, 'limit' | 'offset'>) {
  const { eq, gte, lte } = await import('drizzle-orm')
  const { schema } = await import('hub:db')

  const conditions = []
  if (filter.channel) {
    conditions.push(eq(schema.queryLogs.channel, filter.channel))
  }
  if (filter.status) {
    conditions.push(eq(schema.queryLogs.status, filter.status))
  }
  if (filter.environment) {
    conditions.push(eq(schema.queryLogs.environment, filter.environment))
  }
  if (typeof filter.redactionApplied === 'boolean') {
    conditions.push(eq(schema.queryLogs.redactionApplied, filter.redactionApplied))
  }
  if (filter.startDate) {
    conditions.push(gte(schema.queryLogs.createdAt, filter.startDate))
  }
  if (filter.endDate) {
    conditions.push(lte(schema.queryLogs.createdAt, filter.endDate))
  }

  return conditions
}

export function createQueryLogAdminStore() {
  return {
    async listQueryLogs(filter: AdminQueryLogListFilter): Promise<AdminQueryLogRow[]> {
      const { db, schema } = await import('hub:db')
      const { and, desc } = await import('drizzle-orm')

      const conditions = await buildQueryLogConditions(filter)
      const query = db
        .select({
          id: schema.queryLogs.id,
          channel: schema.queryLogs.channel,
          status: schema.queryLogs.status,
          environment: schema.queryLogs.environment,
          queryRedactedText: schema.queryLogs.queryRedactedText,
          riskFlagsJson: schema.queryLogs.riskFlagsJson,
          redactionApplied: schema.queryLogs.redactionApplied,
          configSnapshotVersion: schema.queryLogs.configSnapshotVersion,
          createdAt: schema.queryLogs.createdAt,
        })
        .from(schema.queryLogs)

      const rows = await (conditions.length > 0 ? query.where(and(...conditions)) : query)
        .orderBy(desc(schema.queryLogs.createdAt))
        .limit(filter.limit)
        .offset(filter.offset)

      return rows.map((row) => ({
        channel: row.channel,
        configSnapshotVersion: row.configSnapshotVersion,
        createdAt: row.createdAt,
        environment: row.environment,
        id: row.id,
        queryRedactedText: row.queryRedactedText,
        redactionApplied: Boolean(row.redactionApplied),
        riskFlagsJson: row.riskFlagsJson,
        status: row.status,
      }))
    },

    async countQueryLogs(
      filter: Omit<AdminQueryLogListFilter, 'limit' | 'offset'>
    ): Promise<number> {
      const { db, schema } = await import('hub:db')
      const { and, count } = await import('drizzle-orm')

      const conditions = await buildQueryLogConditions(filter)
      const query = db.select({ n: count() }).from(schema.queryLogs)
      const rows = await (conditions.length > 0 ? query.where(and(...conditions)) : query)

      return rows[0]?.n ?? 0
    },

    async getQueryLogById(id: string): Promise<AdminQueryLogDetail | null> {
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
        })
        .from(schema.queryLogs)
        .where(eq(schema.queryLogs.id, id))
        .limit(1)

      if (!row) {
        return null
      }

      return {
        channel: row.channel,
        configSnapshotVersion: row.configSnapshotVersion,
        createdAt: row.createdAt,
        environment: row.environment,
        id: row.id,
        queryRedactedText: row.queryRedactedText,
        redactionApplied: Boolean(row.redactionApplied),
        riskFlagsJson: row.riskFlagsJson,
        status: row.status,
        allowedAccessLevels: parseStringArrayJson(row.allowedAccessLevelsJson),
        riskFlags: parseStringArrayJson(row.riskFlagsJson),
      }
    },
  }
}
