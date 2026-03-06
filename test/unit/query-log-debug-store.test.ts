/**
 * observability-and-debug §3 / §4.1 — unit tests for `createQueryLogDebugStore`.
 *
 * Covers:
 *  - `getDebugQueryLogById` projects 6 debug fields with null pass-through.
 *  - `summarizeLatency` classifies outcomes (answered / refused / forbidden /
 *    error) using decision_path + status, and produces null-safe p50 / p95.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryLogDebugStore } from '#server/utils/query-log-debug-store'

/**
 * Drizzle query builder chain — mimics the fluent API. All chain methods
 * return `this`; awaiting the chain resolves to the injected rows.
 */
function createFakeDb<TRow>(rows: TRow[]) {
  const chain: any = {
    from() {
      return chain
    },
    where() {
      return chain
    },
    orderBy() {
      return chain
    },
    groupBy() {
      return chain
    },
    limit() {
      return chain
    },
    offset() {
      return chain
    },
    then(resolve: (v: TRow[]) => unknown) {
      return Promise.resolve(rows).then(resolve)
    },
  }
  return {
    select() {
      return chain
    },
  }
}

vi.mock('hub:db', () => ({
  db: { __placeholder: true },
  schema: {
    queryLogs: {
      id: { __col: 'query_logs.id' },
      channel: { __col: 'query_logs.channel' },
      status: { __col: 'query_logs.status' },
      environment: { __col: 'query_logs.environment' },
      queryRedactedText: { __col: 'query_logs.query_redacted_text' },
      riskFlagsJson: { __col: 'query_logs.risk_flags_json' },
      allowedAccessLevelsJson: { __col: 'query_logs.allowed_access_levels_json' },
      redactionApplied: { __col: 'query_logs.redaction_applied' },
      configSnapshotVersion: { __col: 'query_logs.config_snapshot_version' },
      createdAt: { __col: 'query_logs.created_at' },
      firstTokenLatencyMs: { __col: 'query_logs.first_token_latency_ms' },
      completionLatencyMs: { __col: 'query_logs.completion_latency_ms' },
      retrievalScore: { __col: 'query_logs.retrieval_score' },
      judgeScore: { __col: 'query_logs.judge_score' },
      decisionPath: { __col: 'query_logs.decision_path' },
      refusalReason: { __col: 'query_logs.refusal_reason' },
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
  gte: (col: unknown, val: unknown) => ({ __op: 'gte', col, val }),
}))

describe('createQueryLogDebugStore.getDebugQueryLogById', () => {
  let hubDbStub: { db: any }

  beforeEach(async () => {
    hubDbStub = await import('hub:db')
  })

  it('returns null when row not found', async () => {
    hubDbStub.db = createFakeDb([])
    const store = createQueryLogDebugStore()
    const result = await store.getDebugQueryLogById('missing')
    expect(result).toBeNull()
  })

  it('passes through null debug fields unchanged (does not fabricate)', async () => {
    hubDbStub.db = createFakeDb([
      {
        id: 'log-legacy',
        channel: 'web',
        status: 'accepted',
        environment: 'local',
        queryRedactedText: 'redacted',
        riskFlagsJson: '[]',
        allowedAccessLevelsJson: '["internal"]',
        redactionApplied: false,
        configSnapshotVersion: 'v1',
        createdAt: '2026-04-19T00:00:00.000Z',
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
        retrievalScore: null,
        judgeScore: null,
        decisionPath: null,
        refusalReason: null,
      },
    ])
    const store = createQueryLogDebugStore()
    const result = await store.getDebugQueryLogById('log-legacy')
    expect(result).not.toBeNull()
    expect(result!.firstTokenLatencyMs).toBeNull()
    expect(result!.completionLatencyMs).toBeNull()
    expect(result!.retrievalScore).toBeNull()
    expect(result!.judgeScore).toBeNull()
    expect(result!.decisionPath).toBeNull()
    expect(result!.refusalReason).toBeNull()
  })

  it('parses redactionApplied as boolean and preserves debug values', async () => {
    hubDbStub.db = createFakeDb([
      {
        id: 'log-1',
        channel: 'mcp',
        status: 'accepted',
        environment: 'local',
        queryRedactedText: '<<redacted>>',
        riskFlagsJson: '["pii"]',
        allowedAccessLevelsJson: '["internal","confidential"]',
        redactionApplied: true,
        configSnapshotVersion: 'v1',
        createdAt: '2026-04-19T00:00:00.000Z',
        firstTokenLatencyMs: 120,
        completionLatencyMs: 1450,
        retrievalScore: 0.82,
        judgeScore: 0.91,
        decisionPath: 'judge_pass',
        refusalReason: null,
      },
    ])
    const store = createQueryLogDebugStore()
    const result = await store.getDebugQueryLogById('log-1')
    expect(result).toMatchObject({
      id: 'log-1',
      channel: 'mcp',
      redactionApplied: true,
      riskFlags: ['pii'],
      allowedAccessLevels: ['internal', 'confidential'],
      firstTokenLatencyMs: 120,
      completionLatencyMs: 1450,
      retrievalScore: 0.82,
      judgeScore: 0.91,
      decisionPath: 'judge_pass',
      refusalReason: null,
    })
  })
})

describe('createQueryLogDebugStore.summarizeLatency', () => {
  let hubDbStub: { db: any }

  beforeEach(async () => {
    hubDbStub = await import('hub:db')
  })

  it('classifies outcomes by decision_path and status', async () => {
    const rows = [
      // web: answered x2, refused x1, error x1
      {
        channel: 'web',
        status: 'accepted',
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: 100,
        completionLatencyMs: 1000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decisionPath: 'judge_pass',
        firstTokenLatencyMs: 200,
        completionLatencyMs: 2000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decisionPath: 'no_citation_refuse',
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
      },
      {
        channel: 'web',
        status: 'accepted',
        decisionPath: 'pipeline_error',
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
      },
      // mcp: forbidden x1 (blocked), answered x1
      {
        channel: 'mcp',
        status: 'blocked',
        decisionPath: 'restricted_blocked',
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
      },
      {
        channel: 'mcp',
        status: 'accepted',
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: 50,
        completionLatencyMs: 500,
      },
    ]

    hubDbStub.db = createFakeDb(rows)
    const store = createQueryLogDebugStore()
    const summary = await store.summarizeLatency({ days: 7 })

    expect(summary.days).toBe(7)
    const web = summary.channels.find((c) => c.channel === 'web')
    const mcp = summary.channels.find((c) => c.channel === 'mcp')
    expect(web).toBeDefined()
    expect(mcp).toBeDefined()
    expect(web!.outcomes).toEqual({ answered: 2, refused: 1, forbidden: 0, error: 1 })
    expect(mcp!.outcomes).toEqual({ answered: 1, refused: 0, forbidden: 1, error: 0 })
  })

  it('returns null p50/p95 for channels with no numeric latency samples', async () => {
    const rows = [
      {
        channel: 'web',
        status: 'blocked',
        decisionPath: 'restricted_blocked',
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
      },
    ]
    hubDbStub.db = createFakeDb(rows)
    const store = createQueryLogDebugStore()
    const summary = await store.summarizeLatency({ days: 7 })
    expect(summary.channels).toHaveLength(1)
    expect(summary.channels[0]!.firstTokenMs.p50).toBeNull()
    expect(summary.channels[0]!.firstTokenMs.p95).toBeNull()
    expect(summary.channels[0]!.firstTokenMs.sampleCount).toBe(0)
  })

  it('computes p50/p95 correctly for a small sample', async () => {
    const rows = [
      {
        channel: 'web',
        status: 'accepted',
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: 100,
        completionLatencyMs: 1000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: 200,
        completionLatencyMs: 2000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: 300,
        completionLatencyMs: 3000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: 400,
        completionLatencyMs: 4000,
      },
    ]
    hubDbStub.db = createFakeDb(rows)
    const store = createQueryLogDebugStore()
    const summary = await store.summarizeLatency({ days: 30 })
    expect(summary.channels[0]!.firstTokenMs.sampleCount).toBe(4)
    // p50 via nearest-rank on 4 samples → rank 2 → 200
    expect(summary.channels[0]!.firstTokenMs.p50).toBe(200)
    // p95 via nearest-rank on 4 samples → rank 4 → 400
    expect(summary.channels[0]!.firstTokenMs.p95).toBe(400)
  })

  it('orders channels deterministically: web, mcp, then alphabetical', async () => {
    const rows = [
      {
        channel: 'slack',
        status: 'accepted',
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: 100,
        completionLatencyMs: 1000,
      },
      {
        channel: 'mcp',
        status: 'accepted',
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: 100,
        completionLatencyMs: 1000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: 100,
        completionLatencyMs: 1000,
      },
    ]
    hubDbStub.db = createFakeDb(rows)
    const store = createQueryLogDebugStore()
    const summary = await store.summarizeLatency({ days: 7 })
    expect(summary.channels.map((c) => c.channel)).toEqual(['web', 'mcp', 'slack'])
  })
})
