import { describe, expect, it } from 'vitest'

/**
 * passkey-authentication — Bidirectional credential binding (tasks.md §6.5).
 *
 * Three paths covered:
 *   (A) Google-first → add passkey: plugin native endpoint; session-scoped.
 *       Validated via structure (Passkey plugin `requireSession: true` default).
 *   (B) Passkey-first → link Google: `user.email` goes NULL → Google email.
 *   (C) Cross-account conflict: new Google email already owned by another
 *       user.id → HTTP 409.
 *
 * The hook logic itself lives inside `databaseHooks.user.update.before`
 * in `server/auth.config.ts`. The test mirrors the branching to validate
 * the decision invariants without wiring the whole better-auth runtime.
 */

type UserRow = { id: string; email: string | null }

function buildConflictCheck(existingRows: UserRow[]) {
  return (ctxUserId: string | null, nextEmail: string | null | undefined) => {
    if (!nextEmail || !ctxUserId) return { conflict: false }
    const conflict = existingRows.find((row) => row.email === nextEmail && row.id !== ctxUserId)
    return {
      conflict: Boolean(conflict),
      conflictUserId: conflict?.id ?? null,
    }
  }
}

describe('credential-binding — cross-account email conflict', () => {
  it('Path A — Google-first user adds passkey: no conflict triggers', () => {
    const check = buildConflictCheck([{ id: 'user-google', email: 'alice@example.com' }])
    // Adding a passkey does not modify `user.email`, so the hook is
    // never invoked with a new email.
    const result = check('user-google', undefined)
    expect(result.conflict).toBe(false)
  })

  it('Path B — Passkey-first user links Google: email written to same user.id', () => {
    const check = buildConflictCheck([
      { id: 'user-passkey', email: null }, // starting state
    ])
    // When the link completes, the update writes email on the same
    // row; conflict check looks for OTHER rows owning this email.
    const result = check('user-passkey', 'alice@example.com')
    expect(result.conflict).toBe(false)
  })

  it('Path C — Passkey-first user tries to link Google email already on another user → 409', () => {
    const check = buildConflictCheck([
      { id: 'user-passkey', email: null },
      { id: 'user-preexisting', email: 'alice@example.com' },
    ])
    const result = check('user-passkey', 'alice@example.com')
    expect(result.conflict).toBe(true)
    expect(result.conflictUserId).toBe('user-preexisting')
  })

  it('Conflict check skips when no session context is available (refuses to make a decision)', () => {
    const check = buildConflictCheck([{ id: 'x', email: 'x@y.z' }])
    expect(check(null, 'whatever@y.z').conflict).toBe(false)
  })

  it('Conflict check skips when no new email is being written (no-op update)', () => {
    const check = buildConflictCheck([{ id: 'x', email: 'x@y.z' }])
    expect(check('some-user', null).conflict).toBe(false)
    expect(check('some-user', undefined).conflict).toBe(false)
  })
})
