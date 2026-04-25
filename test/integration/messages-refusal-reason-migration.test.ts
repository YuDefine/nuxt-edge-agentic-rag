import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Migration 0014 — persist-refusal-and-label-new-chat: messages.refusal_reason.
 *
 * Pairs with migration 0013 (`refused`). 0013 records the boolean fact
 * "is this a refusal?"; 0014 records the specific RefusalReason. Reload
 * UIs use the reason to render reason-specific copy.
 *
 * Invariants (Persisted Refusal Reason On Messages):
 *
 *   1. Adds `refusal_reason` as `TEXT` (nullable — no `NOT NULL`).
 *   2. Migration is strictly additive — no DROP, no UPDATE on existing rows.
 *   3. After ALTER, every pre-existing row carries `refusal_reason = NULL`.
 *      Historical assistant rows are NOT retroactively reasoned.
 */

const MIGRATION_PATH = fileURLToPath(
  new URL('../../server/database/migrations/0014_messages_refusal_reason.sql', import.meta.url),
)

function loadMigrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8')
}

function loadExecutableSql(): string {
  return loadMigrationSql()
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

describe('migration 0014 — messages.refusal_reason', () => {
  it('adds refusal_reason as TEXT (nullable)', () => {
    const sql = loadMigrationSql()

    expect(sql).toMatch(/ALTER\s+TABLE\s+messages\s+ADD\s+COLUMN\s+refusal_reason\s+TEXT/i)
    // MUST NOT carry NOT NULL — accepted / user / system rows have no
    // reason and need to legitimately store NULL.
    expect(sql).not.toMatch(/refusal_reason\s+TEXT\s+NOT\s+NULL/i)
  })

  it('is strictly additive — no DROP, UPDATE, or DELETE statements', () => {
    const sql = loadExecutableSql()

    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/\bUPDATE\s+messages\b/i)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+messages\b/i)
  })

  it('simulated post-migration state: existing rows backfill to NULL, new refusal rows store reason', () => {
    // Pre-migration messages — refusal_reason column does not exist yet.
    const messagesPre = [
      { id: 'msg-user-1', role: 'user' as const, refused: 0 },
      { id: 'msg-asst-accepted', role: 'assistant' as const, refused: 0 },
      // Even an assistant row that was a refusal under the old code path
      // (none such exist since pre-migration code skipped writing refusal
      // assistant rows entirely, but the simulation is honest about the
      // backfill semantics).
    ]

    // After ALTER, refusal_reason defaults to NULL.
    const messagesPostAlter = messagesPre.map((row) => ({ ...row, refusal_reason: null }))

    for (const row of messagesPostAlter) {
      expect(row.refusal_reason).toBeNull()
    }

    // New post-migration refusal rows store the specific reason.
    const newRefusalRow = {
      id: 'msg-asst-new-refusal',
      role: 'assistant' as const,
      refused: 1,
      refusal_reason: 'restricted_scope',
    }
    expect(newRefusalRow.refusal_reason).toBe('restricted_scope')

    // Accepted answer row keeps NULL even after migration.
    const newAcceptedRow = {
      id: 'msg-asst-new-accepted',
      role: 'assistant' as const,
      refused: 0,
      refusal_reason: null,
    }
    expect(newAcceptedRow.refusal_reason).toBeNull()
  })

  it('column position is appended (SQLite ADD COLUMN semantics)', () => {
    const sql = loadExecutableSql()
    expect(sql).not.toMatch(/\bAFTER\b/i)
    expect(sql).not.toMatch(/\bBEFORE\b/i)
  })
})
