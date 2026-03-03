/**
 * Admin-scoped query_logs store for admin list / detail endpoints.
 *
 * SECURITY: The SELECT projection deliberately excludes any raw / un-redacted
 * query text. The only query-body column returned is `query_redacted_text`.
 * Do NOT add columns that could leak source text (governance §3.2).
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

interface QueryLogDbRow {
  allowed_access_levels_json: string
  channel: string
  config_snapshot_version: string
  created_at: string
  environment: string
  id: string
  query_redacted_text: string
  redaction_applied: number
  risk_flags_json: string
  status: string
}

function toRowSummary(row: QueryLogDbRow): AdminQueryLogRow {
  return {
    channel: row.channel,
    configSnapshotVersion: row.config_snapshot_version,
    createdAt: row.created_at,
    environment: row.environment,
    id: row.id,
    queryRedactedText: row.query_redacted_text,
    redactionApplied: row.redaction_applied === 1,
    riskFlagsJson: row.risk_flags_json,
    status: row.status,
  }
}

/**
 * Build the shared WHERE clauses used by both list and count queries. Keeping
 * this in one place prevents drift when a new filter column is added.
 */
function buildQueryLogWhereClauses(filter: Omit<AdminQueryLogListFilter, 'limit' | 'offset'>): {
  binds: unknown[]
  clauses: string[]
} {
  const binds: unknown[] = []
  const clauses: string[] = []

  if (filter.channel) {
    clauses.push('channel = ?')
    binds.push(filter.channel)
  }
  if (filter.status) {
    clauses.push('status = ?')
    binds.push(filter.status)
  }
  if (filter.environment) {
    clauses.push('environment = ?')
    binds.push(filter.environment)
  }
  if (typeof filter.redactionApplied === 'boolean') {
    clauses.push('redaction_applied = ?')
    binds.push(filter.redactionApplied ? 1 : 0)
  }
  if (filter.startDate) {
    clauses.push('created_at >= ?')
    binds.push(filter.startDate)
  }
  if (filter.endDate) {
    clauses.push('created_at <= ?')
    binds.push(filter.endDate)
  }

  return { binds, clauses }
}

export function createQueryLogAdminStore(database: D1DatabaseLike) {
  return {
    async listQueryLogs(filter: AdminQueryLogListFilter): Promise<AdminQueryLogRow[]> {
      const { binds, clauses } = buildQueryLogWhereClauses(filter)

      const sql = [
        'SELECT id, channel, status, environment, query_redacted_text,',
        '  risk_flags_json, redaction_applied, config_snapshot_version, created_at',
        'FROM query_logs',
        clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
        'ORDER BY created_at DESC',
        'LIMIT ? OFFSET ?',
      ]
        .filter(Boolean)
        .join('\n')

      binds.push(filter.limit, filter.offset)

      const result = await database
        .prepare(sql)
        .bind(...binds)
        .all<QueryLogDbRow>()

      return (result.results ?? []).map(toRowSummary)
    },

    async countQueryLogs(
      filter: Omit<AdminQueryLogListFilter, 'limit' | 'offset'>
    ): Promise<number> {
      const { binds, clauses } = buildQueryLogWhereClauses(filter)

      const sql = [
        'SELECT COUNT(*) AS n',
        'FROM query_logs',
        clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      const row = await database
        .prepare(sql)
        .bind(...binds)
        .first<{ n: number }>()
      return row?.n ?? 0
    },

    async getQueryLogById(id: string): Promise<AdminQueryLogDetail | null> {
      const row = await database
        .prepare(
          [
            'SELECT id, channel, status, environment, query_redacted_text,',
            '  risk_flags_json, allowed_access_levels_json, redaction_applied,',
            '  config_snapshot_version, created_at',
            'FROM query_logs',
            'WHERE id = ?',
            'LIMIT 1',
          ].join('\n')
        )
        .bind(id)
        .first<QueryLogDbRow>()

      if (!row) {
        return null
      }

      return {
        ...toRowSummary(row),
        allowedAccessLevels: parseStringArrayJson(row.allowed_access_levels_json),
        riskFlags: parseStringArrayJson(row.risk_flags_json),
      }
    },
  }
}
