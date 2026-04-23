import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  readBody: vi.fn(),
  requireUserSession: vi.fn(),
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

describe('POST /api/auth/mcp/authorize', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', mocks.fetch)
    vi.stubGlobal('readBody', mocks.readBody)
    vi.stubGlobal('requireUserSession', mocks.requireUserSession)
    vi.stubGlobal('useRuntimeConfig', mocks.useRuntimeConfig)

    mocks.readBody.mockResolvedValue({
      approved: true,
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      clientId: 'claude-remote',
      redirectUri: 'https://claude.example/callback',
      scope: 'knowledge.ask knowledge.search',
    })
    mocks.fetch.mockReset()
    mocks.requireUserSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
    })
    mocks.useRuntimeConfig.mockReturnValue({
      knowledge: {
        environment: 'local',
        bindings: {
          rateLimitKv: 'KV',
        },
        mcpConnectors: {
          oauth: {
            accessTokenTtlSeconds: 600,
            authorizationCodeTtlSeconds: 120,
          },
          clients: [
            {
              clientId: 'claude-remote',
              enabled: true,
              allowedScopes: ['knowledge.ask', 'knowledge.search'],
              environments: ['local'],
              name: 'Claude Remote',
              redirectUris: ['https://claude.example/callback'],
            },
          ],
        },
      },
    })
  })

  it('issues an authorization code for an authenticated local account', async () => {
    const kv = createKvStub()
    const { default: handler } = await import('../../server/api/auth/mcp/authorize.post')
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
      data: {
        clientId: 'claude-remote',
        redirectUri: 'https://claude.example/callback',
        state: null,
      },
    })
    expect(result.data.code).toEqual(expect.any(String))
    expect(kv.store.size).toBe(1)
  })

  it('persists PKCE data on authorization codes for URL client_id metadata clients', async () => {
    mocks.readBody.mockResolvedValueOnce({
      approved: true,
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      clientId: 'https://claude.ai/.well-known/oauth-client-metadata/mcp',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      resource: 'https://agentic.example/mcp',
      scope: 'knowledge.ask',
    })
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          client_id: 'https://claude.ai/.well-known/oauth-client-metadata/mcp',
          client_name: 'Claude',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        }),
      ),
    )
    const kv = createKvStub()
    const { default: handler } = await import('../../server/api/auth/mcp/authorize.post')
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

    const storedGrant = JSON.parse(kv.store.values().next().value as string)

    expect(result.data.clientId).toBe('https://claude.ai/.well-known/oauth-client-metadata/mcp')
    expect(storedGrant).toMatchObject({
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      resource: 'https://agentic.example/mcp',
    })
  })
})
