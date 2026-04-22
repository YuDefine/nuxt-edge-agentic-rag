import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  readBody: vi.fn(),
  requireUserSession: vi.fn(),
}))

installNuxtRouteTestGlobals()

describe('POST /api/auth/mcp/authorize local-account guard', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('readBody', mocks.readBody)
    vi.stubGlobal('requireUserSession', mocks.requireUserSession)

    mocks.readBody.mockResolvedValue({
      approved: true,
      clientId: 'claude-remote',
      redirectUri: 'https://claude.example/callback',
      scope: 'knowledge.ask',
    })
  })

  it('rejects sessions that do not carry a local user id', async () => {
    mocks.requireUserSession.mockResolvedValue({
      user: {},
    })

    const { default: handler } = await import('../../server/api/auth/mcp/authorize.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 403,
      message: 'MCP authorization requires a local account',
    })
  })
})
