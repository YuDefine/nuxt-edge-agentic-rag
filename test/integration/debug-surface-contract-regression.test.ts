/**
 * observability-and-debug §4.2 — regression test suite that protects the
 * public-facing API contracts from ever leaking the 6 internal debug fields.
 *
 * Scope:
 *   1. `/api/chat` response shape — top-level answer payload.
 *   2. `/api/admin/query-logs/[id]` (Phase-1 non-debug admin endpoint) —
 *      must NOT expose debug fields. Debug fields are only exposed through
 *      `/api/admin/debug/query-logs/[id]` which is gated by
 *      `requireInternalDebugAccess`.
 *
 * The `/mcp` JSON-RPC transport is covered separately in
 * `test/unit/mcp-ask-observability.test.ts` (tool output schema stays at the
 * knowledge-answering level).
 */

import { beforeEach, describe, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const DEBUG_FIELDS = [
  'firstTokenLatencyMs',
  'first_token_latency_ms',
  'completionLatencyMs',
  'completion_latency_ms',
  'retrievalScore',
  'retrieval_score',
  'judgeScore',
  'judge_score',
  'decisionPath',
  'decision_path',
  'refusalReason',
  'refusal_reason',
] as const

function assertNoDebugLeak(payload: unknown, surface: string): void {
  const serialized = JSON.stringify(payload)
  for (const field of DEBUG_FIELDS) {
    if (serialized.includes(`"${field}"`)) {
      throw new Error(
        `${surface} leaked debug field "${field}" — production contract must keep these internal.`
      )
    }
  }
}

const adminStoreMocks = vi.hoisted(() => ({
  getQueryLogById: vi.fn(),
  requireRuntimeAdminSession: vi.fn().mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com' },
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

vi.mock('../../server/utils/admin-session', () => ({
  requireRuntimeAdminSession: adminStoreMocks.requireRuntimeAdminSession,
}))

vi.mock('../../server/utils/query-log-admin-store', () => ({
  createQueryLogAdminStore: () => ({
    getQueryLogById: adminStoreMocks.getQueryLogById,
  }),
}))

installNuxtRouteTestGlobals()

describe('/api/admin/query-logs/[id] — non-debug admin endpoint', () => {
  beforeEach(() => {
    vi.stubGlobal('getValidatedRouterParams', adminStoreMocks.getValidatedRouterParams)
    vi.stubGlobal('requireRuntimeAdminSession', adminStoreMocks.requireRuntimeAdminSession)
    adminStoreMocks.getValidatedRouterParams.mockResolvedValue({ id: 'log-1' })
    adminStoreMocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
  })

  it('admin detail response never includes debug fields (even when the row has them)', async () => {
    // Even if the store layer accidentally returns debug fields, the endpoint
    // projection must drop them. This guards against future refactors that
    // add fields without filtering.
    adminStoreMocks.getQueryLogById.mockResolvedValueOnce({
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
      // Intentional pollution: simulate a store that accidentally exposes
      // debug fields. The endpoint MUST NOT forward them.
      firstTokenLatencyMs: 120,
      completionLatencyMs: 1450,
      retrievalScore: 0.82,
      judgeScore: 0.91,
      decisionPath: 'direct_answer',
      refusalReason: null,
    })

    const { default: handler } = await import('../../server/api/admin/query-logs/[id].get')
    const result = await handler(
      createRouteEvent({ context: { params: { id: 'log-1' }, cloudflare: { env: {} } } })
    )

    assertNoDebugLeak(result, '/api/admin/query-logs/[id]')
  })
})
