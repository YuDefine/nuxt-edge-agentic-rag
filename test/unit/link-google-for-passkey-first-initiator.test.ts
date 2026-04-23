import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from '../integration/helpers/nuxt-route'
import { createKvBindingFake } from '../acceptance/helpers/bindings'

const mocks = vi.hoisted(() => ({
  getRequestURL: vi.fn(),
  requireUserSession: vi.fn(),
  sendRedirect: vi.fn(),
  setCookie: vi.fn(),
  useRuntimeConfig: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

installNuxtRouteTestGlobals()

describe('GET /api/auth/account/link-google-for-passkey-first', () => {
  beforeEach(() => {
    mocks.getRequestURL.mockReset()
    mocks.requireUserSession.mockReset()
    mocks.sendRedirect.mockReset()
    mocks.setCookie.mockReset()
    mocks.useRuntimeConfig.mockReset()

    vi.stubGlobal('getRequestURL', mocks.getRequestURL)
    vi.stubGlobal('requireUserSession', mocks.requireUserSession)
    vi.stubGlobal('sendRedirect', mocks.sendRedirect)
    vi.stubGlobal('setCookie', mocks.setCookie)
    vi.stubGlobal('useRuntimeConfig', mocks.useRuntimeConfig)

    mocks.getRequestURL.mockReturnValue(
      new URL('https://agentic.example.com/api/auth/account/link-google-for-passkey-first'),
    )
    mocks.sendRedirect.mockImplementation(
      (_event: unknown, location: string, statusCode = 302) => ({
        location,
        statusCode,
      }),
    )
    mocks.useRuntimeConfig.mockReturnValue({
      knowledge: {
        bindings: {
          rateLimitKv: 'KV',
        },
      },
      oauth: {
        google: {
          clientId: 'google-client-id',
        },
      },
    })
    mocks.requireUserSession.mockResolvedValue({
      user: {
        id: 'user-passkey-only',
        email: null,
      },
    })
  })

  it('建立 one-time state、寫 cookie，並 302 導向 Google OAuth', async () => {
    const kv = createKvBindingFake()
    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/index.get')
    const result = await handler(event)

    expect(kv.putCalls).toHaveLength(1)
    expect(kv.putCalls[0]?.key).toMatch(/^oauth-link-state:/)
    expect(kv.putCalls[0]?.options).toEqual({ expirationTtl: 600 })

    const storedPayload = JSON.parse(kv.putCalls[0]?.value ?? '{}') as {
      createdAt?: string
      nonce?: string
      redirectOrigin?: string
      userId?: string
    }

    expect(storedPayload.userId).toBe('user-passkey-only')
    expect(storedPayload.redirectOrigin).toBe('https://agentic.example.com')
    expect(storedPayload.nonce).toBeTruthy()
    expect(storedPayload.createdAt).toMatch(/^20\d\d-/)

    expect(mocks.setCookie).toHaveBeenCalledWith(
      event,
      '__Host-oauth-link-state',
      storedPayload.nonce,
      expect.objectContaining({
        httpOnly: true,
        maxAge: 600,
        path: '/',
        sameSite: 'lax',
        secure: true,
      }),
    )

    expect(result).toMatchObject({ statusCode: 302 })
    const redirect = new URL((result as { location: string }).location)
    expect(redirect.origin).toBe('https://accounts.google.com')
    expect(redirect.pathname).toBe('/o/oauth2/v2/auth')
    expect(redirect.searchParams.get('client_id')).toBe('google-client-id')
    expect(redirect.searchParams.get('redirect_uri')).toBe(
      'https://agentic.example.com/api/auth/account/link-google-for-passkey-first/callback',
    )
    expect(redirect.searchParams.get('response_type')).toBe('code')
    expect(redirect.searchParams.get('scope')).toBe('openid email profile')
    expect(redirect.searchParams.has('access_type')).toBe(false)
    expect(redirect.searchParams.has('prompt')).toBe(false)
    expect(redirect.searchParams.get('state')).toBe(storedPayload.nonce)
  })

  it('session user 已有 email 時回 400 INVALID_ENTRY_STATE', async () => {
    mocks.requireUserSession.mockResolvedValue({
      user: {
        id: 'user-linked',
        email: 'linked@example.com',
      },
    })

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: createKvBindingFake(),
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/index.get')

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'INVALID_ENTRY_STATE',
    })
    expect(mocks.setCookie).not.toHaveBeenCalled()
    expect(mocks.sendRedirect).not.toHaveBeenCalled()
  })
})
