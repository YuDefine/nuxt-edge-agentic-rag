import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from '../integration/helpers/nuxt-route'

installNuxtRouteTestGlobals()

describe('gateMcpToolAccess', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('uses oauth principal user id when no legacy token record is attached', async () => {
    vi.doMock('#server/utils/guest-policy', () => ({
      getGuestPolicy: vi.fn().mockResolvedValue('same_as_member'),
    }))

    const { gateMcpToolAccess } = await import('#server/utils/mcp-role-gate')

    await expect(
      gateMcpToolAccess(createRouteEvent(), {
        auth: {
          principal: {
            authSource: 'oauth_access_token',
            userId: 'user-1',
          },
          scopes: ['knowledge.ask'],
          tokenId: 'oauth-token-1',
        },
        toolName: 'askKnowledge',
        userRoleLookup: {
          async lookupRoleByUserId(userId: string) {
            return userId === 'user-1' ? 'member' : null
          },
        },
      }),
    ).resolves.toBeUndefined()
  })

  it('keeps rejecting auth contexts that resolve to no principal user id', async () => {
    vi.doMock('#server/utils/guest-policy', () => ({
      getGuestPolicy: vi.fn().mockResolvedValue('same_as_member'),
    }))

    const { gateMcpToolAccess } = await import('#server/utils/mcp-role-gate')

    await expect(
      gateMcpToolAccess(createRouteEvent(), {
        auth: {
          principal: {
            authSource: 'oauth_access_token',
            userId: '',
          },
          scopes: ['knowledge.ask'],
          tokenId: 'oauth-token-1',
        },
        toolName: 'askKnowledge',
        userRoleLookup: {
          async lookupRoleByUserId() {
            return null
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'UNKNOWN_TOKEN_OWNER',
      statusCode: 403,
    })
  })
})
