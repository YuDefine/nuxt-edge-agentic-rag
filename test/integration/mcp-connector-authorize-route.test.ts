import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  useRuntimeConfig: vi.fn(),
  requireUserSession: vi.fn(),
  getQuery: vi.fn(),
}))

installNuxtRouteTestGlobals()

describe('GET /api/auth/mcp/authorize', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('useRuntimeConfig', mocks.useRuntimeConfig)
    vi.stubGlobal('requireUserSession', mocks.requireUserSession)
    vi.stubGlobal('getQuery', mocks.getQuery)

    mocks.useRuntimeConfig.mockReturnValue({
      knowledge: {
        environment: 'local',
        mcpConnectors: {
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
    mocks.requireUserSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
    })
    mocks.getQuery.mockReturnValue({
      client_id: 'claude-remote',
      redirect_uri: 'https://claude.example/callback',
      scope: 'knowledge.ask knowledge.search',
      state: 'opaque-state',
    })
  })

  it('rejects requests without an authenticated local session', async () => {
    mocks.requireUserSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    )

    const { default: handler } = await import('../../server/api/auth/mcp/authorize.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects unknown connector clients before consent data is returned', async () => {
    mocks.getQuery.mockReturnValueOnce({
      client_id: 'unknown-client',
      redirect_uri: 'https://claude.example/callback',
      scope: 'knowledge.ask',
      state: 'opaque-state',
    })

    const { default: handler } = await import('../../server/api/auth/mcp/authorize.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Unknown MCP connector client: unknown-client',
    })
  })

  it('returns client and granted scope data for an authenticated local account', async () => {
    const { default: handler } = await import('../../server/api/auth/mcp/authorize.get')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({
      data: {
        clientId: 'claude-remote',
        clientName: 'Claude Remote',
        grantedScopes: ['knowledge.ask', 'knowledge.search'],
        redirectUri: 'https://claude.example/callback',
        state: 'opaque-state',
        userId: 'user-1',
      },
    })
  })
})
