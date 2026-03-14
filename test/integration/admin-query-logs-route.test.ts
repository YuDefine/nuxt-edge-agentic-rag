import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  listQueryLogs: vi.fn(),
  countQueryLogs: vi.fn(),
  getQueryLogById: vi.fn(),
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

vi.mock('../../server/utils/query-log-admin-store', () => ({
  createQueryLogAdminStore: () => ({
    listQueryLogs: mocks.listQueryLogs,
    countQueryLogs: mocks.countQueryLogs,
    getQueryLogById: mocks.getQueryLogById,
  }),
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/query-logs', () => {
  beforeEach(() => {
    vi.stubGlobal('getValidatedQuery', mocks.getValidatedQuery)
    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    mocks.getValidatedQuery.mockResolvedValue({
      page: 1,
      pageSize: 20,
    })
    mocks.listQueryLogs.mockResolvedValue([])
    mocks.countQueryLogs.mockResolvedValue(0)
    mocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
  })

  it('rejects unauthenticated requests with 401', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    )

    const { default: handler } = await import('../../server/api/admin/query-logs/index.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects non-admin sessions with 403', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )

    const { default: handler } = await import('../../server/api/admin/query-logs/index.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns redaction-safe rows (never includes raw query text)', async () => {
    mocks.listQueryLogs.mockResolvedValueOnce([
      {
        id: 'log-1',
        channel: 'mcp',
        status: 'accepted',
        environment: 'local',
        queryRedactedText: '<<redacted>>',
        redactionApplied: true,
        riskFlagsJson: '["pii"]',
        configSnapshotVersion: 'v1',
        createdAt: '2026-04-19T00:00:00.000Z',
      },
    ])
    mocks.countQueryLogs.mockResolvedValueOnce(1)

    const { default: handler } = await import('../../server/api/admin/query-logs/index.get')
    const result = (await handler(createRouteEvent())) as {
      data: Array<Record<string, unknown>>
      pagination: { page: number; pageSize: number; total: number }
    }

    expect(result.data).toHaveLength(1)
    const row = result.data[0]!
    expect(row).toMatchObject({
      id: 'log-1',
      channel: 'mcp',
      status: 'accepted',
      queryRedactedText: '<<redacted>>',
      redactionApplied: true,
    })
    // Redaction guarantee — never expose raw query text by any key name.
    expect(row).not.toHaveProperty('query_text')
    expect(row).not.toHaveProperty('queryText')
    expect(row).not.toHaveProperty('raw_query')
    expect(row).not.toHaveProperty('rawQuery')
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 1 })
  })

  it('forwards filter params to the store', async () => {
    mocks.getValidatedQuery.mockResolvedValueOnce({
      page: 1,
      pageSize: 20,
      channel: 'web',
      status: 'blocked',
      redactionApplied: true,
      startDate: '2026-04-01T00:00:00.000Z',
      endDate: '2026-04-19T00:00:00.000Z',
    })

    const { default: handler } = await import('../../server/api/admin/query-logs/index.get')
    await handler(createRouteEvent())

    expect(mocks.listQueryLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'web',
        status: 'blocked',
        redactionApplied: true,
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-04-19T00:00:00.000Z',
      }),
    )
  })
})

describe('GET /api/admin/query-logs/[id]', () => {
  beforeEach(() => {
    vi.stubGlobal('getValidatedRouterParams', mocks.getValidatedRouterParams)
    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    mocks.getValidatedRouterParams.mockResolvedValue({ id: 'log-1' })
    mocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
  })

  it('rejects unauthenticated requests with 401', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    )

    const { default: handler } = await import('../../server/api/admin/query-logs/[id].get')

    await expect(
      handler(createRouteEvent({ context: { params: { id: 'log-1' }, cloudflare: { env: {} } } })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects non-admin sessions with 403', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )

    const { default: handler } = await import('../../server/api/admin/query-logs/[id].get')

    await expect(
      handler(createRouteEvent({ context: { params: { id: 'log-1' }, cloudflare: { env: {} } } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 when the log does not exist', async () => {
    mocks.getQueryLogById.mockResolvedValueOnce(null)

    const { default: handler } = await import('../../server/api/admin/query-logs/[id].get')

    await expect(
      handler(createRouteEvent({ context: { params: { id: 'log-1' }, cloudflare: { env: {} } } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns redaction-safe detail (never includes raw query text)', async () => {
    mocks.getQueryLogById.mockResolvedValueOnce({
      id: 'log-1',
      channel: 'mcp',
      status: 'accepted',
      environment: 'local',
      queryRedactedText: '<<redacted>>',
      redactionApplied: true,
      riskFlags: ['pii'],
      allowedAccessLevels: ['internal'],
      configSnapshotVersion: 'v1',
      createdAt: '2026-04-19T00:00:00.000Z',
    })

    const { default: handler } = await import('../../server/api/admin/query-logs/[id].get')
    const result = (await handler(
      createRouteEvent({ context: { params: { id: 'log-1' }, cloudflare: { env: {} } } }),
    )) as { data: Record<string, unknown> }

    expect(result.data).toMatchObject({
      id: 'log-1',
      channel: 'mcp',
      queryRedactedText: '<<redacted>>',
      riskFlags: ['pii'],
      configSnapshotVersion: 'v1',
    })
    // Redaction guarantee.
    expect(result.data).not.toHaveProperty('query_text')
    expect(result.data).not.toHaveProperty('queryText')
    expect(result.data).not.toHaveProperty('raw_query')
    expect(result.data).not.toHaveProperty('rawQuery')
  })
})
