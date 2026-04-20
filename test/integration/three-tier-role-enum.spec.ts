import { describe, expect, it } from 'vitest'

import { normaliseRole, ROLE_VALUES, type Role } from '../../shared/types/auth'
import {
  isAdminEmailAllowlisted,
  normalizeEmailAddress,
} from '../../shared/schemas/knowledge-runtime'

/**
 * member-and-permission-model — Three-Tier Role Enum scenarios coverage
 * (passkey-authentication §15.1).
 *
 * The scenarios as currently defined:
 *
 *   (S1) Canonical values pass through normaliseRole
 *   (S2) Legacy `'user'` maps to `'member'`
 *   (S3) null / undefined / unknown → `'guest'` (least-privilege)
 *   (S4) NEW: Passkey-first user created as guest with NULL email
 *   (S5) NEW: Reconciliation skips allowlist check for NULL email
 *
 * The last two scenarios are covered functionally by
 * `passkey-session-reconciliation.test.ts` and
 * `passkey-first-registration.spec.ts`; this spec consolidates them
 * into a single place where a reader can see the full enum surface
 * holds together.
 */

describe('Three-Tier Role Enum — S1 canonical values pass through', () => {
  it('admin passes through', () => {
    expect(normaliseRole('admin')).toBe('admin')
  })
  it('member passes through', () => {
    expect(normaliseRole('member')).toBe('member')
  })
  it('guest passes through', () => {
    expect(normaliseRole('guest')).toBe('guest')
  })
  it('ROLE_VALUES contains exactly these three tiers', () => {
    expect([...ROLE_VALUES].toSorted()).toEqual(['admin', 'guest', 'member'])
  })
})

describe('Three-Tier Role Enum — S2 legacy user maps to member', () => {
  it('legacy "user" normalises to "member"', () => {
    expect(normaliseRole('user')).toBe('member')
  })
})

describe('Three-Tier Role Enum — S3 defensive defaults', () => {
  it('null → guest (least privilege)', () => {
    expect(normaliseRole(null)).toBe('guest')
  })
  it('undefined → guest', () => {
    expect(normaliseRole(undefined)).toBe('guest')
  })
  it('empty string → guest', () => {
    expect(normaliseRole('')).toBe('guest')
  })
  it('unknown string → guest', () => {
    expect(normaliseRole('super-admin' as unknown as string)).toBe('guest')
  })
})

describe('Three-Tier Role Enum — S4 passkey-first user is created as guest with NULL email', () => {
  // Mirror of `user.create.before` branching in `server/auth.config.ts`.
  function decideRoleForNewUser(email: string | null | undefined, allowlist: string[]): Role {
    if (!email) return 'guest'
    return isAdminEmailAllowlisted(email, allowlist) ? 'admin' : 'guest'
  }

  const allowlist = ['admin@example.com']

  it('NULL email → guest (allowlist not consulted)', () => {
    expect(decideRoleForNewUser(null, allowlist)).toBe('guest')
  })
  it('empty email → guest', () => {
    expect(decideRoleForNewUser('', allowlist)).toBe('guest')
  })
  it('allowlisted email → admin', () => {
    expect(decideRoleForNewUser('admin@example.com', allowlist)).toBe('admin')
  })
  it('non-allowlist email → guest', () => {
    expect(decideRoleForNewUser('bob@example.com', allowlist)).toBe('guest')
  })
})

describe('Three-Tier Role Enum — S5 reconciliation skips allowlist for NULL email', () => {
  // Mirror of `session.create.before` branching in `server/auth.config.ts`.
  function reconcileRole(
    existing: { email: string | null; role: string | null },
    allowlist: string[],
  ): { role: Role; adminSource: 'allowlist' | 'none'; emailNormalised: string } {
    const hasEmail = Boolean(existing.email)
    const inAllowlist = hasEmail
      ? isAdminEmailAllowlisted(existing.email as string, allowlist)
      : false
    const adminSource = inAllowlist ? 'allowlist' : 'none'
    const emailNormalised = hasEmail
      ? normalizeEmailAddress(existing.email as string)
      : `__passkey__:sentinel-user-id`
    return {
      role: normaliseRole(existing.role),
      adminSource,
      emailNormalised,
    }
  }

  const allowlist = ['admin@example.com']

  it('NULL email + guest role → stays guest, adminSource=none, sentinel email_normalised', () => {
    const result = reconcileRole({ email: null, role: 'guest' }, allowlist)
    expect(result.role).toBe('guest')
    expect(result.adminSource).toBe('none')
    expect(result.emailNormalised).toMatch(/^__passkey__:/)
  })

  it('NULL email + stale admin role → defensively surfaces as admin (reconciliation would downgrade but not via allowlist)', () => {
    const result = reconcileRole({ email: null, role: 'admin' }, allowlist)
    // The session hook branches on `!inAllowlist && currentRole === 'admin'`
    // to downgrade — NULL email means `inAllowlist` is false, so this
    // path does fire. Normalised role still reads `admin` until the
    // hook writes the downgrade; this test only exercises the raw
    // input → normalise contract.
    expect(result.role).toBe('admin')
    expect(result.adminSource).toBe('none')
  })

  it('allowlisted email + guest role → adminSource=allowlist (hook would upgrade)', () => {
    const result = reconcileRole({ email: 'admin@example.com', role: 'guest' }, allowlist)
    expect(result.adminSource).toBe('allowlist')
    expect(result.emailNormalised).toBe('admin@example.com')
  })

  it('non-allowlist email + member role → stays member', () => {
    const result = reconcileRole({ email: 'bob@example.com', role: 'member' }, allowlist)
    expect(result.role).toBe('member')
    expect(result.adminSource).toBe('none')
  })
})
