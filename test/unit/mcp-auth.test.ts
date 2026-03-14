import { describe, expect, it, vi } from 'vitest'

import {
  hashMcpToken,
  McpAuthError,
  requireMcpBearerToken,
  requireMcpScope,
} from '#server/utils/mcp-auth'

describe('mcp auth', () => {
  it('authenticates a valid bearer token by its hash and returns usable scopes', async () => {
    const store = {
      findUsableTokenByHash: vi.fn().mockResolvedValue({
        createdAt: '2026-04-16T00:00:00.000Z',
        environment: 'local',
        expiresAt: null,
        id: 'token-1',
        lastUsedAt: null,
        name: 'Local CLI',
        revokedAt: null,
        revokedReason: null,
        scopesJson: JSON.stringify(['knowledge.ask', 'knowledge.restricted.read']),
        status: 'active',
        tokenHash: hashMcpToken('secret-token'),
      }),
      touchLastUsedAt: vi.fn().mockResolvedValue(undefined),
    }

    const result = await requireMcpBearerToken(
      {
        headers: {
          authorization: 'Bearer secret-token',
        },
      },
      {
        environment: 'local',
        store,
      },
    )

    expect(store.findUsableTokenByHash).toHaveBeenCalledWith(hashMcpToken('secret-token'), 'local')
    expect(store.touchLastUsedAt).toHaveBeenCalledWith('token-1', expect.any(String))
    expect(result.scopes).toEqual(['knowledge.ask', 'knowledge.restricted.read'])
  })

  it('returns 401 when the bearer token is missing or invalid', async () => {
    await expect(
      requireMcpBearerToken(
        {
          headers: {},
        },
        {
          environment: 'local',
          store: {
            findUsableTokenByHash: vi.fn(),
            touchLastUsedAt: vi.fn(),
          },
        },
      ),
    ).rejects.toThrowError(new McpAuthError('A valid Bearer token is required', 401))
  })

  it('returns 403 when the authenticated token lacks the required scope', () => {
    expect(() =>
      requireMcpScope(
        {
          scopes: ['knowledge.search'],
          tokenId: 'token-1',
        },
        'knowledge.ask',
      ),
    ).toThrowError(new McpAuthError('The MCP token is missing required scope: knowledge.ask', 403))
  })
})
