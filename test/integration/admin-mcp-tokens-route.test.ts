import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  listTokensForAdmin: vi.fn(),
  countTokensForAdmin: vi.fn(),
  revokeTokenById: vi.fn(),
  requireRuntimeAdminSession: vi.fn().mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com' },
  }),
  getValidatedQuery: vi.fn(),
  getValidatedRouterParams: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/admin-session', () => ({
  requireRuntimeAdminSession: mocks.requireRuntimeAdminSession,
}))

vi.mock('../../server/utils/mcp-token-store', () => ({
  createMcpTokenAdminStore: () => ({
    listTokensForAdmin: mocks.listTokensForAdmin,
    countTokensForAdmin: mocks.countTokensForAdmin,
    revokeTokenById: mocks.revokeTokenById,
  }),
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/mcp-tokens', () => {
  beforeEach(() => {
    vi.stubGlobal('getValidatedQuery', mocks.getValidatedQuery)
    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    mocks.getValidatedQuery.mockResolvedValue({ page: 1, pageSize: 20 })
    mocks.listTokensForAdmin.mockResolvedValue([])
    mocks.countTokensForAdmin.mockResolvedValue(0)
    mocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
  })

  it('rejects requests without an authenticated session (401)', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    )

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/index.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects non-admin sessions with 403', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    )

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/index.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns token rows WITHOUT token_hash (redaction guarantee)', async () => {
    mocks.listTokensForAdmin.mockResolvedValueOnce([
      {
        id: 'tok-1',
        name: 'CI Token',
        scopes: ['knowledge.ask'],
        status: 'active',
        expiresAt: null,
        lastUsedAt: null,
        createdAt: '2026-04-19T00:00:00.000Z',
      },
    ])
    mocks.countTokensForAdmin.mockResolvedValueOnce(1)

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/index.get')
    const result = (await handler(createRouteEvent())) as {
      data: Array<Record<string, unknown>>
      pagination: { page: number; pageSize: number; total: number }
    }

    expect(result.data).toHaveLength(1)
    const row = result.data[0]!
    expect(row).toMatchObject({
      id: 'tok-1',
      name: 'CI Token',
      scopes: ['knowledge.ask'],
      status: 'active',
    })
    // Redaction guarantee: token_hash MUST never leak.
    expect(row).not.toHaveProperty('token_hash')
    expect(row).not.toHaveProperty('tokenHash')
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 1 })
  })

  it('returns empty list with zero total when no tokens exist', async () => {
    const { default: handler } = await import('../../server/api/admin/mcp-tokens/index.get')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0 },
    })
  })
})

describe('DELETE /api/admin/mcp-tokens/[id]', () => {
  beforeEach(() => {
    vi.stubGlobal('getValidatedRouterParams', mocks.getValidatedRouterParams)
    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    mocks.getValidatedRouterParams.mockResolvedValue({ id: 'tok-1' })
    mocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
  })

  it('rejects unauthenticated requests with 401', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    )

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')

    await expect(
      handler(createRouteEvent({ context: { params: { id: 'tok-1' }, cloudflare: { env: {} } } }))
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects non-admin sessions with 403', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    )

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')

    await expect(
      handler(createRouteEvent({ context: { params: { id: 'tok-1' }, cloudflare: { env: {} } } }))
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 when the token does not exist', async () => {
    mocks.revokeTokenById.mockResolvedValueOnce({ outcome: 'not-found' })

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')

    await expect(
      handler(createRouteEvent({ context: { params: { id: 'tok-1' }, cloudflare: { env: {} } } }))
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('revokes an active token and returns revoked state', async () => {
    mocks.revokeTokenById.mockResolvedValueOnce({
      outcome: 'revoked',
      token: {
        id: 'tok-1',
        status: 'revoked',
        revokedAt: '2026-04-19T01:00:00.000Z',
      },
    })

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')
    const result = await handler(
      createRouteEvent({ context: { params: { id: 'tok-1' }, cloudflare: { env: {} } } })
    )

    expect(result).toEqual({
      data: {
        id: 'tok-1',
        status: 'revoked',
        revokedAt: '2026-04-19T01:00:00.000Z',
        alreadyRevoked: false,
      },
    })
  })

  it('is idempotent: already-revoked token returns 200 with alreadyRevoked=true', async () => {
    mocks.revokeTokenById.mockResolvedValueOnce({
      outcome: 'already-revoked',
      token: {
        id: 'tok-1',
        status: 'revoked',
        revokedAt: '2026-04-10T00:00:00.000Z',
      },
    })

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')
    const result = await handler(
      createRouteEvent({ context: { params: { id: 'tok-1' }, cloudflare: { env: {} } } })
    )

    expect(result).toEqual({
      data: {
        id: 'tok-1',
        status: 'revoked',
        revokedAt: '2026-04-10T00:00:00.000Z',
        alreadyRevoked: true,
      },
    })
  })
})
