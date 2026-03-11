import {
  MCP_TOKEN_SCOPE_VALUES,
  deriveAllowedAccessLevels,
} from '#shared/schemas/knowledge-runtime'
import { hasRuntimeAdminAccess } from '#server/utils/allowlist'
import { buildProvisionedMcpToken } from '#server/utils/mcp-token-store'

export const ACCEPTANCE_ACTOR_PRESET_VALUES = ['user', 'admin', 'restricted', 'no-scope'] as const

export interface AcceptanceActorFixture {
  adminEmailAllowlist: string[]
  allowedAccessLevels: {
    mcp: string[]
    web: string[]
  }
  isAdmin: boolean
  mcpAuth: {
    scopes: string[]
    tokenId: string
  }
  mcpToken: {
    authorizationHeader: string
    plaintextToken: string
    record: {
      name: string
      scopesJson: string
      tokenHash: string
    }
  }
  preset: string
  webSession: {
    user: {
      email: string
      id: string
      name: string
      role: 'admin' | 'member' | 'guest'
    }
  }
}

export function createAcceptanceActorFixture(preset: string): AcceptanceActorFixture {
  const userId = preset.replace(/[^a-z]/g, '') || 'user'
  const email = `${userId}@example.com`
  const adminEmailAllowlist = preset === 'admin' ? [email] : []
  const isAdmin = hasRuntimeAdminAccess(email, adminEmailAllowlist)
  const scopes = resolvePresetScopes(preset)
  const provisionedToken = buildProvisionedMcpToken(
    {
      createdByUserId: `${preset}-user`,
      environment: 'local',
      expiresAt: null,
      name: `Acceptance ${preset}`,
      scopes,
    },
    {
      createId: () => `${preset}-token`,
      createSecret: () => `${preset}-secret-token`,
      now: () => new Date('2026-04-16T00:00:00.000Z'),
    }
  )

  return {
    adminEmailAllowlist,
    allowedAccessLevels: {
      mcp: deriveAllowedAccessLevels({
        channel: 'mcp',
        isAuthenticated: true,
        tokenScopes: scopes,
      }),
      web: deriveAllowedAccessLevels({
        channel: 'web',
        isAdmin,
        isAuthenticated: true,
      }),
    },
    isAdmin,
    mcpAuth: {
      scopes,
      tokenId: provisionedToken.record.id,
    },
    mcpToken: {
      authorizationHeader: `Bearer ${provisionedToken.plaintextToken}`,
      plaintextToken: provisionedToken.plaintextToken,
      record: {
        name: provisionedToken.record.name,
        scopesJson: provisionedToken.record.scopesJson,
        tokenHash: provisionedToken.record.tokenHash,
      },
    },
    preset,
    webSession: {
      user: {
        email,
        id: `${preset}-user`,
        name: `Acceptance ${preset}`,
        role: isAdmin ? 'admin' : 'member',
      },
    },
  }
}

function resolvePresetScopes(preset: string): string[] {
  switch (preset) {
    case 'admin':
    case 'user':
      return MCP_TOKEN_SCOPE_VALUES.filter((scope) => scope !== 'knowledge.restricted.read')
    case 'restricted':
      return [...MCP_TOKEN_SCOPE_VALUES]
    case 'no-scope':
      return []
    default:
      throw new Error(`Unknown acceptance actor preset: ${preset}`)
  }
}
