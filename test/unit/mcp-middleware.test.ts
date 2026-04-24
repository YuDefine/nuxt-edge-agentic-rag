import { beforeEach, describe, expect, it, vi } from 'vitest'

// The middleware runs on every /mcp request before tool invocation.
// It MUST:
// 1. Read the Authorization header, resolve the MCP token, and populate
//    `event.context.mcpAuth`. Throw 401 when no usable token.
// 2. Extract the tool name from the JSON-RPC body, consume the per-token
//    rate limit, and throw 429 when the tool is over-quota.
// 3. Leave scope enforcement to the individual tool handlers.
//
// Dependencies are injected so the middleware stays testable without booting
// a full Nitro event loop.

describe('runMcpMiddleware (§1.3 red)', () => {
  const authSigningKey = '0123456789abcdef0123456789abcdef'
  let stubCreateError: ReturnType<typeof vi.fn>
  let stubSetResponseHeader: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    stubCreateError = vi.fn((input: { statusCode: number; message: string }) =>
      Object.assign(new Error(input.message), input),
    )
    stubSetResponseHeader = vi.fn()
    vi.stubGlobal('createError', stubCreateError)
    vi.stubGlobal('setResponseHeader', stubSetResponseHeader)
    vi.stubGlobal('getRequestURL', () => new URL('https://agentic.example/mcp'))
  })

  function createEvent(
    options: {
      authorization?: string
      env?: Record<string, unknown>
    } = {},
  ) {
    const headers = new Headers()
    if (options.authorization) {
      headers.set('authorization', options.authorization)
    }

    return {
      headers,
      context: {
        cloudflare: {
          env: options.env ?? {
            KV: {
              get: vi.fn().mockResolvedValue(null),
              put: vi.fn().mockResolvedValue(undefined),
            },
          },
        },
        params: {},
      },
    }
  }

  it('throws 401 when the Authorization header is missing', async () => {
    const { runMcpMiddleware } = await import('#server/utils/mcp-middleware')

    const event = createEvent()

    await expect(
      runMcpMiddleware(event, {
        authSigningKey,
        environment: 'local',
        kvBindingName: 'KV',
        extractToolNames: async () => ['askKnowledge'],
        tokenStore: {
          findUsableTokenByHash: vi.fn().mockResolvedValue(null),
          touchLastUsedAt: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('advertises protected resource metadata when authorization is missing', async () => {
    const { runMcpMiddleware } = await import('#server/utils/mcp-middleware')

    const event = createEvent()

    await expect(
      runMcpMiddleware(event, {
        environment: 'local',
        kvBindingName: 'KV',
        extractToolNames: async () => ['askKnowledge'],
        tokenStore: {
          findUsableTokenByHash: vi.fn().mockResolvedValue(null),
          touchLastUsedAt: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
    })

    expect(stubSetResponseHeader).toHaveBeenCalledWith(
      event,
      'WWW-Authenticate',
      'Bearer resource_metadata="https://agentic.example/.well-known/oauth-protected-resource", scope="knowledge.ask knowledge.search knowledge.category.list knowledge.citation.read"',
    )
  })

  it('throws 401 when the Bearer token is not found in the store', async () => {
    const { runMcpMiddleware } = await import('#server/utils/mcp-middleware')

    const event = createEvent({ authorization: 'Bearer unknown-token' })

    await expect(
      runMcpMiddleware(event, {
        environment: 'local',
        kvBindingName: 'KV',
        extractToolNames: async () => ['askKnowledge'],
        tokenStore: {
          findUsableTokenByHash: vi.fn().mockResolvedValue(null),
          touchLastUsedAt: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('throws 429 when the token exceeds the rate limit for the requested tool', async () => {
    const { runMcpMiddleware } = await import('#server/utils/mcp-middleware')

    // KV reports the window is full.
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ count: 30, windowStart: 0 })),
      put: vi.fn().mockResolvedValue(undefined),
    }

    const tokenRecord = {
      createdAt: '2026-04-18T00:00:00.000Z',
      environment: 'local',
      expiresAt: null,
      id: 'token-1',
      lastUsedAt: null,
      name: 'Test token',
      revokedAt: null,
      revokedReason: null,
      scopesJson: JSON.stringify(['knowledge.ask']),
      status: 'active',
      tokenHash: 'hash',
    }

    const event = createEvent({
      authorization: 'Bearer valid-token',
      env: { KV: kv },
    })

    await expect(
      runMcpMiddleware(event, {
        environment: 'local',
        kvBindingName: 'KV',
        extractToolNames: async () => ['askKnowledge'],
        now: 60_000,
        tokenStore: {
          findUsableTokenByHash: vi.fn().mockResolvedValue(tokenRecord),
          touchLastUsedAt: vi.fn().mockResolvedValue(undefined),
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 429,
    })

    expect(kv.put).not.toHaveBeenCalled()
  })

  it('populates event.context.mcpAuth and allows the request through on success', async () => {
    const { runMcpMiddleware } = await import('#server/utils/mcp-middleware')
    const { verifyAuthContext } = await import('#server/utils/mcp-auth-context-codec')

    const kv = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    }

    const tokenRecord = {
      createdAt: '2026-04-18T00:00:00.000Z',
      createdByUserId: 'admin-1',
      environment: 'local',
      expiresAt: null,
      id: 'token-1',
      lastUsedAt: null,
      name: 'Test token',
      revokedAt: null,
      revokedReason: null,
      scopesJson: JSON.stringify(['knowledge.ask', 'knowledge.search']),
      status: 'active',
      tokenHash: 'hash',
    }

    const event = createEvent({
      authorization: 'Bearer valid-token',
      env: { KV: kv },
    })

    await runMcpMiddleware(event, {
      authSigningKey,
      environment: 'local',
      kvBindingName: 'KV',
      extractToolNames: async () => ['askKnowledge'],
      tokenStore: {
        findUsableTokenByHash: vi.fn().mockResolvedValue(tokenRecord),
        touchLastUsedAt: vi.fn().mockResolvedValue(undefined),
      },
      userRoleLookup: {
        async lookupRoleByUserId() {
          return 'admin'
        },
      },
    })

    const auth = (
      event.context as {
        mcpAuth?: {
          principal: { authSource: string; userId: string }
          scopes: string[]
          tokenId: string
        }
      }
    ).mcpAuth
    expect(auth).toBeDefined()
    expect(auth?.principal).toEqual({
      authSource: 'legacy_token',
      userId: 'admin-1',
    })
    expect(auth?.tokenId).toBe('token-1')
    expect(auth?.scopes).toEqual(['knowledge.ask', 'knowledge.search'])
    const envelope = (event.context as { mcpAuthEnvelope?: string }).mcpAuthEnvelope
    expect(envelope).toEqual(expect.any(String))
    await expect(verifyAuthContext(envelope, authSigningKey)).resolves.toMatchObject({
      principal: {
        authSource: 'legacy_token',
        userId: 'admin-1',
      },
      scopes: ['knowledge.ask', 'knowledge.search'],
      tokenId: 'token-1',
    })
    expect(kv.put).toHaveBeenCalled()
  })

  it('accepts oauth access tokens and normalizes them into the same auth context', async () => {
    const { createMcpOauthGrantStore } = await import('#server/utils/mcp-oauth-grants')
    const { runMcpMiddleware } = await import('#server/utils/mcp-middleware')

    const kvStore = new Map<string, string>()
    const kv = {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kvStore.set(key, value)
      }),
    }
    const grants = createMcpOauthGrantStore({
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 120,
      kv,
    })
    const code = await grants.issueAuthorizationCode({
      clientId: 'claude-remote',
      redirectUri: 'https://claude.example/callback',
      scopes: ['knowledge.ask'],
      userId: 'user-1',
    })
    const token = await grants.exchangeAuthorizationCode({
      clientId: 'claude-remote',
      code,
      redirectUri: 'https://claude.example/callback',
    })

    const event = createEvent({
      authorization: `Bearer ${token.accessToken}`,
      env: { KV: kv },
    })
    const legacyLookup = vi.fn().mockResolvedValue(null)

    await runMcpMiddleware(event, {
      authSigningKey,
      environment: 'local',
      kvBindingName: 'KV',
      extractToolNames: async () => ['askKnowledge'],
      tokenStore: {
        findUsableTokenByHash: legacyLookup,
        touchLastUsedAt: vi.fn(),
      },
      userRoleLookup: {
        async lookupRoleByUserId(userId: string) {
          return userId === 'user-1' ? 'member' : null
        },
      },
    })

    const auth = (
      event.context as {
        mcpAuth?: {
          principal: { authSource: string; userId: string }
          scopes: string[]
        }
      }
    ).mcpAuth
    expect(auth?.principal).toEqual({
      authSource: 'oauth_access_token',
      userId: 'user-1',
    })
    expect(auth?.scopes).toEqual(['knowledge.ask'])
    expect(legacyLookup).not.toHaveBeenCalled()
  })
})
