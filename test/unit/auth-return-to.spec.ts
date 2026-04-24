// Vue import triggers the Nuxt project (happy-dom env with sessionStorage).
// `ref` is imported but not used; the lint rule that would normally flag
// this (`unused-imports/no-unused-imports`) is not enabled in this project,
// so no disable-comment is required. Remove this import if/when vitest is
// configured to pick this spec without the Nuxt routing hint.
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

void ref

import {
  buildLoginRedirectUrl,
  clearGenericReturnTo,
  consumeGenericReturnTo,
  parseSafeRedirect,
  peekGenericReturnTo,
  resolveReturnToPath,
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
  it('returns null when the user is already on /auth/login (no loop)', () => {
    expect(buildLoginRedirectUrl({ path: '/auth/login', fullPath: '/auth/login' })).toBeNull()
  })

  it('returns null when the user is already on /auth/login with a query string', () => {
    expect(
      buildLoginRedirectUrl({ path: '/auth/login', fullPath: '/auth/login?redirect=/admin' }),
    ).toBeNull()
  })

  it('returns /auth/login without redirect qs when the origin path is root', () => {
    expect(buildLoginRedirectUrl({ path: '/', fullPath: '/' })).toBe('/auth/login')
  })

  it('appends URL-encoded redirect qs for any other path', () => {
    expect(
      buildLoginRedirectUrl({
        path: '/admin/documents',
        fullPath: '/admin/documents',
      }),
    ).toBe('/auth/login?redirect=%2Fadmin%2Fdocuments')
  })

  it('encodes query strings embedded in fullPath', () => {
    expect(
      buildLoginRedirectUrl({
        path: '/admin/usage',
        fullPath: '/admin/usage?filter=x',
      }),
    ).toBe('/auth/login?redirect=%2Fadmin%2Fusage%3Ffilter%3Dx')
  })

  it('handles nested account paths', () => {
    expect(
      buildLoginRedirectUrl({
        path: '/account/settings',
        fullPath: '/account/settings',
      }),
    ).toBe('/auth/login?redirect=%2Faccount%2Fsettings')
  })
})

describe('resolveReturnToPath — Callback Page Consumes Return-To In Priority Order', () => {
  const GENERIC_KEY = 'auth:return-to'
  const MCP_KEY = 'mcp-connector:return-to'

  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('MCP connector path wins over generic path when both are set', () => {
    sessionStorage.setItem(MCP_KEY, '/auth/mcp/authorize?client_id=x')
    sessionStorage.setItem(GENERIC_KEY, '/admin/documents')

    expect(resolveReturnToPath()).toBe('/auth/mcp/authorize?client_id=x')

    // Both entries MUST be cleared: MCP is the winner, and leaving a
    // stale generic entry around would let the next `/auth/callback`
    // visit silently redirect the user to a path they never asked to
    // revisit (abandoned-flow contamination).
    expect(sessionStorage.getItem(MCP_KEY)).toBeNull()
    expect(sessionStorage.getItem(GENERIC_KEY)).toBeNull()
  })

  it('generic path is returned when MCP is empty', () => {
    sessionStorage.setItem(GENERIC_KEY, '/account/settings')
    expect(resolveReturnToPath()).toBe('/account/settings')
    expect(sessionStorage.getItem(GENERIC_KEY)).toBeNull()
  })

  it('generic path falls back to / when the stored value is unsafe', () => {
    // An attacker may have injected //evil.com before the OAuth hop.
    sessionStorage.setItem(GENERIC_KEY, '//evil.com')
    expect(resolveReturnToPath()).toBe('/')
    expect(sessionStorage.getItem(GENERIC_KEY)).toBeNull()
  })

  it('returns null when neither key is set', () => {
    expect(resolveReturnToPath()).toBeNull()
  })

  it('does NOT revalidate the MCP path through parseSafeRedirect', () => {
    // MCP authorize URLs are server-built with query strings that may
    // include absolute URIs; they pass through unchecked.
    const rawMcpPath =
      '/auth/mcp/authorize?client_id=x&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fcallback'
    sessionStorage.setItem(MCP_KEY, rawMcpPath)

    expect(resolveReturnToPath()).toBe(rawMcpPath)
  })

  it('MCP win clears generic so a later callback does not silently redirect', () => {
    // Regression: previously the generic entry was preserved when MCP
    // won, letting a subsequent `/auth/callback` visit consume the stale
    // entry and redirect the user somewhere they never asked to go.
    sessionStorage.setItem(MCP_KEY, '/auth/mcp/authorize?client_id=x')
    sessionStorage.setItem(GENERIC_KEY, '/admin/documents')

    expect(resolveReturnToPath()).toBe('/auth/mcp/authorize?client_id=x')
    // Second call (next callback visit) — both keys are empty.
    expect(resolveReturnToPath()).toBeNull()
  })
})

describe('Passkey Same-Origin Flow Reads Redirect From Query', () => {
  // Passkey is same-origin — no sessionStorage round trip.
  // login.vue reads route.query.redirect, pipes through parseSafeRedirect,
  // and navigates to the result or '/'. These cases pin that contract so a
  // future change to the fallback path fails loudly here.
  const resolvePasskeyPostLoginPath = (raw: unknown): string => parseSafeRedirect(raw) ?? '/'

  it('honors a valid redirect query', () => {
    expect(resolvePasskeyPostLoginPath('/account/settings')).toBe('/account/settings')
  })

  it('falls back to / when the redirect query is unsafe', () => {
    expect(resolvePasskeyPostLoginPath('//evil.com')).toBe('/')
  })

  it('falls back to / when the redirect query is missing', () => {
    expect(resolvePasskeyPostLoginPath(undefined)).toBe('/')
  })
})
