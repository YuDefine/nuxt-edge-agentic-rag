/**
 * TD-009 — passkey-user-profiles-nullable-email.
 *
 * Verifies the explicit NULL guard on `isAdminEmailAllowlisted` so the
 * post-migration codepath (passkey-only users carry `email_normalized = NULL`
 * instead of the legacy `__passkey__:<userId>` sentinel) still rejects them
 * from the admin allowlist.
 *
 * The spec exists as a regression anchor: the helper has already accepted
 * `string | null | undefined` since `passkey-authentication`, but the
 * sentinel-removal flow now relies on that contract instead of the implicit
 * "sentinel contains ':'" rule. If someone tightens the signature back to
 * `string`, this spec breaks loudly.
 */

import { describe, expect, it } from 'vitest'

import { isAdminEmailAllowlisted } from '#shared/schemas/knowledge-runtime'

const ALLOWLIST = ['admin@example.com', 'ops@example.com']

describe('isAdminEmailAllowlisted — NULL guard for passkey-only users', () => {
  it('returns false for NULL', () => {
    expect(isAdminEmailAllowlisted(null, ALLOWLIST)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isAdminEmailAllowlisted(undefined, ALLOWLIST)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isAdminEmailAllowlisted('', ALLOWLIST)).toBe(false)
  })

  it('returns true for an allowlisted real email', () => {
    expect(isAdminEmailAllowlisted('admin@example.com', ALLOWLIST)).toBe(true)
  })

  it('returns false for a non-allowlisted real email', () => {
    expect(isAdminEmailAllowlisted('stranger@example.com', ALLOWLIST)).toBe(false)
  })

  it('normalises the input email before comparison (case-insensitive)', () => {
    expect(isAdminEmailAllowlisted('Admin@Example.COM', ALLOWLIST)).toBe(true)
  })

  it('returns false for the legacy sentinel value (regression: the implicit ":" rule)', () => {
    // Pre-0016 codebase wrote sentinel `__passkey__:<userId>` for passkey-only
    // users and relied on `:` not being a valid email character to keep them
    // out of the allowlist. Post-0016 the sentinel is gone, but if any stray
    // path still emits it, the helper must still refuse it.
    expect(isAdminEmailAllowlisted('__passkey__:user-abc', ALLOWLIST)).toBe(false)
  })
})
