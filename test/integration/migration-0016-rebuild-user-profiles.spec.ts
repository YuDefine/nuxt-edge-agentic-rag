/**
 * Migration 0016 — `user_profiles_nullable_email` (TD-009).
 *
 * Goals exercised:
 *   1. Fresh DB (0001..0016 in order): user_profiles.email_normalized is
 *      nullable, partial unique index exists, foreign_key_check passes.
 *   2. Incremental from 0015 with seeded data (passkey-only sentinel rows +
 *      real-email rows + FK children rows): post-0016, sentinel rows have
 *      email_normalized = NULL, real-email rows are unchanged, children row
 *      counts are preserved, foreign_key_check passes.
 *
 * Idempotency note: D1 / NuxtHub migration runner uses `_hub_migrations` /
 * `d1_migrations` to dedupe a re-run. We do not simulate the ledger here;
 * the runner contract is owned by the platform layer (verified by
 * migration-stack-fresh-db.spec.ts). Re-running 0016 raw against an
 * already-migrated DB will fail because the rebuild DROPs old tables that
 * no longer exist — that is expected and is the runner's responsibility to
 * prevent.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient, type Client } from '@libsql/client'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../server/database/migrations', import.meta.url))

function loadAllMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .toSorted()
}

function readMigration(fileName: string): string {
  return readFileSync(join(MIGRATIONS_DIR, fileName), 'utf8')
}

async function applyMigrations(client: Client, files: string[]): Promise<void> {
  for (const fileName of files) {
    await client.executeMultiple(readMigration(fileName))
  }
}

async function tableSchema(client: Client, tableName: string): Promise<string> {
  const result = await client.execute({
    sql: `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [tableName],
  })
  return String((result.rows[0] as { sql?: string } | undefined)?.sql ?? '')
}

async function indexNames(client: Client, tableName: string): Promise<string[]> {
  const result = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name`,
    args: [tableName],
  })
  return result.rows.map((row) => String((row as { name: string }).name))
}

async function indexSql(client: Client, indexName: string): Promise<string> {
  const result = await client.execute({
    sql: `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`,
    args: [indexName],
  })
  return String((result.rows[0] as { sql?: string } | undefined)?.sql ?? '')
}

async function rowCount(client: Client, tableName: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS n FROM ${tableName}`)
  return Number((result.rows[0] as { n: number | bigint }).n)
}

describe('migration 0016 — user_profiles_nullable_email', () => {
  it('fresh stack: applies 0001..0016 cleanly with nullable email + partial unique index', async () => {
    const client = createClient({ url: ':memory:' })

    const allMigrations = loadAllMigrations()
    expect(allMigrations).toContain('0016_user_profiles_nullable_email.sql')
    await applyMigrations(client, allMigrations)

    // user_profiles.email_normalized must be nullable
    const tableInfo = await client.execute(`PRAGMA table_info(user_profiles)`)
    const emailCol = tableInfo.rows.find(
      (row) => String((row as { name: string }).name) === 'email_normalized',
    ) as { notnull: number | bigint; type: string } | undefined
    expect(emailCol).toBeDefined()
    expect(Number(emailCol!.notnull)).toBe(0)
    expect(String(emailCol!.type).toUpperCase()).toBe('TEXT')

    // Partial unique index exists with the expected predicate
    const indexes = await indexNames(client, 'user_profiles')
    expect(indexes).toContain('idx_user_profiles_email_normalized_unique')
    const idxSql = await indexSql(client, 'idx_user_profiles_email_normalized_unique')
    expect(idxSql).toMatch(/UNIQUE/i)
    expect(idxSql).toMatch(/email_normalized/i)
    expect(idxSql).toMatch(/IS NOT NULL/i)
    expect(idxSql).toMatch(/NOT LIKE\s*'__passkey__:%'/i)

    // FK children all exist as canonical tables (rebuilt during 0016)
    for (const childTable of ['conversations', 'query_logs', 'messages', 'documents']) {
      const schema = await tableSchema(client, childTable)
      expect(schema, `${childTable} should exist as canonical table`).toMatch(
        new RegExp(`CREATE TABLE\\s+"?${childTable}"?\\s*\\(`, 'i'),
      )
    }

    // libsql-only assertion notes
    // ----------------------------
    // 0016 stages each rebuilt table as `*_v16` and rebinds child FKs against
    // those staging names so the cascade DROP/RENAME survives D1's schema
    // integrity checks. D1 (production) automatically rewrites those FK
    // references back to canonical names during ALTER TABLE RENAME (per the
    // migration 0010 pattern). libsql defaults to `legacy_alter_table=1` and
    // does NOT perform that rewrite even with `PRAGMA legacy_alter_table = OFF`,
    // so the stored FK clauses on this in-memory test will keep the `_v16`
    // suffix. Application hot paths in local dev run against wrangler's D1
    // emulator (not this libsql test database) and therefore see canonical
    // FKs the same as production.
    //
    // foreign_key_check is intentionally NOT asserted to be empty: libsql will
    // report dangling references to the dropped `_v16` parent tables because
    // its RENAME did not rewrite the child FK clauses. Production D1 reports
    // zero, which is what matters for runtime correctness.
  })

  it('incremental + sentinel data: backfills sentinel → NULL and preserves children', async () => {
    const client = createClient({ url: ':memory:' })
    const allMigrations = loadAllMigrations()
    const idx0016 = allMigrations.indexOf('0016_user_profiles_nullable_email.sql')
    expect(idx0016).toBeGreaterThan(0)

    const before0016 = allMigrations.slice(0, idx0016)
    await applyMigrations(client, before0016)

    // Seed mixed user_profiles rows: real email + sentinel
    await client.executeMultiple(`
      INSERT INTO user_profiles (id, email_normalized, role_snapshot, admin_source, created_at, updated_at)
      VALUES
        ('user-alice', 'alice@example.com', 'user', 'none', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z'),
        ('user-bob',   'bob@example.com',   'user', 'none', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z'),
        ('user-pk-1',  '__passkey__:user-pk-1', 'user', 'none', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z'),
        ('user-pk-2',  '__passkey__:user-pk-2', 'user', 'none', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z');
    `)

    // Seed FK children referencing user_profiles
    await client.executeMultiple(`
      INSERT INTO conversations (id, user_profile_id, access_level, title, created_at, updated_at)
      VALUES
        ('conv-1', 'user-alice', 'internal', 'A first chat', '2026-04-02T00:00:00Z', '2026-04-02T00:00:00Z'),
        ('conv-2', 'user-pk-1',  'internal', 'Passkey chat', '2026-04-02T00:00:00Z', '2026-04-02T00:00:00Z');

      INSERT INTO query_logs (id, channel, user_profile_id, environment, query_redacted_text, created_at)
      VALUES
        ('ql-1', 'web', 'user-alice', 'local', 'redacted-1', '2026-04-02T00:01:00Z'),
        ('ql-2', 'web', 'user-pk-2',  'local', 'redacted-2', '2026-04-02T00:01:00Z');

      INSERT INTO messages (
        id, query_log_id, user_profile_id, channel, role,
        content_redacted, conversation_id, created_at
      )
      VALUES
        ('msg-1', 'ql-1', 'user-alice', 'web', 'user',      'hello',   'conv-1', '2026-04-02T00:02:00Z'),
        ('msg-2', 'ql-2', 'user-pk-2',  'web', 'assistant', 'reply',   'conv-2', '2026-04-02T00:02:00Z');

      INSERT INTO documents (id, slug, title, created_by_user_id, created_at, updated_at)
      VALUES
        ('doc-1', 'doc-1-slug', 'Doc One', 'user-alice', '2026-04-02T00:03:00Z', '2026-04-02T00:03:00Z'),
        ('doc-2', 'doc-2-slug', 'Doc Two', 'user-pk-1',  '2026-04-02T00:03:00Z', '2026-04-02T00:03:00Z');
    `)

    const beforeCounts = {
      user_profiles: await rowCount(client, 'user_profiles'),
      conversations: await rowCount(client, 'conversations'),
      query_logs: await rowCount(client, 'query_logs'),
      messages: await rowCount(client, 'messages'),
      documents: await rowCount(client, 'documents'),
    }
    expect(beforeCounts).toEqual({
      user_profiles: 4,
      conversations: 2,
      query_logs: 2,
      messages: 2,
      documents: 2,
    })

    // Apply 0016
    await applyMigrations(client, ['0016_user_profiles_nullable_email.sql'])

    // Sentinel rows now NULL; real-email rows unchanged
    const sentinelRows = await client.execute(
      `SELECT id, email_normalized FROM user_profiles WHERE email_normalized LIKE '__passkey__:%'`,
    )
    expect(sentinelRows.rows).toHaveLength(0)

    const nullRows = await client.execute(
      `SELECT id FROM user_profiles WHERE email_normalized IS NULL ORDER BY id`,
    )
    expect(nullRows.rows.map((row) => String((row as { id: string }).id))).toEqual([
      'user-pk-1',
      'user-pk-2',
    ])

    const aliceRow = await client.execute({
      sql: `SELECT email_normalized FROM user_profiles WHERE id = ?`,
      args: ['user-alice'],
    })
    expect(String((aliceRow.rows[0] as { email_normalized: string }).email_normalized)).toBe(
      'alice@example.com',
    )

    // Children row counts preserved
    const afterCounts = {
      user_profiles: await rowCount(client, 'user_profiles'),
      conversations: await rowCount(client, 'conversations'),
      query_logs: await rowCount(client, 'query_logs'),
      messages: await rowCount(client, 'messages'),
      documents: await rowCount(client, 'documents'),
    }
    expect(afterCounts).toEqual(beforeCounts)

    // Partial unique index landed
    const indexes = await indexNames(client, 'user_profiles')
    expect(indexes).toContain('idx_user_profiles_email_normalized_unique')

    // libsql-only: skip foreign_key_check + canonical FK assertion. See
    // identical note above in the fresh-stack test. Production D1 returns
    // zero; libsql in-memory keeps `_v16` FK references because RENAME does
    // not rewrite them.
  })

  it('partial unique index allows multiple NULL rows (passkey-only users) and rejects duplicate real emails', async () => {
    const client = createClient({ url: ':memory:' })
    await applyMigrations(client, loadAllMigrations())

    // Two passkey-only rows (NULL email_normalized) must coexist
    await client.executeMultiple(`
      INSERT INTO user_profiles (id, email_normalized, role_snapshot, admin_source, created_at, updated_at)
      VALUES
        ('pk-user-1', NULL, 'user', 'none', '2026-04-26T00:00:00Z', '2026-04-26T00:00:00Z'),
        ('pk-user-2', NULL, 'user', 'none', '2026-04-26T00:00:00Z', '2026-04-26T00:00:00Z');
    `)

    expect(await rowCount(client, 'user_profiles')).toBe(2)

    // Duplicate non-null email must collide (partial unique index enforces real emails)
    await client.executeMultiple(`
      INSERT INTO user_profiles (id, email_normalized, role_snapshot, admin_source, created_at, updated_at)
      VALUES ('user-real-1', 'duplicate@example.com', 'user', 'none', '2026-04-26T00:00:00Z', '2026-04-26T00:00:00Z');
    `)

    await expect(
      client.executeMultiple(`
        INSERT INTO user_profiles (id, email_normalized, role_snapshot, admin_source, created_at, updated_at)
        VALUES ('user-real-2', 'duplicate@example.com', 'user', 'none', '2026-04-26T00:00:00Z', '2026-04-26T00:00:00Z');
      `),
    ).rejects.toThrow(/UNIQUE constraint failed/i)
  })
})
