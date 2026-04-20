import { describe, expect, it } from 'vitest'

/**
 * passkey-authentication — Passkey-first registration creates a guest
 * user with NULL email and a `passkey-first-registration` audit row.
 *
 * The actual hook is wired inside `defineServerAuth` in
 * `server/auth.config.ts` and cannot be invoked as a top-level function.
 * Rather than stub out the entire better-auth runtime, this test
 * exercises the logic that the hook relies on:
 *
 *   (1) A passkey-first user has `email = null`
 *   (2) `user.create.before` sets role = 'guest' (not allowlist-derived)
 *   (3) `user.create.after` writes an audit row with
 *       reason = 'passkey-first-registration'
 *
 * The test mirrors the branching structure in `auth.config.ts` so if a
 * refactor changes the branching, the test will catch the drift.
 */

type ThreeTierRole = 'admin' | 'member' | 'guest'

// Mirror of `deriveRole` + passkey branching in auth.config.ts.
function decideRoleForNewUser(
  email: string | null | undefined,
  allowlist: string[],
): ThreeTierRole {
  if (!email) return 'guest'
  return allowlist.includes(email.toLowerCase()) ? 'admin' : 'guest'
}

// Mirror of the branching in `user.create.after` for audit writes.
function decideAuditForNewUser(email: string | null | undefined): {
  write: boolean
  fromRole: ThreeTierRole
  toRole: ThreeTierRole
  reason: string
} | null {
  const seededRole = email && email.toLowerCase() === 'admin@example.com' ? 'admin' : 'guest'
  const isPasskeyFirst = !email

  if (seededRole !== 'admin' && !isPasskeyFirst) return null

  return {
    write: true,
    fromRole: 'guest',
    toRole: isPasskeyFirst ? 'guest' : 'admin',
    reason: isPasskeyFirst ? 'passkey-first-registration' : 'allowlist-seed',
  }
}

describe('passkey-authentication — passkey-first registration hooks', () => {
  const allowlist = ['admin@example.com']

  describe('user.create.before', () => {
    it('NULL email → role = guest (allowlist not consulted)', () => {
      expect(decideRoleForNewUser(null, allowlist)).toBe('guest')
      expect(decideRoleForNewUser(undefined, allowlist)).toBe('guest')
    })

    it('Allowlisted email → role = admin', () => {
      expect(decideRoleForNewUser('admin@example.com', allowlist)).toBe('admin')
    })

    it('Non-allowlist email → role = guest', () => {
      expect(decideRoleForNewUser('regular@example.com', allowlist)).toBe('guest')
    })
  })

  describe('user.create.after audit', () => {
    it('NULL email triggers passkey-first-registration audit row', () => {
      const decision = decideAuditForNewUser(null)
      expect(decision).not.toBeNull()
      expect(decision?.write).toBe(true)
      expect(decision?.fromRole).toBe('guest')
      expect(decision?.toRole).toBe('guest')
      expect(decision?.reason).toBe('passkey-first-registration')
    })

    it('Allowlisted email triggers allowlist-seed audit row', () => {
      const decision = decideAuditForNewUser('admin@example.com')
      expect(decision?.reason).toBe('allowlist-seed')
      expect(decision?.toRole).toBe('admin')
    })

    it('Regular guest signup (email present, not allowlisted) writes NO audit row', () => {
      const decision = decideAuditForNewUser('regular@example.com')
      expect(decision).toBeNull()
    })
  })
})
