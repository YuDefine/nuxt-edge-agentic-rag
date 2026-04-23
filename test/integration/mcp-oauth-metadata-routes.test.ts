import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  getRequestURL: vi.fn(),
}))

installNuxtRouteTestGlobals()

describe('MCP OAuth discovery metadata', () => {
  beforeEach(() => {
    vi.stubGlobal('getRequestURL', mocks.getRequestURL)
    mocks.getRequestURL.mockReturnValue(new URL('https://agentic.example/mcp'))
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
})
