/**
 * observability-and-debug §2 / §4.1 — integration tests for the internal
 * debug query-log detail endpoint.
 *
 * These tests assert the debug route:
 *  - Delegates auth to `requireInternalDebugAccess` (admin + prod flag).
 *  - Returns all 6 debug fields plus redaction-safe core fields.
 *  - Never returns raw query text.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  getDebugQueryLogById: vi.fn(),
  requireInternalDebugAccess: vi.fn().mockResolvedValue({
    userId: 'admin-1',
    environment: 'local',
    enabledByFlag: false,
  }),
  getValidatedRouterParams: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/debug-surface-guard', () => ({
  requireInternalDebugAccess: mocks.requireInternalDebugAccess,
}))

vi.mock('../../server/utils/query-log-debug-store', () => ({
  createQueryLogDebugStore: () => ({
    getDebugQueryLogById: mocks.getDebugQueryLogById,
  }),
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/debug/query-logs/[id]', () => {
  beforeEach(() => {
    vi.stubGlobal('getValidatedRouterParams', mocks.getValidatedRouterParams)
    mocks.getValidatedRouterParams.mockResolvedValue({ id: 'log-1' })
    mocks.requireInternalDebugAccess.mockResolvedValue({
      userId: 'admin-1',
      environment: 'local',
      enabledByFlag: false,
    })
  })

  it('rejects non-admin (delegate 401/403 from guard)', async () => {
    mocks.requireInternalDebugAccess.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    )

    const { default: handler } = await import('../../server/api/admin/debug/query-logs/[id].get')

    await expect(
      handler(createRouteEvent({ context: { params: { id: 'log-1' }, cloudflare: { env: {} } } })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects admin in production with flag off → 403', async () => {
    mocks.requireInternalDebugAccess.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )

    const { default: handler } = await import('../../server/api/admin/debug/query-logs/[id].get')

    await expect(
      handler(createRouteEvent({ context: { params: { id: 'log-1' }, cloudflare: { env: {} } } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('admin in local environment → returns debug fields', async () => {
    mocks.getDebugQueryLogById.mockResolvedValueOnce({
      id: 'log-1',
      channel: 'mcp',
      status: 'accepted',
      environment: 'local',
      queryRedactedText: '<<redacted>>',
      redactionApplied: true,
      riskFlags: ['pii'],
      allowedAccessLevels: ['internal'],
      citationsJson: '[]',
      configSnapshotVersion: 'v1',
      createdAt: '2026-04-19T00:00:00.000Z',
      firstTokenLatencyMs: 120,
      completionLatencyMs: 1450,
      retrievalScore: 0.82,
      judgeScore: 0.91,
      decisionPath: 'direct_answer',
      refusalReason: null,
    })

    const { default: handler } = await import('../../server/api/admin/debug/query-logs/[id].get')
    const result = (await handler(
      createRouteEvent({ context: { params: { id: 'log-1' }, cloudflare: { env: {} } } }),
    )) as { data: Record<string, unknown> }

    expect(result.data).toMatchObject({
      id: 'log-1',
      channel: 'mcp',
      status: 'accepted',
      queryRedactedText: '<<redacted>>',
      firstTokenLatencyMs: 120,
      completionLatencyMs: 1450,
      retrievalScore: 0.82,
      judgeScore: 0.91,
      decisionPath: 'direct_answer',
      refusalReason: null,
    })
    // Redaction guarantee.
    expect(result.data).not.toHaveProperty('query_text')
    expect(result.data).not.toHaveProperty('queryText')
    expect(result.data).not.toHaveProperty('rawQuery')
  })

  it('returns null debug fields without fabricating (legacy row)', async () => {
    mocks.getDebugQueryLogById.mockResolvedValueOnce({
      id: 'log-2',
      channel: 'web',
      status: 'accepted',
      environment: 'local',
      queryRedactedText: 'redacted text',
      redactionApplied: false,
      riskFlags: [],
      allowedAccessLevels: ['internal'],
      citationsJson: '[]',
      configSnapshotVersion: 'v1',
      createdAt: '2026-04-19T00:00:00.000Z',
      firstTokenLatencyMs: null,
      completionLatencyMs: null,
      retrievalScore: null,
      judgeScore: null,
      decisionPath: null,
      refusalReason: null,
    })

    const { default: handler } = await import('../../server/api/admin/debug/query-logs/[id].get')
    const result = (await handler(
      createRouteEvent({ context: { params: { id: 'log-2' }, cloudflare: { env: {} } } }),
    )) as { data: Record<string, unknown> }

    expect(result.data.firstTokenLatencyMs).toBeNull()
    expect(result.data.completionLatencyMs).toBeNull()
    expect(result.data.retrievalScore).toBeNull()
    expect(result.data.judgeScore).toBeNull()
    expect(result.data.decisionPath).toBeNull()
    expect(result.data.refusalReason).toBeNull()
  })

  it('returns 404 when the log does not exist', async () => {
    mocks.getDebugQueryLogById.mockResolvedValueOnce(null)

    const { default: handler } = await import('../../server/api/admin/debug/query-logs/[id].get')

    await expect(
      handler(createRouteEvent({ context: { params: { id: 'log-1' }, cloudflare: { env: {} } } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
