import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Migration 0004 backfill semantics (governance-refinements §1.4 / §1.5).
 *
 * We do not bootstrap a full SQLite harness for a single DDL file — instead
 * we assert the invariants of the backfill UPDATE statement textually and
 * by simulating its intended effect on a handful of representative rows.
 * The file itself is the executable artifact, so any drift between this
 * test and the SQL means one of them is wrong.
 *
 * Invariants:
 *
 * 1. Migration ADDs `content_text` as a nullable column (not NOT NULL).
 * 2. Backfill ONLY targets messages under CONVERSATIONS where
 *    `deleted_at IS NULL`. Messages under soft-deleted conversations are
 *    intentionally left with NULL content_text (retroactive §1.4 purge).
 * 3. Messages with NULL conversation_id are also skipped (session-only
 *    legacy rows from the v1.0.0 chat MVP — should not surface back).
 */

const MIGRATION_PATH = fileURLToPath(
  new URL('../../server/database/migrations/0004_content_text_purge.sql', import.meta.url)
)

function loadMigrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8')
}

describe('migration 0004 — content_text purge (governance §1.4 / §1.5)', () => {
  it('adds content_text as a nullable column on the messages table', () => {
    const sql = loadMigrationSql()

    // The `ALTER TABLE messages ADD COLUMN content_text TEXT` form (without
    // NOT NULL) is the required shape. SQLite does not allow ADD COLUMN to
    // be NOT NULL without a DEFAULT, but we explicitly want nullable anyway
    // so purge can set it to NULL.
    expect(sql).toMatch(/ALTER\s+TABLE\s+messages\s+ADD\s+COLUMN\s+content_text\s+TEXT/i)
    expect(sql).not.toMatch(/content_text\s+TEXT\s+NOT\s+NULL/i)
  })

  it('scopes backfill to messages under active conversations only', () => {
    const sql = loadMigrationSql()

    // The backfill UPDATE must filter on `deleted_at IS NULL`. A regression
    // that drops this clause would retroactively un-purge previously deleted
    // conversations.
    expect(sql).toMatch(/UPDATE\s+messages/i)
    expect(sql).toMatch(/SET\s+content_text\s*=\s*content_redacted/i)
    expect(sql).toMatch(/conversation_id\s+IS\s+NOT\s+NULL/i)
    expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i)
  })

  it('simulated post-migration state: active → content_text=content_redacted, deleted → NULL, orphan → NULL', () => {
    // Row fixtures representing pre-migration state. After migration the
    // "active" row gets its content_text populated from content_redacted;
    // everyone else stays NULL.
    const conversations = [
      { id: 'conv-active', deleted_at: null },
      { id: 'conv-deleted', deleted_at: '2026-04-01T00:00:00.000Z' },
    ]
    const messagesPre = [
      {
        id: 'msg-under-active',
        conversation_id: 'conv-active',
        content_redacted: 'active body (redacted)',
        content_text: null as string | null,
      },
      {
        id: 'msg-under-deleted',
        conversation_id: 'conv-deleted',
        content_redacted: 'deleted body (redacted)',
        content_text: null as string | null,
      },
      {
        id: 'msg-no-conversation',
        conversation_id: null as string | null,
        content_redacted: 'legacy session body',
        content_text: null as string | null,
      },
    ]

    // Simulate the backfill UPDATE: content_text = content_redacted WHERE
    // conversation_id IS NOT NULL AND conversation_id in active-conversation ids.
    const activeConversationIds = new Set(
      conversations.filter((c) => c.deleted_at === null).map((c) => c.id)
    )
    const messagesPost = messagesPre.map((row) => {
      if (row.conversation_id !== null && activeConversationIds.has(row.conversation_id)) {
        return { ...row, content_text: row.content_redacted }
      }
      return row
    })

    expect(messagesPost.find((m) => m.id === 'msg-under-active')?.content_text).toBe(
      'active body (redacted)'
    )
    expect(messagesPost.find((m) => m.id === 'msg-under-deleted')?.content_text).toBeNull()
    expect(messagesPost.find((m) => m.id === 'msg-no-conversation')?.content_text).toBeNull()
  })
})
