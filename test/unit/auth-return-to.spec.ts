// Vue import triggers the Nuxt project (happy-dom env with sessionStorage).
// We do not actually use `ref` here — the import is a project-routing hint.
// eslint-disable-next-line unused-imports/no-unused-imports
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildLoginRedirectUrl,
  clearGenericReturnTo,
  consumeGenericReturnTo,
  parseSafeRedirect,
  peekGenericReturnTo,
  saveGenericReturnTo,
} from '~/utils/auth-return-to'

describe('parseSafeRedirect', () => {
  const validCases: Array<[label: string, input: string, expected: string]> = [
    ['typical admin path', '/admin/documents', '/admin/documents'],
    ['path with query string', '/account/settings?tab=profile', '/account/settings?tab=profile'],
    ['bare root', '/', '/'],
  ]

  for (const [label, input, expected] of validCases) {
    it(`accepts safe path (${label})`, () => {
      expect(parseSafeRedirect(input)).toBe(expected)
    })
  }

  const invalidCases: Array<[label: string, input: unknown]> = [
    ['protocol-relative (//evil.com)', '//evil.com'],
    ['protocol-relative with path', '//evil.com/phish'],
    ['absolute http URL', 'http://evil.com'],
    ['absolute https URL', 'https://evil.com'],
    ['javascript: scheme', 'javascript:alert(1)'],
    ['data: scheme', 'data:text/html,<h1>x'],
    ['missing leading slash', 'admin/documents'],
    ['empty string', ''],
    ['null input', null],
    ['undefined input', undefined],
    ['non-string number', 42],
    ['non-string object', {}],
    ['over 2048 characters', `/${'x'.repeat(2048)}`],
  ]

  for (const [label, input] of invalidCases) {
    it(`rejects ${label}`, () => {
      expect(parseSafeRedirect(input)).toBeNull()
    })
  }
})

describe('Generic return-to storage', () => {
  const GENERIC_KEY = 'auth:return-to'
  const MCP_KEY = 'mcp-connector:return-to'

  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('saveGenericReturnTo writes to the auth:return-to key', () => {
    saveGenericReturnTo('/admin/documents')
    expect(sessionStorage.getItem(GENERIC_KEY)).toBe('/admin/documents')
  })

  it('peekGenericReturnTo returns stored value without clearing it', () => {
    sessionStorage.setItem(GENERIC_KEY, '/account/settings')
    expect(peekGenericReturnTo()).toBe('/account/settings')
    expect(sessionStorage.getItem(GENERIC_KEY)).toBe('/account/settings')
  })

  it('consumeGenericReturnTo returns the value and clears the key', () => {
    sessionStorage.setItem(GENERIC_KEY, '/admin/tokens')
    expect(consumeGenericReturnTo()).toBe('/admin/tokens')
    expect(sessionStorage.getItem(GENERIC_KEY)).toBeNull()
  })

  it('consumeGenericReturnTo returns null when unset', () => {
    expect(consumeGenericReturnTo()).toBeNull()
  })

  it('clearGenericReturnTo removes the key', () => {
    sessionStorage.setItem(GENERIC_KEY, '/x')
    clearGenericReturnTo()
    expect(sessionStorage.getItem(GENERIC_KEY)).toBeNull()
  })

  it('uses a key distinct from the MCP connector key', () => {
    // Both flows may coexist — they must not collide.
    sessionStorage.setItem(MCP_KEY, '/mcp-path')
    saveGenericReturnTo('/generic-path')

    expect(sessionStorage.getItem(MCP_KEY)).toBe('/mcp-path')
    expect(sessionStorage.getItem(GENERIC_KEY)).toBe('/generic-path')

    consumeGenericReturnTo()

    // Generic consume must not disturb the MCP entry.
    expect(sessionStorage.getItem(MCP_KEY)).toBe('/mcp-path')
  })
})

describe('buildLoginRedirectUrl', () => {
  it('returns null when the user is already on /login (no loop)', () => {
    expect(buildLoginRedirectUrl({ path: '/login', fullPath: '/login' })).toBeNull()
  })

  it('returns null when the user is already on /login with a query string', () => {
    expect(buildLoginRedirectUrl({ path: '/login', fullPath: '/login?redirect=/admin' })).toBeNull()
  })

  it('returns /login without redirect qs when the origin path is root', () => {
    expect(buildLoginRedirectUrl({ path: '/', fullPath: '/' })).toBe('/login')
  })

  it('appends URL-encoded redirect qs for any other path', () => {
    expect(
      buildLoginRedirectUrl({
        path: '/admin/documents',
        fullPath: '/admin/documents',
      }),
    ).toBe('/login?redirect=%2Fadmin%2Fdocuments')
  })

  it('encodes query strings embedded in fullPath', () => {
    expect(
      buildLoginRedirectUrl({
        path: '/admin/usage',
        fullPath: '/admin/usage?filter=x',
      }),
    ).toBe('/login?redirect=%2Fadmin%2Fusage%3Ffilter%3Dx')
  })

  it('handles nested account paths', () => {
    expect(
      buildLoginRedirectUrl({
        path: '/account/settings',
        fullPath: '/account/settings',
      }),
    ).toBe('/login?redirect=%2Faccount%2Fsettings')
  })
})
