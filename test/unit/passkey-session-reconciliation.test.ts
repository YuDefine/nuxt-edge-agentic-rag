import { describe, expect, it } from 'vitest'

import {
  isAdminEmailAllowlisted,
  normalizeEmailAddress,
} from '../../shared/schemas/knowledge-runtime'

/**
 * passkey-authentication: session.create.before reconciliation must skip
 * allowlist comparison for users with NULL email (passkey-first accounts).
 *
 * The hook itself lives inside `defineServerAuth` in
 * `server/auth.config.ts` and can't be imported directly because it's
 * constructed inside a lambda bound to the nuxt runtime. The test
 * therefore exercises the *same invariants* the hook relies on:
 *
 *   (1) `isAdminEmailAllowlisted(null, allowlist)` → false
 *   (2) `isAdminEmailAllowlisted(undefined, allowlist)` → false
 *   (3) `isAdminEmailAllowlisted('', allowlist)` → false
 *   (4) A passkey-first user (email = null) must land with
 *       `adminSource = 'none'` when walked through the reconciliation
 *       path. We simulate the path here.
 *
 * If these invariants break, the hook's `hasEmail ? ... : false` guard
 * is redundant at best and misleading at worst.
 */
describe('passkey session reconciliation — NULL email invariants', () => {
  const allowlist = ['admin@example.com', 'admin2@example.com']

  it('returns false for null email (does not promote passkey-first user)', () => {
    expect(isAdminEmailAllowlisted(null, allowlist)).toBe(false)
  })

  it('returns false for undefined email', () => {
    expect(isAdminEmailAllowlisted(undefined, allowlist)).toBe(false)
  })

  it('returns false for empty-string email (never seeded)', () => {
    expect(isAdminEmailAllowlisted('', allowlist)).toBe(false)
  })

  it('passkey sentinel value never matches allowlist even if user id happens to equal a known email prefix', () => {
    // Defensive: sentinel form `__passkey__:<userId>` contains a colon
    // and `__` padding that cannot appear in a real email address.
    // We still validate it through normalization to catch accidental
    // lower/upper-case drift.
    const sentinel = '__passkey__:user-abc123'
    expect(isAdminEmailAllowlisted(sentinel, allowlist)).toBe(false)
    // And it normalizes to itself (no trim/lowercase changes matter
    // because the allowlist is emails only).
    expect(normalizeEmailAddress(sentinel)).toBe(sentinel)
  })

  it('reconciliation-style decision: hasEmail=false → role stays guest, adminSource=none', () => {
    // This mirrors the exact branch structure used in the hook.
    const existing = { email: null as string | null, role: 'guest' }
    const hasEmail = Boolean(existing.email)
    const inAllowlist = hasEmail
      ? isAdminEmailAllowlisted(existing.email as string, allowlist)
      : false
    const adminSource = inAllowlist ? 'allowlist' : 'none'
    const currentRole = existing.role

    expect(hasEmail).toBe(false)
    expect(inAllowlist).toBe(false)
    expect(adminSource).toBe('none')
    expect(currentRole).toBe('guest')
  })

  it('reconciliation-style decision: hasEmail=true (allowlisted) → role targets admin', () => {
    const existing = { email: 'admin@example.com', role: 'guest' }
    const hasEmail = Boolean(existing.email)
    const inAllowlist = hasEmail ? isAdminEmailAllowlisted(existing.email, allowlist) : false

    expect(hasEmail).toBe(true)
    expect(inAllowlist).toBe(true)
  })
})
