import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  requireRuntimeAdminSession: vi.fn(),
  useRuntimeConfig: vi.fn(),
  getKnowledgeRuntimeConfig: vi.fn(),
  fetchImpl: vi.fn<typeof globalThis.fetch>(),
  getValidatedQuery: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/admin-session', () => ({
  requireRuntimeAdminSession: mocks.requireRuntimeAdminSession,
}))

vi.mock('../../server/utils/knowledge-runtime', () => ({
  getKnowledgeRuntimeConfig: mocks.getKnowledgeRuntimeConfig,
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/usage', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', mocks.useRuntimeConfig)
    vi.stubGlobal('getValidatedQuery', mocks.getValidatedQuery)
    vi.stubGlobal('globalThis', globalThis)

    mocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
    mocks.useRuntimeConfig.mockReturnValue({
      cloudflare: {
        accountId: 'account-abc',
        analyticsApiToken: 'token-xyz',
      },
    })
    mocks.getKnowledgeRuntimeConfig.mockReturnValue({
      aiGateway: { id: 'agentic-rag-production', cacheEnabled: true },
    })
    mocks.getValidatedQuery.mockImplementation(async (_event, parse) => parse({ range: 'today' }))
    mocks.fetchImpl.mockReset()

    globalThis.fetch = mocks.fetchImpl as unknown as typeof globalThis.fetch
  })

  it('rejects unauthenticated requests', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    )

    const { default: handler } = await import('../../server/api/admin/usage.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects non-admin sessions with 403', async () => {
    mocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )

    const { default: handler } = await import('../../server/api/admin/usage.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects invalid range values before making upstream calls', async () => {
    mocks.getValidatedQuery.mockImplementationOnce(async (_event, parse) => parse({ range: 'foo' }))

    const { default: handler } = await import('../../server/api/admin/usage.get')

    await expect(handler(createRouteEvent())).rejects.toBeDefined()
    expect(mocks.fetchImpl).not.toHaveBeenCalled()
  })

  it('returns 503 when gateway id is not configured', async () => {
    mocks.getKnowledgeRuntimeConfig.mockReturnValueOnce({
      aiGateway: { id: '', cacheEnabled: true },
    })

    const { default: handler } = await import('../../server/api/admin/usage.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.fetchImpl).not.toHaveBeenCalled()
  })

  it('returns 503 when analytics token is missing', async () => {
    mocks.useRuntimeConfig.mockReturnValueOnce({
      cloudflare: { accountId: 'account-abc', analyticsApiToken: '' },
    })

    const { default: handler } = await import('../../server/api/admin/usage.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.fetchImpl).not.toHaveBeenCalled()
  })

  it('returns aggregated usage on success with bounded freeQuotaPerDay=10000', async () => {
    const now = new Date('2026-04-20T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const logs = [
      {
        created_at: '2026-04-20T10:00:00.000Z',
        cached: false,
        tokens_in: 120,
        tokens_out: 480,
        neurons: 300,
      },
      {
        created_at: '2026-04-20T11:15:00.000Z',
        cached: true,
        tokens_in: 200,
        tokens_out: 600,
        neurons: 0,
      },
    ]

    mocks.fetchImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: logs }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { default: handler } = await import('../../server/api/admin/usage.get')
    const result = (await handler(createRouteEvent())) as {
      data: {
        tokens: { input: number; output: number; total: number }
        neurons: { used: number; freeQuotaPerDay: number; remaining: number }
        requests: { total: number; cached: number; cacheHitRate: number }
        timeline: Array<{ timestamp: string; tokens: number; requests: number; cacheHits: number }>
        lastUpdatedAt: string
      }
    }

    expect(result.data.tokens).toEqual({ input: 320, output: 1080, total: 1400 })
    expect(result.data.neurons.freeQuotaPerDay).toBe(10_000)
    expect(result.data.neurons.used).toBe(300)
    expect(result.data.neurons.remaining).toBe(9_700)
    expect(result.data.requests).toEqual({ total: 2, cached: 1, cacheHitRate: 0.5 })
    expect(result.data.timeline).toHaveLength(24)
    expect(result.data.lastUpdatedAt).toBe('2026-04-20T12:00:00.000Z')

    vi.useRealTimers()
  })

  it('does not leak upstream error body in 503 response', async () => {
    mocks.fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: 'invalid api token (secret)' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const { default: handler } = await import('../../server/api/admin/usage.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 503,
      message: expect.not.stringContaining('secret'),
    })
  })

  it('maps upstream 5xx to 503 with generic message', async () => {
    mocks.fetchImpl.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))

    const { default: handler } = await import('../../server/api/admin/usage.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 503 })
  })

  it('falls back to total tokens when logs omit neurons field', async () => {
    const now = new Date('2026-04-20T06:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const logs = [
      {
        created_at: '2026-04-20T01:00:00.000Z',
        tokens_in: 100,
        tokens_out: 400,
      },
    ]

    mocks.fetchImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: logs }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { default: handler } = await import('../../server/api/admin/usage.get')
    const result = (await handler(createRouteEvent())) as {
      data: { neurons: { used: number; remaining: number } }
    }

    // No per-log `neurons` → fall back to total tokens (500), remaining = 10_000 - 500.
    expect(result.data.neurons.used).toBe(500)
    expect(result.data.neurons.remaining).toBe(9_500)

    vi.useRealTimers()
  })
})
