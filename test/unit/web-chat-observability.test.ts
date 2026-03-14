import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { chatWithKnowledge, createChatKvRateLimitStore } from '#server/utils/web-chat'

/**
 * observability-and-debug §1.2 — web-chat pipeline MUST write debug-safe
 * derived fields to the `query_logs` row it created, so the debug surface
 * can read `decision_path / retrieval_score / completion_latency_ms / ...`
 * without replaying the retrieval / judge / self-correction pipeline.
 *
 * The pipeline surfaces derived values via `auditStore.updateQueryLog` after
 * pipeline completion (happy + refusal + error paths). Existing callers that
 * don't define `updateQueryLog` are unaffected (backward compat).
 */

function kvStore() {
  return createChatKvRateLimitStore({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  })
}

function evidenceAt(score: number) {
  return [
    {
      accessLevel: 'internal',
      categorySlug: 'policies',
      chunkText: 'Policy text excerpt.',
      citationLocator: 'lines 1-2',
      documentId: 'doc-1',
      documentTitle: 'Policy',
      documentVersionId: 'ver-1',
      excerpt: 'Policy text excerpt.',
      score,
      sourceChunkId: 'chunk-1',
      title: 'Policy',
    },
  ]
}

describe('chatWithKnowledge — §1.2 debug-safe derived fields', () => {
  it('happy path → writes retrievalScore + decision_path=direct_answer + completion_latency_ms (null first-token) via updateQueryLog', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-1'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-happy'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    const result = await chatWithKnowledge(
      {
        auth: { isAdmin: false, userId: 'user-happy' },
        governance,
        environment: 'local',
        query: 'How does payroll exception work?',
      },
      {
        answer: vi.fn().mockResolvedValue('Payroll exceptions go through manager approval.'),
        auditStore,
        judge: vi.fn(),
        rateLimitStore: kvStore(),
        retrieve: vi.fn().mockResolvedValue({
          evidence: evidenceAt(0.92),
          normalizedQuery: 'how does payroll exception work',
        }),
      },
    )

    expect(result.refused).toBe(false)
    expect(auditStore.updateQueryLog).toHaveBeenCalledTimes(1)

    const updateCall = vi.mocked(auditStore.updateQueryLog).mock.calls[0]?.[0]
    expect(updateCall).toMatchObject({
      queryLogId: 'query-log-happy',
      decisionPath: 'direct_answer',
      refusalReason: null,
      retrievalScore: 0.92,
      judgeScore: null,
      firstTokenLatencyMs: null,
    })
    expect(typeof updateCall?.completionLatencyMs).toBe('number')
    expect(updateCall!.completionLatencyMs).toBeGreaterThanOrEqual(0)
  })

  it('audit-blocked path → writes decision_path=restricted_blocked + refusal_reason=restricted_scope directly into createQueryLog (no updateQueryLog)', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-block'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-blocked'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    await chatWithKnowledge(
      {
        auth: { isAdmin: false, userId: 'user-block' },
        governance,
        environment: 'local',
        query: 'api_key=super-secret',
      },
      {
        answer: vi.fn(),
        auditStore,
        judge: vi.fn(),
        rateLimitStore: kvStore(),
        retrieve: vi.fn(),
      },
    )

    expect(auditStore.createQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'blocked',
        decisionPath: 'restricted_blocked',
        refusalReason: 'restricted_scope',
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
        retrievalScore: null,
        judgeScore: null,
      }),
    )
    // Blocked path writes derived fields in the initial INSERT so it does not
    // need updateQueryLog.
    expect(auditStore.updateQueryLog).not.toHaveBeenCalled()
  })

  it('no-citation refusal (low retrieval score) → writes decision_path=no_citation_refuse + refusal_reason=no_citation via updateQueryLog', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-refuse'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-refuse'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    const result = await chatWithKnowledge(
      {
        auth: { isAdmin: false, userId: 'user-refuse' },
        governance,
        environment: 'local',
        query: 'Tell me something outside the corpus.',
      },
      {
        answer: vi.fn(),
        auditStore,
        judge: vi.fn(),
        rateLimitStore: kvStore(),
        retrieve: vi.fn().mockResolvedValue({
          evidence: evidenceAt(0.1),
          normalizedQuery: 'tell me something outside the corpus',
        }),
      },
    )

    expect(result.refused).toBe(true)
    expect(auditStore.updateQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        queryLogId: 'query-log-refuse',
        decisionPath: 'no_citation_refuse',
        refusalReason: 'no_citation',
        retrievalScore: 0.1,
        judgeScore: null,
        firstTokenLatencyMs: null,
      }),
    )
  })

  it('pipeline error → writes decision_path=pipeline_error + refusal_reason=pipeline_error + null latency via updateQueryLog, then re-throws', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-error'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-error'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }
    const pipelineFailure = new Error('retrieval backend down')

    await expect(
      chatWithKnowledge(
        {
          auth: { isAdmin: false, userId: 'user-error' },
          governance,
          environment: 'local',
          query: 'Anything.',
        },
        {
          answer: vi.fn(),
          auditStore,
          judge: vi.fn(),
          rateLimitStore: kvStore(),
          retrieve: vi.fn().mockRejectedValue(pipelineFailure),
        },
      ),
    ).rejects.toThrow(pipelineFailure)

    expect(auditStore.updateQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        queryLogId: 'query-log-error',
        decisionPath: 'pipeline_error',
        refusalReason: 'pipeline_error',
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
        retrievalScore: null,
        judgeScore: null,
      }),
    )
  })

  it('judge_pass_refuse path → writes judge score + decision_path=judge_pass_refuse + refusal_reason=low_confidence', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-judge-refuse'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-judge'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }
    // Score above judgeMin (0.45) but below directAnswerMin (0.7) — forces
    // judge invocation. Judge returns shouldAnswer=false without reformulation
    // → judge_pass_refuse with refusal_reason=low_confidence.
    const judge = vi.fn().mockResolvedValue({ shouldAnswer: false })

    const result = await chatWithKnowledge(
      {
        auth: { isAdmin: false, userId: 'user-judge' },
        governance,
        environment: 'local',
        query: 'Mid-confidence query.',
      },
      {
        answer: vi.fn(),
        auditStore,
        judge,
        rateLimitStore: kvStore(),
        retrieve: vi.fn().mockResolvedValue({
          evidence: evidenceAt(0.5),
          normalizedQuery: 'mid-confidence query',
        }),
      },
    )

    expect(result.refused).toBe(true)
    expect(judge).toHaveBeenCalled()
    expect(auditStore.updateQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionPath: 'judge_pass_refuse',
        refusalReason: 'low_confidence',
        retrievalScore: 0.5,
      }),
    )
  })

  it('backward compat — auditStore without updateQueryLog works silently (existing callers unchanged)', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-compat'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-compat'),
      // No updateQueryLog method.
    }

    const result = await chatWithKnowledge(
      {
        auth: { isAdmin: false, userId: 'user-compat' },
        governance,
        environment: 'local',
        query: 'Anything.',
      },
      {
        answer: vi.fn().mockResolvedValue('ok'),
        auditStore,
        judge: vi.fn(),
        rateLimitStore: kvStore(),
        retrieve: vi.fn().mockResolvedValue({
          evidence: evidenceAt(0.9),
          normalizedQuery: 'anything',
        }),
      },
    )

    expect(result.refused).toBe(false)
    // Must not crash when updateQueryLog is absent — happy path still completes.
  })
})
