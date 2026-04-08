/**
 * TD-001 — `createMcpTokenStore()` migration from D1 raw API → Drizzle ORM.
 *
 * Historically the store used `db.$client.prepare(...).bind(...).first()`,
 * which is D1-specific. Local dev (libsql) stubs `$client` with a Proxy
 * that does not implement `prepare`, so the call path crashed with
 * `database.prepare is not a function` — blocking local execution of
 * `/mcp` Bearer-token auth and the B16 #10 manual check.
 *
 * These tests exercise the migrated Drizzle path against a real in-memory
 * libsql instance. Passing here means the same code will run on local
 * dev (libsql) and on Cloudflare D1 (which also speaks Drizzle's SQLite
 * dialect), without per-backend branching.
 *
 * We deliberately use a real DB (not a mock chain) so the assertions
 * reflect actual SQL behaviour — partial-field updates, WHERE-clause
 * composition, ordering of columns, etc. Mocking drizzle would just
 * verify that our mock returns what we told it to (anti-pattern
 * `testing-anti-patterns.md §1`).
 */
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '../../server/db/schema'

type LibsqlDb = ReturnType<typeof drizzle<typeof schema>>

async function createInMemoryDb(): Promise<LibsqlDb> {
  const client = createClient({ url: ':memory:' })
  const db = drizzle(client, { schema })

  // Minimal schema: only the table under test. Matches
  // `server/database/migrations/0001_bootstrap_v1_core.sql` for the
  // mcp_tokens table plus the `created_by_user_id` column added in
  // migration 0006. Keeping this table-scoped avoids pulling in the
  // entire migration stack (which references better-auth tables).
  await client.execute(`
    CREATE TABLE mcp_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      environment TEXT NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
      expires_at TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      revoked_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id TEXT
    )
  `)

  return db
}

function activeTokenRecord(overrides: Partial<typeof schema.mcpTokens.$inferInsert> = {}) {
  return {
    id: 'tok-1',
    tokenHash: 'hash-alpha',
    name: 'CI Token',
    scopesJson: JSON.stringify(['knowledge.ask']),
    environment: 'local',
    status: 'active',
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    revokedReason: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    createdByUserId: 'admin-1',
    ...overrides,
  }
}

async function loadStore(db: LibsqlDb) {
  vi.resetModules()
  vi.doMock('hub:db', () => ({ db, schema }))
  // The store does `await import('drizzle-orm')` for operators. Let the
  // real module resolve so the Drizzle runtime sees genuine column refs.
  vi.doUnmock('drizzle-orm')

  const mod = await import('../../server/utils/mcp-token-store')
  return mod.createMcpTokenStore()
}

describe('createMcpTokenStore (TD-001: libsql compatibility via Drizzle)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  describe('createToken + findUsableTokenByHash', () => {
    it('round-trips an inserted active token by (tokenHash, environment)', async () => {
      const db = await createInMemoryDb()
      const store = await loadStore(db)

      const record = activeTokenRecord()
      await store.createToken(record)

      const found = await store.findUsableTokenByHash(record.tokenHash, record.environment)

      expect(found).not.toBeNull()
      expect(found).toMatchObject({
        id: record.id,
        tokenHash: record.tokenHash,
        name: record.name,
        environment: record.environment,
        status: 'active',
        scopesJson: record.scopesJson,
        createdByUserId: record.createdByUserId,
      })
    })

    it('returns null when the environment does not match (scope isolation)', async () => {
      const db = await createInMemoryDb()
      const store = await loadStore(db)

      await store.createToken(activeTokenRecord({ environment: 'production' }))

      const found = await store.findUsableTokenByHash('hash-alpha', 'local')
      expect(found).toBeNull()
    })

    it('returns null when the token has been revoked (status filter)', async () => {
      const db = await createInMemoryDb()
      const store = await loadStore(db)

      await store.createToken(
        activeTokenRecord({
          status: 'revoked',
          revokedAt: '2026-04-20T12:00:00.000Z',
          revokedReason: 'admin-revoked',
        }),
      )

      const found = await store.findUsableTokenByHash('hash-alpha', 'local')
      expect(found).toBeNull()
    })
  })

  describe('expiry handling', () => {
    it('returns null when expires_at is in the past', async () => {
      const db = await createInMemoryDb()
      const store = await loadStore(db)

      await store.createToken(
        activeTokenRecord({
          expiresAt: '2020-01-01T00:00:00.000Z',
        }),
      )

      const found = await store.findUsableTokenByHash('hash-alpha', 'local')
      expect(found).toBeNull()
    })

    it('returns the record when expires_at is in the future', async () => {
      const db = await createInMemoryDb()
      const store = await loadStore(db)

      const futureIso = new Date(Date.now() + 60_000).toISOString()
      await store.createToken(
        activeTokenRecord({
          expiresAt: futureIso,
        }),
      )

      const found = await store.findUsableTokenByHash('hash-alpha', 'local')
      expect(found).not.toBeNull()
      expect(found?.expiresAt).toBe(futureIso)
    })

    it('returns the record when expires_at is NULL (no expiry)', async () => {
      const db = await createInMemoryDb()
      const store = await loadStore(db)

      await store.createToken(activeTokenRecord({ expiresAt: null }))

      const found = await store.findUsableTokenByHash('hash-alpha', 'local')
      expect(found).not.toBeNull()
      expect(found?.expiresAt).toBeNull()
    })
  })

  describe('touchLastUsedAt', () => {
    it('updates last_used_at on the targeted row without touching others', async () => {
      const db = await createInMemoryDb()
      const store = await loadStore(db)

      await store.createToken(activeTokenRecord({ id: 'tok-1', tokenHash: 'hash-alpha' }))
      await store.createToken(activeTokenRecord({ id: 'tok-2', tokenHash: 'hash-beta' }))

      const usedAt = '2026-04-20T15:30:00.000Z'
      await store.touchLastUsedAt('tok-1', usedAt)

      const touched = await store.findUsableTokenByHash('hash-alpha', 'local')
      const untouched = await store.findUsableTokenByHash('hash-beta', 'local')

      expect(touched?.lastUsedAt).toBe(usedAt)
      expect(untouched?.lastUsedAt).toBeNull()
    })

    it('is a no-op when the token id does not exist', async () => {
      const db = await createInMemoryDb()
      const store = await loadStore(db)

      await store.createToken(activeTokenRecord())

      await expect(
        store.touchLastUsedAt('does-not-exist', '2026-04-20T00:00:00.000Z'),
      ).resolves.toBeUndefined()

      const found = await store.findUsableTokenByHash('hash-alpha', 'local')
      expect(found?.lastUsedAt).toBeNull()
    })
  })
})
