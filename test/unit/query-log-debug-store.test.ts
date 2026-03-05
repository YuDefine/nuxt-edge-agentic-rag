/**
 * observability-and-debug §3 / §4.1 — unit tests for `createQueryLogDebugStore`.
 *
 * Covers:
 *  - `getDebugQueryLogById` projects 6 debug fields with null pass-through.
 *  - `summarizeLatency` classifies outcomes (answered / refused / forbidden /
 *    error) using decision_path + status, and produces null-safe p50 / p95.
 */

import { describe, expect, it, vi } from 'vitest'

import { createQueryLogDebugStore } from '#server/utils/query-log-debug-store'

interface FakeResults<T> {
  results?: T[]
}

function makeDatabase(rows: Array<Record<string, unknown>>, first?: Record<string, unknown>) {
  const prepare = vi.fn(() => {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: rows } satisfies FakeResults<unknown>),
      first: vi.fn().mockResolvedValue(first ?? null),
      run: vi.fn(),
    }
    return stmt
  })
  return { prepare }
}

describe('createQueryLogDebugStore.getDebugQueryLogById', () => {
  it('returns null when row not found', async () => {
    const db = makeDatabase([], undefined)
    const store = createQueryLogDebugStore(db)
    const result = await store.getDebugQueryLogById('missing')
    expect(result).toBeNull()
  })

  it('passes through null debug fields unchanged (does not fabricate)', async () => {
    const db = makeDatabase([], {
      id: 'log-legacy',
      channel: 'web',
      status: 'accepted',
      environment: 'local',
      query_redacted_text: 'redacted',
      risk_flags_json: '[]',
      allowed_access_levels_json: '["internal"]',
      redaction_applied: 0,
      config_snapshot_version: 'v1',
      created_at: '2026-04-19T00:00:00.000Z',
      first_token_latency_ms: null,
      completion_latency_ms: null,
      retrieval_score: null,
      judge_score: null,
      decision_path: null,
      refusal_reason: null,
    })
    const store = createQueryLogDebugStore(db)
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
    const db = makeDatabase([], {
      id: 'log-1',
      channel: 'mcp',
      status: 'accepted',
      environment: 'staging',
      query_redacted_text: '<<redacted>>',
      risk_flags_json: '["pii"]',
      allowed_access_levels_json: '["internal","confidential"]',
      redaction_applied: 1,
      config_snapshot_version: 'v1',
      created_at: '2026-04-19T00:00:00.000Z',
      first_token_latency_ms: 120,
      completion_latency_ms: 1450,
      retrieval_score: 0.82,
      judge_score: 0.91,
      decision_path: 'judge_pass',
      refusal_reason: null,
    })
    const store = createQueryLogDebugStore(db)
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
  it('classifies outcomes by decision_path and status', async () => {
    const rows = [
      // web: answered x2, refused x1, error x1
      {
        channel: 'web',
        status: 'accepted',
        decision_path: 'direct_answer',
        first_token_latency_ms: 100,
        completion_latency_ms: 1000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decision_path: 'judge_pass',
        first_token_latency_ms: 200,
        completion_latency_ms: 2000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decision_path: 'no_citation_refuse',
        first_token_latency_ms: null,
        completion_latency_ms: null,
      },
      {
        channel: 'web',
        status: 'accepted',
        decision_path: 'pipeline_error',
        first_token_latency_ms: null,
        completion_latency_ms: null,
      },
      // mcp: forbidden x1 (blocked), answered x1
      {
        channel: 'mcp',
        status: 'blocked',
        decision_path: 'restricted_blocked',
        first_token_latency_ms: null,
        completion_latency_ms: null,
      },
      {
        channel: 'mcp',
        status: 'accepted',
        decision_path: 'direct_answer',
        first_token_latency_ms: 50,
        completion_latency_ms: 500,
      },
    ]

    const db = makeDatabase(rows)
    const store = createQueryLogDebugStore(db)
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
        decision_path: 'restricted_blocked',
        first_token_latency_ms: null,
        completion_latency_ms: null,
      },
    ]
    const db = makeDatabase(rows)
    const store = createQueryLogDebugStore(db)
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
        decision_path: 'direct_answer',
        first_token_latency_ms: 100,
        completion_latency_ms: 1000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decision_path: 'direct_answer',
        first_token_latency_ms: 200,
        completion_latency_ms: 2000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decision_path: 'direct_answer',
        first_token_latency_ms: 300,
        completion_latency_ms: 3000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decision_path: 'direct_answer',
        first_token_latency_ms: 400,
        completion_latency_ms: 4000,
      },
    ]
    const db = makeDatabase(rows)
    const store = createQueryLogDebugStore(db)
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
        decision_path: 'direct_answer',
        first_token_latency_ms: 100,
        completion_latency_ms: 1000,
      },
      {
        channel: 'mcp',
        status: 'accepted',
        decision_path: 'direct_answer',
        first_token_latency_ms: 100,
        completion_latency_ms: 1000,
      },
      {
        channel: 'web',
        status: 'accepted',
        decision_path: 'direct_answer',
        first_token_latency_ms: 100,
        completion_latency_ms: 1000,
      },
    ]
    const db = makeDatabase(rows)
    const store = createQueryLogDebugStore(db)
    const summary = await store.summarizeLatency({ days: 7 })
    expect(summary.channels.map((c) => c.channel)).toEqual(['web', 'mcp', 'slack'])
  })
})
