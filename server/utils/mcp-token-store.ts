import { randomBytes } from 'node:crypto'

import type { McpTokenRecord } from '#shared/types/knowledge'
import { parseStringArrayJson } from '#shared/utils/parse-string-array'

import { getD1Database, getDrizzleDb } from './database'
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

export function createMcpTokenStore() {
  return {
    async createToken(record: McpTokenRecord): Promise<void> {
      const database = (await getD1Database()) as D1DatabaseLike
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
      const database = (await getD1Database()) as D1DatabaseLike
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
      const database = (await getD1Database()) as D1DatabaseLike
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

/**
 * Admin-scoped MCP token store used by admin list / revoke endpoints.
 *
 * SECURITY: Selected columns deliberately exclude `token_hash`. Callers must
 * not add `token_hash` to the projection — the hash is lookup-only.
 */
export function createMcpTokenAdminStore() {
  return {
    async listTokensForAdmin(input: ListTokensInput): Promise<AdminMcpTokenSummary[]> {
      const { db, schema } = await getDrizzleDb()
      const { and, desc, eq } = await import('drizzle-orm')

      const conditions = input.status ? [eq(schema.mcpTokens.status, input.status)] : []
      const query = db
        .select({
          id: schema.mcpTokens.id,
          name: schema.mcpTokens.name,
          scopesJson: schema.mcpTokens.scopesJson,
          status: schema.mcpTokens.status,
          expiresAt: schema.mcpTokens.expiresAt,
          lastUsedAt: schema.mcpTokens.lastUsedAt,
          revokedAt: schema.mcpTokens.revokedAt,
          createdAt: schema.mcpTokens.createdAt,
        })
        .from(schema.mcpTokens)

      const rows = await (conditions.length > 0 ? query.where(and(...conditions)) : query)
        .orderBy(desc(schema.mcpTokens.createdAt))
        .limit(input.limit)
        .offset(input.offset)

      return rows.map((row) => ({
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        id: row.id,
        lastUsedAt: row.lastUsedAt,
        name: row.name,
        revokedAt: row.revokedAt,
        scopes: parseStringArrayJson(row.scopesJson),
        status: row.status,
      }))
    },

    async countTokensForAdmin(filter: { status?: string }): Promise<number> {
      const { db, schema } = await getDrizzleDb()
      const { count, eq } = await import('drizzle-orm')

      const query = db.select({ n: count() }).from(schema.mcpTokens)
      const rows = await (filter.status
        ? query.where(eq(schema.mcpTokens.status, filter.status))
        : query)

      return rows[0]?.n ?? 0
    },

    async revokeTokenById(
      tokenId: string,
      options: { now?: () => Date } = {}
    ): Promise<McpTokenRevokeOutcome> {
      const { db, schema } = await getDrizzleDb()
      const { and, eq, ne } = await import('drizzle-orm')

      const [existing] = await db
        .select({
          id: schema.mcpTokens.id,
          status: schema.mcpTokens.status,
          revokedAt: schema.mcpTokens.revokedAt,
        })
        .from(schema.mcpTokens)
        .where(eq(schema.mcpTokens.id, tokenId))
        .limit(1)

      if (!existing) {
        return { outcome: 'not-found' }
      }

      if (existing.status === 'revoked') {
        return {
          outcome: 'already-revoked',
          token: {
            id: existing.id,
            revokedAt: existing.revokedAt ?? '',
            status: existing.status,
          },
        }
      }

      // Guard clause `AND status != 'revoked'` keeps the UPDATE idempotent
      // under concurrent revokes. Re-SELECT afterwards so the returned
      // `revokedAt` reflects the DB's actual persisted timestamp — not a
      // speculative one from this request that may have lost the race.
      const revokedAt = (options.now ?? (() => new Date()))().toISOString()
      await db
        .update(schema.mcpTokens)
        .set({ status: 'revoked', revokedAt })
        .where(and(eq(schema.mcpTokens.id, tokenId), ne(schema.mcpTokens.status, 'revoked')))

      const [actual] = await db
        .select({
          id: schema.mcpTokens.id,
          status: schema.mcpTokens.status,
          revokedAt: schema.mcpTokens.revokedAt,
        })
        .from(schema.mcpTokens)
        .where(eq(schema.mcpTokens.id, tokenId))
        .limit(1)

      if (!actual || actual.status !== 'revoked') {
        return { outcome: 'not-found' }
      }

      return {
        outcome: 'revoked',
        token: {
          id: actual.id,
          revokedAt: actual.revokedAt ?? revokedAt,
          status: actual.status,
        },
      }
    },
  }
}
