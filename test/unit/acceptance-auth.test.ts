import { describe, expect, it } from 'vitest'

import { hasRuntimeAdminAccess } from '../../server/utils/allowlist'
import { requireMcpScope } from '../../server/utils/mcp-auth'

interface AuthModule {
  ACCEPTANCE_ACTOR_PRESET_VALUES: string[]
  createAcceptanceActorFixture(preset: string): {
    adminEmailAllowlist: string[]
    allowedAccessLevels: {
      mcp: string[]
      web: string[]
    }
    mcpAuth: {
      scopes: string[]
      tokenId: string
    }
    mcpToken: {
      authorizationHeader: string
      plaintextToken: string
      record: {
        name: string
      }
    }
    preset: string
    webSession: {
      user: {
        email: string
        id: string
      }
    }
  }
}

async function importAuthModule(): Promise<AuthModule | null> {
  try {
    return (await import('../acceptance/helpers/auth')) as AuthModule
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/i.test(error.message)) {
      return null
    }

    throw error
  }
}

describe('acceptance auth helpers', () => {
  it('covers user, admin, restricted, and no-scope presets with reusable session and token fixtures', async () => {
    const module = await importAuthModule()

    expect(module).not.toBeNull()
    expect(module?.ACCEPTANCE_ACTOR_PRESET_VALUES).toEqual([
      'user',
      'admin',
      'restricted',
      'no-scope',
    ])

    const user = module?.createAcceptanceActorFixture('user')
    const admin = module?.createAcceptanceActorFixture('admin')
    const restricted = module?.createAcceptanceActorFixture('restricted')
    const noScope = module?.createAcceptanceActorFixture('no-scope')

    expect(user?.preset).toBe('user')
    expect(user?.allowedAccessLevels.web).toEqual(['internal'])
    expect(user?.allowedAccessLevels.mcp).toEqual(['internal'])
    expect(
      hasRuntimeAdminAccess(user?.webSession.user.email, user?.adminEmailAllowlist ?? [])
    ).toBe(false)

    expect(admin?.allowedAccessLevels.web).toEqual(['internal', 'restricted'])
    expect(
      hasRuntimeAdminAccess(admin?.webSession.user.email, admin?.adminEmailAllowlist ?? [])
    ).toBe(true)

    expect(restricted?.allowedAccessLevels.mcp).toEqual(['internal', 'restricted'])
    expect(() =>
      requireMcpScope(restricted?.mcpAuth ?? { scopes: [], tokenId: '' }, 'knowledge.ask')
    ).not.toThrow()

    expect(noScope?.mcpToken.authorizationHeader).toContain('Bearer ')
    expect(() =>
      requireMcpScope(noScope?.mcpAuth ?? { scopes: [], tokenId: '' }, 'knowledge.ask')
    ).toThrowError('The MCP token is missing required scope: knowledge.ask')
  })
})
