/**
 * observability-and-debug §3 / §4.1 — integration tests for the latency +
 * outcome summary endpoint used by `/admin/debug/latency`.
 *
 * Contract:
 *  - Admin + prod flag gated (delegates to requireInternalDebugAccess).
 *  - Query param `days` defaults to 7, accepts 7 | 30.
 *  - Returns per-channel latency p50/p95 for first-token and completion,
 *    plus outcome breakdown counts (answered / refused / forbidden / error).
 *  - Latency values are `number | null`; never fabricated.
 *  - No raw query text in response.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  summarizeLatency: vi.fn(),
  requireInternalDebugAccess: vi.fn().mockResolvedValue({
    userId: 'admin-1',
    environment: 'local',
    enabledByFlag: false,
  }),
  getValidatedQuery: vi.fn(),
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
    summarizeLatency: mocks.summarizeLatency,
  }),
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/debug/latency/summary', () => {
  beforeEach(() => {
    vi.stubGlobal('getValidatedQuery', mocks.getValidatedQuery)
    mocks.getValidatedQuery.mockResolvedValue({ days: 7 })
    mocks.requireInternalDebugAccess.mockResolvedValue({
      userId: 'admin-1',
      environment: 'local',
      enabledByFlag: false,
    })
  })

  it('rejects non-admin with 401/403 (delegate to guard)', async () => {
    mocks.requireInternalDebugAccess.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    )

    const { default: handler } = await import('../../server/api/admin/debug/latency/summary.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects production + flag off with 403', async () => {
    mocks.requireInternalDebugAccess.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    )

    const { default: handler } = await import('../../server/api/admin/debug/latency/summary.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('admin + local → returns channels × latency p50/p95 + outcome breakdown', async () => {
    mocks.summarizeLatency.mockResolvedValueOnce({
      days: 7,
      channels: [
        {
          channel: 'web',
          firstTokenMs: { p50: 120, p95: 310, sampleCount: 42 },
          completionMs: { p50: 1200, p95: 2800, sampleCount: 42 },
          outcomes: {
            answered: 38,
            refused: 3,
            forbidden: 1,
            error: 0,
          },
        },
        {
          channel: 'mcp',
          firstTokenMs: { p50: 95, p95: 220, sampleCount: 10 },
          completionMs: { p50: 980, p95: 1900, sampleCount: 10 },
          outcomes: { answered: 9, refused: 1, forbidden: 0, error: 0 },
        },
      ],
    })

    const { default: handler } = await import('../../server/api/admin/debug/latency/summary.get')

    const result = (await handler(createRouteEvent())) as {
      data: {
        days: number
        channels: Array<Record<string, unknown>>
      }
    }

    expect(result.data.days).toBe(7)
    expect(result.data.channels).toHaveLength(2)
    expect(result.data.channels[0]).toMatchObject({
      channel: 'web',
      firstTokenMs: { p50: 120, p95: 310 },
      outcomes: { answered: 38, refused: 3, forbidden: 1, error: 0 },
    })

    // Redaction guarantee: no raw query text anywhere in aggregate.
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('query_text')
    expect(serialized).not.toContain('rawQuery')
  })

  it('allows days=30 and passes through to the store', async () => {
    mocks.getValidatedQuery.mockResolvedValueOnce({ days: 30 })
    mocks.summarizeLatency.mockResolvedValueOnce({
      days: 30,
      channels: [],
    })

    const { default: handler } = await import('../../server/api/admin/debug/latency/summary.get')
    await handler(createRouteEvent())

    expect(mocks.summarizeLatency).toHaveBeenCalledWith(expect.objectContaining({ days: 30 }))
  })

  it('accepts null p50/p95 for channels with no completed rows', async () => {
    mocks.summarizeLatency.mockResolvedValueOnce({
      days: 7,
      channels: [
        {
          channel: 'web',
          firstTokenMs: { p50: null, p95: null, sampleCount: 0 },
          completionMs: { p50: null, p95: null, sampleCount: 0 },
          outcomes: { answered: 0, refused: 0, forbidden: 0, error: 0 },
        },
      ],
    })

    const { default: handler } = await import('../../server/api/admin/debug/latency/summary.get')

    const result = (await handler(createRouteEvent())) as {
      data: { channels: Array<{ firstTokenMs: { p50: number | null } }> }
    }

    expect(result.data.channels[0]?.firstTokenMs.p50).toBeNull()
  })
})
