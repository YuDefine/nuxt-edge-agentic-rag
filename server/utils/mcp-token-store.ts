import { randomBytes } from 'node:crypto'

import type { McpTokenRecord } from '#shared/types/knowledge'
import { parseStringArrayJson } from '#shared/utils/parse-string-array'

import { hashMcpToken } from './mcp-auth'

interface D1PreparedStatementLike {
  all<T>(): Promise<{ results?: T[] }>
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

/**
 * Admin-facing view of an MCP token. **MUST NOT** include `token_hash` — the
 * hash is only used internally for lookup and must never leak to admin UIs.
 */
export interface AdminMcpTokenSummary {
  createdAt: string
  expiresAt: string | null
  id: string
  lastUsedAt: string | null
  name: string
  revokedAt: string | null
  scopes: string[]
  status: string
}

export type McpTokenRevokeOutcome =
  | {
      outcome: 'not-found'
    }
  | {
      outcome: 'revoked' | 'already-revoked'
      token: { id: string; revokedAt: string; status: string }
    }

function defaultCreateId(): string {
  return crypto.randomUUID()
}

function defaultCreateSecret(): string {
  return randomBytes(24).toString('base64url')
}

export function buildProvisionedMcpToken(
  input: {
    environment: string
    expiresAt: string | null
    name: string
    scopes: string[]
  },
  options: {
    createId?: () => string
    createSecret?: () => string
    now?: () => Date
  } = {}
): {
  plaintextToken: string
  record: McpTokenRecord
} {
  const plaintextToken = (options.createSecret ?? defaultCreateSecret)()
  const createdAt = (options.now ?? (() => new Date()))().toISOString()

  return {
    plaintextToken,
    record: {
      createdAt,
      environment: input.environment,
      expiresAt: input.expiresAt,
      id: (options.createId ?? defaultCreateId)(),
      lastUsedAt: null,
      name: input.name,
      revokedAt: null,
      revokedReason: null,
      scopesJson: JSON.stringify([...new Set(input.scopes)]),
      status: 'active',
      tokenHash: hashMcpToken(plaintextToken),
    },
  }
}

export function createMcpTokenStore(database: D1DatabaseLike) {
  return {
    async createToken(record: McpTokenRecord): Promise<void> {
      await database
        .prepare(
          [
            'INSERT INTO mcp_tokens (',
            '  id, token_hash, name, scopes_json, environment, status, expires_at, last_used_at, revoked_at, revoked_reason, created_at',
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ].join('\n')
        )
        .bind(
          record.id,
          record.tokenHash,
          record.name,
          record.scopesJson,
          record.environment,
          record.status,
          record.expiresAt,
          record.lastUsedAt,
          record.revokedAt,
          record.revokedReason,
          record.createdAt
        )
        .run()
    },

    async findUsableTokenByHash(
      tokenHash: string,
      environment: string
    ): Promise<McpTokenRecord | null> {
      const row = await database
        .prepare(
          [
            'SELECT',
            '  id, token_hash, name, scopes_json, environment, status, expires_at, last_used_at, revoked_at, revoked_reason, created_at',
            'FROM mcp_tokens',
            'WHERE token_hash = ?',
            '  AND environment = ?',
            "  AND status = 'active'",
            'LIMIT 1',
          ].join('\n')
        )
        .bind(tokenHash, environment)
        .first<{
          created_at: string
          environment: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          revoked_reason: string | null
          scopes_json: string
          status: string
          token_hash: string
        }>()

      if (!row) {
        return null
      }

      if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
        return null
      }

      return {
        createdAt: row.created_at,
        environment: row.environment,
        expiresAt: row.expires_at,
        id: row.id,
        lastUsedAt: row.last_used_at,
        name: row.name,
        revokedAt: row.revoked_at,
        revokedReason: row.revoked_reason,
        scopesJson: row.scopes_json,
        status: row.status,
        tokenHash: row.token_hash,
      }
    },

    async touchLastUsedAt(tokenId: string, usedAt: string): Promise<void> {
      await database
        .prepare(['UPDATE mcp_tokens', 'SET last_used_at = ?', 'WHERE id = ?'].join('\n'))
        .bind(usedAt, tokenId)
        .run()
    },
  }
}

interface ListTokensInput {
  limit: number
  offset: number
  status?: string
}

interface McpTokenAdminRow {
  created_at: string
  expires_at: string | null
  id: string
  last_used_at: string | null
  name: string
  revoked_at: string | null
  scopes_json: string
  status: string
}

function toAdminSummary(row: McpTokenAdminRow): AdminMcpTokenSummary {
  return {
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    lastUsedAt: row.last_used_at,
    name: row.name,
    revokedAt: row.revoked_at,
    scopes: parseStringArrayJson(row.scopes_json),
    status: row.status,
  }
}

/**
 * Admin-scoped MCP token store used by admin list / revoke endpoints.
 *
 * SECURITY: Selected columns deliberately exclude `token_hash`. Callers must
 * not add `token_hash` to the projection — the hash is lookup-only.
 */
export function createMcpTokenAdminStore(database: D1DatabaseLike) {
  return {
    async listTokensForAdmin(input: ListTokensInput): Promise<AdminMcpTokenSummary[]> {
      const base = [
        'SELECT id, name, scopes_json, status, expires_at, last_used_at, revoked_at, created_at',
        'FROM mcp_tokens',
      ]
      const binds: unknown[] = []
      if (input.status) {
        base.push('WHERE status = ?')
        binds.push(input.status)
      }
      base.push('ORDER BY created_at DESC')
      base.push('LIMIT ? OFFSET ?')
      binds.push(input.limit, input.offset)

      const result = await database
        .prepare(base.join('\n'))
        .bind(...binds)
        .all<McpTokenAdminRow>()

      return (result.results ?? []).map(toAdminSummary)
    },

    async countTokensForAdmin(filter: { status?: string }): Promise<number> {
      const binds: unknown[] = []
      const where: string[] = []
      if (filter.status) {
        where.push('status = ?')
        binds.push(filter.status)
      }
      const sql = [
        'SELECT COUNT(*) AS n FROM mcp_tokens',
        where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      const row = await database
        .prepare(sql)
        .bind(...binds)
        .first<{ n: number }>()
      return row?.n ?? 0
    },

    async revokeTokenById(
      tokenId: string,
      options: { now?: () => Date } = {}
    ): Promise<McpTokenRevokeOutcome> {
      const existing = await database
        .prepare('SELECT id, status, revoked_at FROM mcp_tokens WHERE id = ? LIMIT 1')
        .bind(tokenId)
        .first<{ id: string; revoked_at: string | null; status: string }>()

      if (!existing) {
        return { outcome: 'not-found' }
      }

      if (existing.status === 'revoked') {
        return {
          outcome: 'already-revoked',
          token: {
            id: existing.id,
            revokedAt: existing.revoked_at ?? '',
            status: existing.status,
          },
        }
      }

      // Guard clause `AND status != 'revoked'` keeps the UPDATE idempotent
      // under concurrent revokes. Re-SELECT afterwards so the returned
      // `revokedAt` reflects the DB's actual persisted timestamp — not a
      // speculative one from this request that may have lost the race.
      const revokedAt = (options.now ?? (() => new Date()))().toISOString()
      await database
        .prepare(
          "UPDATE mcp_tokens SET status = 'revoked', revoked_at = ? WHERE id = ? AND status != 'revoked'"
        )
        .bind(revokedAt, tokenId)
        .run()

      const actual = await database
        .prepare('SELECT id, status, revoked_at FROM mcp_tokens WHERE id = ? LIMIT 1')
        .bind(tokenId)
        .first<{ id: string; revoked_at: string | null; status: string }>()

      if (!actual || actual.status !== 'revoked') {
        return { outcome: 'not-found' }
      }

      return {
        outcome: 'revoked',
        token: {
          id: actual.id,
          revokedAt: actual.revoked_at ?? revokedAt,
          status: actual.status,
        },
      }
    },
  }
}
