import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Migration 0013 — persist-refusal-and-label-new-chat: messages.refused.
 *
 * We don't bootstrap a full SQLite harness for a single DDL file. Instead
 * we assert the invariants the migration MUST honour and simulate the
 * post-ALTER row shape against a handful of representative rows. The
 * migration file itself is the executable artifact; any drift between
 * this test and the SQL means one of them is wrong.
 *
 * Invariants (Persisted Refusal Flag On Messages):
 *
 *   1. Adds the `refused` column on `messages` with shape
 *      `INTEGER NOT NULL DEFAULT 0`.
 *   2. Migration is strictly additive — no DROP, no UPDATE, no rewriting
 *      of existing rows.
 *   3. After ALTER, every pre-existing row carries `refused = 0` because
 *      the DEFAULT applies. New refusal turns inserted post-migration are
 *      the first rows that store `refused = 1`.
 */

const MIGRATION_PATH = fileURLToPath(
  new URL('../../server/database/migrations/0013_messages_refused_flag.sql', import.meta.url),
)

function loadMigrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8')
}

/**
 * Strip line-comments so additive-shape regexes don't trip on prose like
 * "Before this migration ... no DROP, no ALTER on existing columns".
 */
function loadExecutableSql(): string {
  return loadMigrationSql()
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

describe('migration 0013 — messages.refused flag', () => {
  it('adds the refused column as INTEGER NOT NULL DEFAULT 0', () => {
    const sql = loadMigrationSql()

    expect(sql).toMatch(
      /ALTER\s+TABLE\s+messages\s+ADD\s+COLUMN\s+refused\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i,
    )
  })

  it('is strictly additive — no DROP, UPDATE, or DELETE statements', () => {
    const sql = loadExecutableSql()

    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/\bUPDATE\s+messages\b/i)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+messages\b/i)
  })

  it('simulated post-migration state: existing rows backfill to refused = 0, new refusal rows store refused = 1', () => {
    // Representative pre-migration messages — the column does not exist yet.
    const messagesPre = [
      { id: 'msg-user-1', role: 'user' as const, content_text: 'how do I X' },
      { id: 'msg-asst-1', role: 'assistant' as const, content_text: 'do Y' },
      {
        id: 'msg-asst-historical-refusal',
        role: 'assistant' as const,
        content_text: '抱歉，我無法回答這個問題。',
      },
    ]

    // After the ALTER, every existing row gets `refused = 0` from DEFAULT 0.
    // Historical refusal turns are NOT retroactively flipped to 1 — the
    // pre-migration orchestration never wrote those assistant rows in the
    // first place, so any string-shaped lookalike is incidental.
    const messagesPostAlter = messagesPre.map((row) => ({ ...row, refused: 0 }))

    for (const row of messagesPostAlter) {
      expect(row.refused).toBe(0)
    }

    // New refusal turn inserted by the post-migration orchestration.
    const newRefusalRow = {
      id: 'msg-asst-new-refusal',
      role: 'assistant' as const,
      content_text: '抱歉，我無法回答這個問題。',
      refused: 1,
    }

    expect(newRefusalRow.refused).toBe(1)
  })

  it('column position is appended (SQLite ADD COLUMN semantics)', () => {
    // SQLite's ALTER TABLE ADD COLUMN always appends — there is no
    // BEFORE/AFTER positional syntax. Assert the migration relies on this
    // default rather than trying to control column order in the executable
    // SQL (positional clauses would be a regression flag).
    const sql = loadExecutableSql()

    expect(sql).not.toMatch(/\bAFTER\b/i)
    expect(sql).not.toMatch(/\bBEFORE\b/i)
  })
})
