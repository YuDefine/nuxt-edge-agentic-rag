import { randomBytes } from 'node:crypto'

import type { McpTokenRecord } from '#shared/types/knowledge'
import { parseStringArrayJson } from '#shared/utils/parse-string-array'

import { getDrizzleDb } from './database'
import { hashMcpToken } from './mcp-auth'

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
    createdByUserId: string | null
    environment: string
    expiresAt: string | null
    name: string
    scopes: string[]
  },
  options: {
    createId?: () => string
    createSecret?: () => string
    now?: () => Date
  } = {},
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
      createdByUserId: input.createdByUserId,
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

/**
 * MCP token store used by the MCP auth path (token provisioning + lookup).
 *
 * Implementation uses Drizzle ORM via `hub:db` so that local dev (libsql)
 * and production (Cloudflare D1) share a single code path. Historical
 * versions went through the raw D1 `$client.prepare()` API which broke
 * under libsql's proxy (TD-001 in `docs/tech-debt.md`).
 */
export function createMcpTokenStore() {
  return {
    async createToken(record: McpTokenRecord): Promise<void> {
      const { db, schema } = await getDrizzleDb()
      await db.insert(schema.mcpTokens).values({
        id: record.id,
        tokenHash: record.tokenHash,
        name: record.name,
        scopesJson: record.scopesJson,
        environment: record.environment,
        status: record.status,
        expiresAt: record.expiresAt,
        lastUsedAt: record.lastUsedAt,
        revokedAt: record.revokedAt,
        revokedReason: record.revokedReason,
        createdAt: record.createdAt,
        createdByUserId: record.createdByUserId,
      })
    },

    async findUsableTokenByHash(
      tokenHash: string,
      environment: string,
    ): Promise<McpTokenRecord | null> {
      const { db, schema } = await getDrizzleDb()
      const { and, eq } = await import('drizzle-orm')

      const [row] = await db
        .select({
          id: schema.mcpTokens.id,
          tokenHash: schema.mcpTokens.tokenHash,
          name: schema.mcpTokens.name,
          scopesJson: schema.mcpTokens.scopesJson,
          environment: schema.mcpTokens.environment,
          status: schema.mcpTokens.status,
          expiresAt: schema.mcpTokens.expiresAt,
          lastUsedAt: schema.mcpTokens.lastUsedAt,
          revokedAt: schema.mcpTokens.revokedAt,
          revokedReason: schema.mcpTokens.revokedReason,
          createdAt: schema.mcpTokens.createdAt,
          createdByUserId: schema.mcpTokens.createdByUserId,
        })
        .from(schema.mcpTokens)
        .where(
          and(
            eq(schema.mcpTokens.tokenHash, tokenHash),
            eq(schema.mcpTokens.environment, environment),
            eq(schema.mcpTokens.status, 'active'),
          ),
        )
        .limit(1)

      if (!row) {
        return null
      }

      // `expires_at` check stays in JS so NULL (no expiry) is treated the
      // same way on every backend — Drizzle's SQL-level `IS NULL OR > now`
      // would be more efficient but introduces dialect-specific gotchas
      // and this table stays small.
      if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
        return null
      }

      return {
        createdAt: row.createdAt,
        createdByUserId: row.createdByUserId,
        environment: row.environment,
        expiresAt: row.expiresAt,
        id: row.id,
        lastUsedAt: row.lastUsedAt,
        name: row.name,
        revokedAt: row.revokedAt,
        revokedReason: row.revokedReason,
        scopesJson: row.scopesJson,
        status: row.status,
        tokenHash: row.tokenHash,
      }
    },

    async touchLastUsedAt(tokenId: string, usedAt: string): Promise<void> {
      const { db, schema } = await getDrizzleDb()
      const { eq } = await import('drizzle-orm')

      await db
        .update(schema.mcpTokens)
        .set({ lastUsedAt: usedAt })
        .where(eq(schema.mcpTokens.id, tokenId))
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
      options: { now?: () => Date } = {},
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
