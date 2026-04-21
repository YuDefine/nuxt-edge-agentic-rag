/**
 * TD-011 / fk-cascade-repair-for-self-delete — FK cascade invariants.
 *
 * Subject under test: the SQLite schema produced by migration 0010
 * (`0010_fk_cascade_repair.sql`). We validate the DB-layer invariants
 * the `passkey-authentication` Requirement "Passkey-Only Account
 * Self-Deletion Requires Reauth" and the `auth-storage-consistency`
 * Requirement "FK Cascade Policy Supports Account Deletion" depend on:
 *
 *   - `member_role_changes` has no FK on `user_id` → audit tombstones
 *     survive `DELETE FROM "user"`.
 *   - `mcp_tokens.created_by_user_id` is `ON DELETE CASCADE` → user
 *     deletion atomically clears that user's tokens.
 *   - `query_logs.mcp_token_id` is `ON DELETE SET NULL` → user deletion
 *     cascades through mcp_tokens without being RESTRICT-blocked, and
 *     query_logs rows survive with their token attribution nulled
 *     (Decision 2 revision, discovered via the TDD red test in this file
 *     before migration authoring).
 *   - `messages.query_log_id` (`ON DELETE SET NULL`) does NOT get
 *     silently nulled by the rebuild — children-first DROP order is
 *     the guard (verified at migration-authoring time; exercised here
 *     by the row-preservation scenario).
 *
 * We use an in-memory libsql DB (same pattern as
 * `mcp-token-store.spec.ts`) and apply a SQL fragment that matches the
 * post-0010 shape. We do NOT replay the full migration stack — that
 * would pull the full better-auth + document-versions schema graph
 * with no benefit. The point is FK invariants, not migration sequencing.
 *
 * This spec intentionally stays at the DB invariant layer. The real
 * WebAuthn reauth + `/api/auth/account/delete` user journey is covered by
 * manual verification tasks because the browser passkey ceremony cannot
 * be represented faithfully in this libsql fixture.
 *
 * testing-anti-patterns.md §3 & §5: no `db.*` mocks — we execute real
 * SQL against libsql so FK enforcement, CASCADE semantics, and
 * NOT NULL violations are genuine.
 */

import { readFileSync } from 'node:fs'

import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'

type Client = ReturnType<typeof createClient>

const MIGRATION_0010_SQL = readFileSync(
  new URL('../../server/database/migrations/0010_fk_cascade_repair.sql', import.meta.url),
  'utf8',
)

// Minimal pre-0010 schema that still exercises the real migration.
// The table shapes match the source-side column lists consumed by
// `0010_fk_cascade_repair.sql`; only the FK clauses reflect the broken
// pre-fix state.
const PRE_0010_SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL DEFAULT 'user',
    banned INTEGER NOT NULL DEFAULT 0,
    banReason TEXT,
    banExpires INTEGER,
    display_name TEXT NOT NULL
  );

  CREATE TABLE user_profiles (
    id TEXT PRIMARY KEY
  );

  CREATE TABLE document_versions (
    id TEXT PRIMARY KEY
  );

  CREATE TABLE source_chunks (
    id TEXT PRIMARY KEY,
    document_version_id TEXT NOT NULL REFERENCES document_versions(id)
  );

  CREATE TABLE conversations (
    id TEXT PRIMARY KEY
  );

  -- Pre-0010 broken state: FK exists with implicit NO ACTION.
  CREATE TABLE member_role_changes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    from_role TEXT NOT NULL,
    to_role TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES "user"(id)
  );
  CREATE INDEX idx_member_role_changes_user_created
    ON member_role_changes(user_id, created_at);

  -- Pre-0010 broken state: FK exists with implicit NO ACTION.
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
    created_by_user_id TEXT NOT NULL REFERENCES "user"(id)
  );

  -- Pre-0010 broken state: mcp_token_id also has implicit NO ACTION.
  CREATE TABLE query_logs (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
    user_profile_id TEXT REFERENCES user_profiles(id),
    mcp_token_id TEXT REFERENCES mcp_tokens(id),
    environment TEXT NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
    query_redacted_text TEXT NOT NULL,
    risk_flags_json TEXT NOT NULL DEFAULT '[]',
    allowed_access_levels_json TEXT NOT NULL DEFAULT '["internal"]',
    redaction_applied INTEGER NOT NULL DEFAULT 0 CHECK (redaction_applied IN (0, 1)),
    config_snapshot_version TEXT NOT NULL DEFAULT 'v1',
    status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'blocked', 'rejected', 'limited')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    first_token_latency_ms INTEGER,
    completion_latency_ms INTEGER,
    retrieval_score REAL,
    judge_score REAL,
    decision_path TEXT,
    refusal_reason TEXT
  );

  CREATE TABLE citation_records (
    id TEXT PRIMARY KEY,
    query_log_id TEXT NOT NULL REFERENCES query_logs(id) ON DELETE CASCADE,
    document_version_id TEXT NOT NULL REFERENCES document_versions(id),
    source_chunk_id TEXT NOT NULL REFERENCES source_chunks(id),
    citation_locator TEXT NOT NULL,
    chunk_text_snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    query_log_id TEXT REFERENCES query_logs(id) ON DELETE SET NULL,
    user_profile_id TEXT,
    channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content_redacted TEXT NOT NULL,
    risk_flags_json TEXT NOT NULL DEFAULT '[]',
    redaction_applied INTEGER NOT NULL DEFAULT 0 CHECK (redaction_applied IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    citations_json TEXT NOT NULL DEFAULT '[]',
    content_text TEXT
  );
`

async function createPost0010Db(): Promise<Client> {
  const client = createClient({ url: ':memory:' })
  await client.executeMultiple(PRE_0010_SCHEMA)
  await client.executeMultiple(MIGRATION_0010_SQL)
  return client
}

async function seedCitationParents(client: Client, chunkIds: string[]) {
  await client.execute({
    sql: `INSERT OR IGNORE INTO document_versions (id) VALUES ('docv-1')`,
  })

  for (const chunkId of chunkIds) {
    await client.execute({
      sql: `
        INSERT OR IGNORE INTO source_chunks (id, document_version_id)
        VALUES (?, 'docv-1')
      `,
      args: [chunkId],
    })
  }
}

async function seedPasskeyUserWithTokens(
  client: Client,
  options: { userId: string; tokenCount: number },
) {
  const { userId, tokenCount } = options
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, display_name) VALUES (?, ?, NULL, ?)`,
    args: [userId, `test-${userId}`, `test-${userId}`],
  })

  for (let i = 0; i < tokenCount; i += 1) {
    await client.execute({
      sql: `
        INSERT INTO mcp_tokens (
          id, token_hash, name, scopes_json, environment, status, created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        `tok-${userId}-${i}`,
        `hash-${userId}-${i}`,
        `Token ${i}`,
        '[]',
        'local',
        'active',
        userId,
      ],
    })
  }
}

async function insertSelfDeletionTombstone(
  client: Client,
  options: { userId: string; fromRole: string; toRole: string },
) {
  await client.execute({
    sql: `
      INSERT INTO member_role_changes (
        id, user_id, from_role, to_role, changed_by, reason
      )
      VALUES (?, ?, ?, ?, 'system', 'self-deletion')
    `,
    args: [
      `audit-${options.userId}-${Date.now()}`,
      options.userId,
      options.fromRole,
      options.toRole,
    ],
  })
}

async function rowCount(client: Client, table: string, where?: { col: string; val: string }) {
  const sql = where
    ? `SELECT count(*) AS n FROM ${table} WHERE ${where.col} = ?`
    : `SELECT count(*) AS n FROM ${table}`
  const args = where ? [where.val] : []
  const res = await client.execute({ sql, args })
  return Number((res.rows[0] as { n: number | bigint })?.n ?? 0)
}

describe('TD-011 FK cascade invariants after migration 0010', () => {
  let client: Client

  beforeEach(async () => {
    client = await createPost0010Db()
  })

  describe('FK policy declarations', () => {
    it('member_role_changes has no FK on user_id (audit tombstone survives user deletion)', async () => {
      const res = await client.execute(`PRAGMA foreign_key_list(member_role_changes)`)
      expect(res.rows).toHaveLength(0)
    })

    it('mcp_tokens.created_by_user_id FK has ON DELETE CASCADE', async () => {
      const res = await client.execute(`PRAGMA foreign_key_list(mcp_tokens)`)
      // Expect a single FK on created_by_user_id.
      expect(res.rows).toHaveLength(1)
      const fk = res.rows[0] as Record<string, unknown>
      expect(fk.from).toBe('created_by_user_id')
      expect(fk.to).toBe('id')
      expect(fk.table).toBe('user')
      expect(fk.on_delete).toBe('CASCADE')
    })

    it('idx_member_role_changes_user_created index still exists on the rebuilt table', async () => {
      const res = await client.execute(`PRAGMA index_list(member_role_changes)`)
      const names = res.rows.map((r) => (r as Record<string, unknown>).name)
      expect(names).toContain('idx_member_role_changes_user_created')
    })
  })

  describe('Passkey-only user self-deletion flow', () => {
    it('audit tombstone survives when the user row is deleted', async () => {
      const userId = 'u-passkey-only-1'
      await seedPasskeyUserWithTokens(client, { userId, tokenCount: 0 })
      await insertSelfDeletionTombstone(client, {
        userId,
        fromRole: 'guest',
        toRole: 'guest',
      })

      // Sanity: the tombstone is there before the delete.
      expect(await rowCount(client, 'member_role_changes', { col: 'user_id', val: userId })).toBe(1)

      await client.execute({
        sql: `DELETE FROM "user" WHERE id = ?`,
        args: [userId],
      })

      expect(await rowCount(client, 'user', { col: 'id', val: userId })).toBe(0)
      expect(await rowCount(client, 'member_role_changes', { col: 'user_id', val: userId })).toBe(1)

      const reasonRow = await client.execute({
        sql: `
          SELECT reason
          FROM member_role_changes
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `,
        args: [userId],
      })
      expect((reasonRow.rows[0] as { reason: string }).reason).toBe('self-deletion')
    })

    it('mcp_tokens cascade delete when the user row is deleted', async () => {
      const userId = 'u-passkey-with-tokens-1'
      await seedPasskeyUserWithTokens(client, { userId, tokenCount: 3 })

      expect(await rowCount(client, 'mcp_tokens', { col: 'created_by_user_id', val: userId })).toBe(
        3,
      )

      await client.execute({
        sql: `DELETE FROM "user" WHERE id = ?`,
        args: [userId],
      })

      expect(await rowCount(client, 'mcp_tokens', { col: 'created_by_user_id', val: userId })).toBe(
        0,
      )

      const fkCheck = await client.execute(`PRAGMA foreign_key_check(mcp_tokens)`)
      expect(fkCheck.rows).toHaveLength(0)
    })

    it('full self-delete: tombstone written, user deleted, tokens cascade, integrity clean', async () => {
      const userId = 'u-passkey-full-flow'
      await seedPasskeyUserWithTokens(client, { userId, tokenCount: 2 })

      // Application-layer order per server/api/auth/account/delete.post.ts:
      //   1. recordRoleChange({ reason: 'self-deletion' })
      //   2. DELETE FROM "user"
      await insertSelfDeletionTombstone(client, {
        userId,
        fromRole: 'member',
        toRole: 'member',
      })
      await client.execute({
        sql: `DELETE FROM "user" WHERE id = ?`,
        args: [userId],
      })

      // User gone.
      expect(await rowCount(client, 'user', { col: 'id', val: userId })).toBe(0)
      // Tombstone survives.
      expect(await rowCount(client, 'member_role_changes', { col: 'user_id', val: userId })).toBe(1)
      // Tokens cascade away.
      expect(await rowCount(client, 'mcp_tokens', { col: 'created_by_user_id', val: userId })).toBe(
        0,
      )
      // FK check is clean across the whole DB.
      const fkCheck = await client.execute(`PRAGMA foreign_key_check`)
      expect(fkCheck.rows).toHaveLength(0)
    })
  })

  describe('FK NOT NULL guard on mcp_tokens.created_by_user_id', () => {
    it('rejects insert when created_by_user_id references a non-existent user', async () => {
      await expect(
        client.execute({
          sql: `
            INSERT INTO mcp_tokens (
              id, token_hash, name, environment, status, created_by_user_id
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          args: ['tok-orphan', 'hash-orphan', 'Orphan', 'local', 'active', 'u-does-not-exist'],
        }),
      ).rejects.toThrow(/FOREIGN KEY/i)
    })
  })

  describe('query_logs survive with NULL mcp_token_id after user cascade (Decision 2 revision)', () => {
    it('DELETE FROM "user" succeeds even when query_logs reference the cascaded tokens', async () => {
      // Precondition TDD red test (before this revision) showed that
      // query_logs.mcp_token_id with default ON DELETE (NO ACTION) turns
      // the cascade into SQLITE_CONSTRAINT_FOREIGNKEY and rolls the whole
      // `DELETE FROM "user"` back. After Decision 2 revision the FK is
      // SET NULL, so the cascade SHALL succeed.
      const userId = 'u-cascade-with-qlog-1'
      await seedPasskeyUserWithTokens(client, { userId, tokenCount: 1 })
      const tokenId = `tok-${userId}-0`

      await client.execute({
        sql: `
          INSERT INTO query_logs (
            id, channel, mcp_token_id, environment,
            query_redacted_text, status
          )
          VALUES (?, 'mcp', ?, 'local', ?, 'accepted')
        `,
        args: ['ql-1', tokenId, 'redacted question'],
      })

      // The cascade must not raise. If migration 0010 author forgets the
      // SET NULL clause, this line throws SQLITE_CONSTRAINT_FOREIGNKEY.
      await client.execute({
        sql: `DELETE FROM "user" WHERE id = ?`,
        args: [userId],
      })

      const qlogs = await client.execute({
        sql: `SELECT mcp_token_id FROM query_logs WHERE id = 'ql-1'`,
      })
      expect(qlogs.rows).toHaveLength(1)
      expect((qlogs.rows[0] as { mcp_token_id: unknown }).mcp_token_id).toBeNull()
    })

    it('direct DELETE FROM mcp_tokens also nulls query_logs.mcp_token_id without deleting logs', async () => {
      const userId = 'u-direct-token-delete'
      await seedPasskeyUserWithTokens(client, { userId, tokenCount: 1 })
      const tokenId = `tok-${userId}-0`

      await client.execute({
        sql: `
          INSERT INTO query_logs (
            id, channel, mcp_token_id, environment,
            query_redacted_text, status
          )
          VALUES (?, 'mcp', ?, 'local', ?, 'accepted')
        `,
        args: ['ql-direct-token-delete', tokenId, 'redacted direct token delete'],
      })

      await client.execute({
        sql: `DELETE FROM mcp_tokens WHERE id = ?`,
        args: [tokenId],
      })

      const qlogs = await client.execute({
        sql: `
          SELECT mcp_token_id, query_redacted_text, status
          FROM query_logs
          WHERE id = 'ql-direct-token-delete'
        `,
      })
      expect(qlogs.rows).toHaveLength(1)
      const row = qlogs.rows[0] as Record<string, unknown>
      expect(row.mcp_token_id).toBeNull()
      expect(row.query_redacted_text).toBe('redacted direct token delete')
      expect(row.status).toBe('accepted')
    })

    it('preserves query_logs columns other than mcp_token_id after the cascade', async () => {
      const userId = 'u-cascade-with-qlog-2'
      await seedPasskeyUserWithTokens(client, { userId, tokenCount: 1 })
      const tokenId = `tok-${userId}-0`

      const createdAtIso = '2026-04-21T10:00:00.000Z'
      await client.execute({
        sql: `
          INSERT INTO query_logs (
            id, channel, mcp_token_id, environment,
            query_redacted_text, status, created_at
          )
          VALUES (?, 'mcp', ?, 'production', ?, 'accepted', ?)
        `,
        args: ['ql-preserve', tokenId, 'what is our leave policy', createdAtIso],
      })

      await client.execute({
        sql: `DELETE FROM "user" WHERE id = ?`,
        args: [userId],
      })

      const res = await client.execute({
        sql: `
          SELECT channel, environment, query_redacted_text, status, created_at, mcp_token_id
          FROM query_logs WHERE id = 'ql-preserve'
        `,
      })
      const row = res.rows[0] as Record<string, unknown>
      expect(row.channel).toBe('mcp')
      expect(row.environment).toBe('production')
      expect(row.query_redacted_text).toBe('what is our leave policy')
      expect(row.status).toBe('accepted')
      expect(row.created_at).toBe(createdAtIso)
      expect(row.mcp_token_id).toBeNull()
    })

    it('full flow: passkey-only user with mixed (tokened + NULL) query_logs + citations + tombstone', async () => {
      const userId = 'u-full-flow'
      await seedPasskeyUserWithTokens(client, { userId, tokenCount: 2 })
      const tokenA = `tok-${userId}-0`
      const tokenB = `tok-${userId}-1`

      await seedCitationParents(client, ['chunk-a', 'chunk-b', 'chunk-web'])

      // Two logs from this user's tokens, one log with already-NULL token
      // (pre-existing NULL, e.g. a web-channel log), one citation per log.
      await client.executeMultiple(`
        INSERT INTO query_logs (id, channel, mcp_token_id, environment, query_redacted_text, status)
          VALUES ('ql-a', 'mcp', '${tokenA}', 'local', 'q-a', 'accepted');
        INSERT INTO query_logs (id, channel, mcp_token_id, environment, query_redacted_text, status)
          VALUES ('ql-b', 'mcp', '${tokenB}', 'local', 'q-b', 'accepted');
        INSERT INTO query_logs (id, channel, mcp_token_id, environment, query_redacted_text, status)
          VALUES ('ql-web', 'web', NULL, 'local', 'q-web', 'accepted');
        INSERT INTO citation_records (
          id, query_log_id, document_version_id, source_chunk_id,
          citation_locator, chunk_text_snapshot, expires_at
        )
          VALUES ('cit-a', 'ql-a', 'docv-1', 'chunk-a', 'doc1#1', 'snap-a', '2030-01-01T00:00:00.000Z');
        INSERT INTO citation_records (
          id, query_log_id, document_version_id, source_chunk_id,
          citation_locator, chunk_text_snapshot, expires_at
        )
          VALUES ('cit-b', 'ql-b', 'docv-1', 'chunk-b', 'doc2#1', 'snap-b', '2030-01-01T00:00:00.000Z');
        INSERT INTO citation_records (
          id, query_log_id, document_version_id, source_chunk_id,
          citation_locator, chunk_text_snapshot, expires_at
        )
          VALUES ('cit-web', 'ql-web', 'docv-1', 'chunk-web', 'doc3#1', 'snap-web', '2030-01-01T00:00:00.000Z');
        INSERT INTO messages (id, query_log_id, channel, role, content_redacted)
          VALUES ('m-a', 'ql-a', 'mcp', 'assistant', 'answer-a');
      `)

      // Tombstone first (app layer contract in delete.post.ts).
      await insertSelfDeletionTombstone(client, {
        userId,
        fromRole: 'member',
        toRole: 'member',
      })

      // The cascade path is: DELETE user → CASCADE mcp_tokens →
      // SET NULL on query_logs.mcp_token_id (for ql-a, ql-b; ql-web
      // was already NULL and unaffected). citation_records are NOT
      // cascaded because the token cascade stops at query_logs — no
      // query_logs row is deleted.
      await client.execute({
        sql: `DELETE FROM "user" WHERE id = ?`,
        args: [userId],
      })

      expect(await rowCount(client, 'user', { col: 'id', val: userId })).toBe(0)
      expect(await rowCount(client, 'member_role_changes', { col: 'user_id', val: userId })).toBe(1)
      expect(await rowCount(client, 'mcp_tokens', { col: 'created_by_user_id', val: userId })).toBe(
        0,
      )

      // All three query_logs survive.
      expect(await rowCount(client, 'query_logs')).toBe(3)

      // ql-a and ql-b have mcp_token_id = NULL; ql-web was already NULL.
      const qs = await client.execute({
        sql: `SELECT id, mcp_token_id FROM query_logs ORDER BY id`,
      })
      const byId = Object.fromEntries(
        qs.rows.map((r) => {
          const row = r as Record<string, unknown>
          return [row.id as string, row.mcp_token_id]
        }),
      )
      expect(byId['ql-a']).toBeNull()
      expect(byId['ql-b']).toBeNull()
      expect(byId['ql-web']).toBeNull()

      // citation_records all survive (no cascade into them).
      expect(await rowCount(client, 'citation_records')).toBe(3)

      // messages.query_log_id retained (SET NULL only triggers when
      // query_logs row is deleted, not when mcp_token_id is nulled).
      const msgRes = await client.execute({
        sql: `SELECT query_log_id FROM messages WHERE id = 'm-a'`,
      })
      expect((msgRes.rows[0] as { query_log_id: string }).query_log_id).toBe('ql-a')

      // Integrity clean.
      const fkCheck = await client.execute(`PRAGMA foreign_key_check`)
      expect(fkCheck.rows).toHaveLength(0)
    })
  })
})
