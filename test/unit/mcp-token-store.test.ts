import { describe, expect, it } from 'vitest'

import { buildProvisionedMcpToken } from '#server/utils/mcp-token-store'

describe('mcp token store', () => {
  it('provisions a plaintext token once while persisting only its hash', () => {
    const provisioned = buildProvisionedMcpToken(
      {
        environment: 'local',
        expiresAt: null,
        name: 'Staging QA',
        scopes: ['knowledge.ask', 'knowledge.search', 'knowledge.ask'],
      },
      {
        createId: () => 'token-1',
        createSecret: () => 'plain-secret-token',
        now: () => new Date('2026-04-16T00:00:00.000Z'),
      }
    )

    expect(provisioned.plaintextToken).toBe('plain-secret-token')
    expect(provisioned.record).toEqual({
      createdAt: '2026-04-16T00:00:00.000Z',
      environment: 'local',
      expiresAt: null,
      id: 'token-1',
      lastUsedAt: null,
      name: 'Staging QA',
      revokedAt: null,
      revokedReason: null,
      scopesJson: JSON.stringify(['knowledge.ask', 'knowledge.search']),
      status: 'active',
      tokenHash: expect.any(String),
    })
    expect(provisioned.record.tokenHash).not.toBe(provisioned.plaintextToken)
  })
})
