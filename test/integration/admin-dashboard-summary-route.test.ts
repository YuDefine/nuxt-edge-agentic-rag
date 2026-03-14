import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  countDocuments: vi.fn(),
  countRecentQueryLogs: vi.fn(),
  countActiveTokens: vi.fn(),
  listRecentQueryTrend: vi.fn(),
  requireRuntimeAdminSession: vi.fn().mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com' },
  }),
  useRuntimeConfig: vi.fn(),
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

vi.mock('../../server/utils/admin-dashboard-store', () => ({
  createAdminDashboardStore: () => ({
    countDocuments: mocks.countDocuments,
    countRecentQueryLogs: mocks.countRecentQueryLogs,
    countActiveTokens: mocks.countActiveTokens,
    listRecentQueryTrend: mocks.listRecentQueryTrend,
  }),
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/dashboard/summary', () => {
  beforeEach(() => {
    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    vi.stubGlobal('useRuntimeConfig', mocks.useRuntimeConfig)

    mocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
    mocks.countDocuments.mockResolvedValue(0)
    mocks.countRecentQueryLogs.mockResolvedValue(0)
    mocks.countActiveTokens.mockResolvedValue(0)
    mocks.listRecentQueryTrend.mockResolvedValue([])
    mocks.useRuntimeConfig.mockReturnValue({
      adminDashboardEnabled: true,
    })
  })

  it('rejects unauthenticated requests with 401', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    )

    const { default: handler } = await import('../../server/api/admin/dashboard/summary.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects non-admin sessions with 403', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )

    const { default: handler } = await import('../../server/api/admin/dashboard/summary.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 when adminDashboardEnabled is false', async () => {
    mocks.useRuntimeConfig.mockReturnValueOnce({
      adminDashboardEnabled: false,
    })

    const { default: handler } = await import('../../server/api/admin/dashboard/summary.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns aggregate summary cards (no raw rows, no risk text)', async () => {
    mocks.countDocuments.mockResolvedValueOnce(42)
    mocks.countRecentQueryLogs.mockResolvedValueOnce(128)
    mocks.countActiveTokens.mockResolvedValueOnce(3)
    mocks.listRecentQueryTrend.mockResolvedValueOnce([
      { date: '2026-04-13', count: 12 },
      { date: '2026-04-14', count: 18 },
      { date: '2026-04-15', count: 20 },
      { date: '2026-04-16', count: 24 },
      { date: '2026-04-17', count: 30 },
      { date: '2026-04-18', count: 16 },
      { date: '2026-04-19', count: 8 },
    ])

    const { default: handler } = await import('../../server/api/admin/dashboard/summary.get')
    const result = (await handler(createRouteEvent())) as {
      data: {
        cards: {
          documentsTotal: number
          queriesLast30Days: number
          tokensActive: number
        }
        trend: Array<{ count: number; date: string }>
      }
    }

    expect(result.data).toMatchObject({
      cards: {
        documentsTotal: 42,
        queriesLast30Days: 128,
        tokensActive: 3,
      },
    })
    expect(result.data.trend).toHaveLength(7)
    expect(result.data.trend[0]).toEqual({ date: '2026-04-13', count: 12 })
    // Redaction guarantee — dashboard MUST NOT return raw query text or token_hash.
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/query_text/i)
    expect(serialized).not.toMatch(/raw_query/i)
    expect(serialized).not.toMatch(/token_hash/i)
  })

  it('honors requireRuntimeAdminSession (called before feature check)', async () => {
    mocks.useRuntimeConfig.mockReturnValue({
      adminDashboardEnabled: false,
    })
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )

    const { default: handler } = await import('../../server/api/admin/dashboard/summary.get')

    // Auth should fire before feature flag — must be 403, not 404.
    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 403 })
  })
})
