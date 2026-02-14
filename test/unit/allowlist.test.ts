import { describe, expect, it } from 'vitest'

import {
  hasRuntimeAdminAccess,
  normalizeAllowlistEmail,
  parseRuntimeAdminAllowlist,
} from '#server/utils/allowlist'

describe('runtime admin allowlist', () => {
  it('normalizes emails by trimming surrounding whitespace and lowercasing', () => {
    expect(normalizeAllowlistEmail('  Admin@Example.COM  ')).toBe('admin@example.com')
  })

  it('parses comma-separated allowlists into unique normalized emails', () => {
    expect(
      parseRuntimeAdminAllowlist(
        ' Admin@Example.COM,editor@example.com, admin@example.com ,,EDITOR@example.com '
      )
    ).toEqual(['admin@example.com', 'editor@example.com'])
  })

  it('grants admin access only when the current email is allowlisted', () => {
    expect(
      hasRuntimeAdminAccess(' Admin@Example.COM ', ['owner@example.com', 'admin@example.com'])
    ).toBe(true)
    expect(hasRuntimeAdminAccess('reader@example.com', 'owner@example.com,admin@example.com')).toBe(
      false
    )
  })

  it('treats nullish and empty emails as not allowlisted', () => {
    expect(hasRuntimeAdminAccess(null, ['admin@example.com'])).toBe(false)
    expect(hasRuntimeAdminAccess(undefined, ['admin@example.com'])).toBe(false)
    expect(hasRuntimeAdminAccess('', ['admin@example.com'])).toBe(false)
  })
})
