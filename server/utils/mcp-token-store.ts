import { randomBytes } from 'node:crypto'

import type { McpTokenRecord } from '#shared/types/knowledge'

import { hashMcpToken } from './mcp-auth'

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
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
