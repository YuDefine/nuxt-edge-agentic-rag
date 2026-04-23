import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  getRequestURL: vi.fn(),
  getQuery: vi.fn(),
  readBody: vi.fn(),
}))

function createKvMock() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  }
}

function createMcpRouteEvent(kv = createKvMock()) {
  return createRouteEvent({
    context: {
      cloudflare: {
        env: {
          RATE_LIMIT_KV: kv,
        },
      },
    },
  })
}

installNuxtRouteTestGlobals()

describe('MCP OAuth discovery metadata', () => {
  beforeEach(() => {
    vi.stubGlobal('getRequestURL', mocks.getRequestURL)
    vi.stubGlobal('getQuery', mocks.getQuery)
    vi.stubGlobal('readBody', mocks.readBody)
    vi.stubGlobal('getHeader', () => undefined)
    vi.stubGlobal('getRequestIP', () => '127.0.0.1')
    vi.stubGlobal('useRuntimeConfig', () => ({
      knowledge: {
        environment: 'local',
        bindings: {
          rateLimitKv: 'RATE_LIMIT_KV',
        },
      },
    }))
    mocks.getRequestURL.mockReturnValue(new URL('https://agentic.example/mcp'))
    mocks.getQuery.mockReturnValue({})
    mocks.readBody.mockResolvedValue({})
  })

  it('serves protected resource metadata for Claude remote MCP discovery', async () => {
    const { default: handler } =
      await import('../../server/routes/.well-known/oauth-protected-resource.get')

    expect(handler(createRouteEvent())).toEqual({
      authorization_servers: ['https://agentic.example'],
      resource: 'https://agentic.example/mcp',
      scopes_supported: [
        'knowledge.ask',
        'knowledge.search',
        'knowledge.category.list',
        'knowledge.citation.read',
      ],
    })
  })

  it('serves OAuth authorization server metadata used by MCP clients', async () => {
    const { default: handler } =
      await import('../../server/routes/.well-known/oauth-authorization-server.get')

    expect(handler(createRouteEvent())).toEqual({
      authorization_endpoint: 'https://agentic.example/auth/mcp/authorize',
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code'],
      issuer: 'https://agentic.example',
      client_id_metadata_document_supported: true,
      registration_endpoint: 'https://agentic.example/api/auth/mcp/register',
      response_types_supported: ['code'],
      scopes_supported: [
        'knowledge.ask',
        'knowledge.search',
        'knowledge.category.list',
        'knowledge.citation.read',
      ],
      token_endpoint: 'https://agentic.example/api/auth/mcp/token',
      token_endpoint_auth_methods_supported: ['none'],
    })
  })

  it('registers ChatGPT developer-mode connectors with a metadata document client id', async () => {
    mocks.getRequestURL.mockReturnValue(new URL('https://agentic.example/api/auth/mcp/register'))
    mocks.readBody.mockResolvedValue({
      client_name: 'Yuntech RAG',
      redirect_uris: ['https://chatgpt.com/connector/oauth/callback_123'],
    })
    const { default: handler } = await import('../../server/api/auth/mcp/register.post')

    const result = await handler(createMcpRouteEvent())

    expect(result).toMatchObject({
      client_name: 'Yuntech RAG',
      grant_types: ['authorization_code'],
      redirect_uris: ['https://chatgpt.com/connector/oauth/callback_123'],
      response_types: ['code'],
      scope: 'knowledge.ask knowledge.search knowledge.category.list knowledge.citation.read',
      token_endpoint_auth_method: 'none',
    })
    expect(result.client_id).toBe(
      'https://agentic.example/api/auth/mcp/chatgpt-client-metadata?redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcallback_123&client_name=Yuntech+RAG',
    )
    expect(result.client_id_issued_at).toEqual(expect.any(Number))
  })

  it('rejects dynamic registration redirect URIs outside ChatGPT', async () => {
    mocks.getRequestURL.mockReturnValue(new URL('https://agentic.example/api/auth/mcp/register'))
    mocks.readBody.mockResolvedValue({
      client_name: 'Evil',
      redirect_uris: ['https://evil.example/callback'],
    })
    const { default: handler } = await import('../../server/api/auth/mcp/register.post')

    await expect(handler(createMcpRouteEvent())).rejects.toMatchObject({
      statusCode: 400,
      message: 'ChatGPT connector redirect URI is not allowed',
    })
  })

  it('serves ChatGPT client metadata documents for registered connector redirects', async () => {
    const metadataUrl =
      'https://agentic.example/api/auth/mcp/chatgpt-client-metadata?redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcallback_123&client_name=Yuntech+RAG'
    mocks.getRequestURL.mockReturnValue(new URL(metadataUrl))
    mocks.getQuery.mockReturnValue({
      client_name: 'Yuntech RAG',
      redirect_uri: 'https://chatgpt.com/connector/oauth/callback_123',
    })
    const { default: handler } =
      await import('../../server/api/auth/mcp/chatgpt-client-metadata.get')

    await expect(handler(createMcpRouteEvent())).resolves.toEqual({
      client_id: metadataUrl,
      client_name: 'Yuntech RAG',
      redirect_uris: ['https://chatgpt.com/connector/oauth/callback_123'],
    })
  })
})
