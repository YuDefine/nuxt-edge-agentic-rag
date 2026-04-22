import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

import { createMcpOauthGrantStore } from '#server/utils/mcp-oauth-grants'

const mocks = vi.hoisted(() => ({
  readBody: vi.fn(),
  useRuntimeConfig: vi.fn(),
}))

installNuxtRouteTestGlobals()

function createKvStub() {
  const store = new Map<string, string>()

  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
  }
}

describe('POST /api/auth/mcp/token', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('readBody', mocks.readBody)
    vi.stubGlobal('useRuntimeConfig', mocks.useRuntimeConfig)
  })

  it('exchanges a valid authorization code into a bearer access token', async () => {
    const kv = createKvStub()
    const grants = createMcpOauthGrantStore({
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 120,
      kv,
      now: () => 1_700_000_000_000,
    })
    const code = await grants.issueAuthorizationCode({
      clientId: 'claude-remote',
      redirectUri: 'https://claude.example/callback',
      scopes: ['knowledge.ask'],
      userId: 'user-1',
    })

    mocks.readBody.mockResolvedValue({
      clientId: 'claude-remote',
      code,
      grantType: 'authorization_code',
      redirectUri: 'https://claude.example/callback',
    })
    mocks.useRuntimeConfig.mockReturnValue({
      knowledge: {
        bindings: {
          rateLimitKv: 'KV',
        },
        mcpConnectors: {
          oauth: {
            accessTokenTtlSeconds: 600,
            authorizationCodeTtlSeconds: 120,
          },
        },
      },
    })

    const { default: handler } = await import('../../server/api/auth/mcp/token.post')
    const result = await handler(
      createRouteEvent({
        context: {
          cloudflare: {
            env: {
              KV: kv,
            },
          },
        },
      }),
    )

    expect(result).toMatchObject({
      access_token: expect.any(String),
      expires_in: 600,
      scope: 'knowledge.ask',
      token_type: 'Bearer',
    })
  })

  it('rejects reusing an authorization code after it has already been exchanged', async () => {
    const kv = createKvStub()
    const grants = createMcpOauthGrantStore({
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 120,
      kv,
      now: () => 1_700_000_000_000,
    })
    const code = await grants.issueAuthorizationCode({
      clientId: 'claude-remote',
      redirectUri: 'https://claude.example/callback',
      scopes: ['knowledge.ask'],
      userId: 'user-1',
    })
    await grants.exchangeAuthorizationCode({
      clientId: 'claude-remote',
      code,
      redirectUri: 'https://claude.example/callback',
    })

    mocks.readBody.mockResolvedValue({
      clientId: 'claude-remote',
      code,
      grantType: 'authorization_code',
      redirectUri: 'https://claude.example/callback',
    })
    mocks.useRuntimeConfig.mockReturnValue({
      knowledge: {
        bindings: {
          rateLimitKv: 'KV',
        },
        mcpConnectors: {
          oauth: {
            accessTokenTtlSeconds: 600,
            authorizationCodeTtlSeconds: 120,
          },
        },
      },
    })

    const { default: handler } = await import('../../server/api/auth/mcp/token.post')

    await expect(
      handler(
        createRouteEvent({
          context: {
            cloudflare: {
              env: {
                KV: kv,
              },
            },
          },
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Authorization code has already been consumed',
    })
  })
})
