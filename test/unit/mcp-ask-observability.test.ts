import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { askKnowledge } from '#server/utils/mcp-ask'

/**
 * observability-and-debug §1.2 — mcp-ask pipeline MUST write debug-safe
 * derived fields to the query_logs row it created (whether through the
 * auditStore or the fallback queryLogStore). See web-chat-observability test
 * for the matching contract on the /api/chat path.
 */

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

describe('askKnowledge — §1.2 debug-safe derived fields', () => {
  it('happy path → writes decision_path=direct_answer + retrievalScore via auditStore.updateQueryLog', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-1'),
      createQueryLog: vi.fn().mockResolvedValue('mcp-ql-happy'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    const result = await askKnowledge(
      {
        auth: { scopes: ['knowledge.ask', 'knowledge.restricted.read'], tokenId: 'tok-1' },
        environment: 'local',
        governance,
        query: 'Summarize the launch plan.',
      },
      {
        answer: vi.fn().mockResolvedValue('Launch is planned for next Tuesday.'),
        auditStore,
        citationStore: {
          persistCitations: vi
            .fn()
            .mockResolvedValue([
              { citationId: 'c1', documentVersionId: 'ver-1', sourceChunkId: 'chunk-1' },
            ]),
        },
        judge: vi.fn(),
        queryLogStore: { createAcceptedQueryLog: vi.fn() },
        retrieve: vi.fn().mockResolvedValue({
          evidence: evidenceAt(0.9),
          normalizedQuery: 'summarize the launch plan',
        }),
      },
    )

    expect(result.refused).toBe(false)
    const updateCall = vi.mocked(auditStore.updateQueryLog).mock.calls[0]?.[0]
    expect(updateCall).toMatchObject({
      queryLogId: 'mcp-ql-happy',
      decisionPath: 'direct_answer',
      refusalReason: null,
      retrievalScore: 0.9,
      judgeScore: null,
      firstTokenLatencyMs: null,
    })
    expect(typeof updateCall?.completionLatencyMs).toBe('number')
  })

  it('audit-blocked path → writes decision_path=restricted_blocked + refusal_reason=restricted_scope directly in createQueryLog', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'production' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-blocked'),
      createQueryLog: vi.fn().mockResolvedValue('mcp-ql-blocked'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    await askKnowledge(
      {
        auth: { scopes: ['knowledge.ask'], tokenId: 'tok-block' },
        environment: 'production',
        governance,
        query: 'password=hunter2',
      },
      {
        answer: vi.fn(),
        auditStore,
        citationStore: { persistCitations: vi.fn() },
        judge: vi.fn(),
        queryLogStore: { createAcceptedQueryLog: vi.fn() },
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
    expect(auditStore.updateQueryLog).not.toHaveBeenCalled()
  })

  it('pipeline error → writes decision_path=pipeline_error via updateQueryLog then re-throws', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-err'),
      createQueryLog: vi.fn().mockResolvedValue('mcp-ql-err'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }
    const boom = new Error('retrieval fail')

    await expect(
      askKnowledge(
        {
          auth: { scopes: ['knowledge.ask'], tokenId: 'tok-err' },
          environment: 'local',
          governance,
          query: 'Anything.',
        },
        {
          answer: vi.fn(),
          auditStore,
          citationStore: { persistCitations: vi.fn() },
          judge: vi.fn(),
          queryLogStore: { createAcceptedQueryLog: vi.fn() },
          retrieve: vi.fn().mockRejectedValue(boom),
        },
      ),
    ).rejects.toThrow(boom)

    expect(auditStore.updateQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionPath: 'pipeline_error',
        refusalReason: 'pipeline_error',
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
        retrievalScore: null,
        judgeScore: null,
      }),
    )
  })

  it('no-citation refusal → writes decision_path=no_citation_refuse + refusal_reason=no_citation via updateQueryLog', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-refuse'),
      createQueryLog: vi.fn().mockResolvedValue('mcp-ql-refuse'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    const result = await askKnowledge(
      {
        auth: { scopes: ['knowledge.ask'], tokenId: 'tok-refuse' },
        environment: 'local',
        governance,
        query: 'Empty corpus query',
      },
      {
        answer: vi.fn(),
        auditStore,
        citationStore: { persistCitations: vi.fn() },
        judge: vi.fn(),
        queryLogStore: { createAcceptedQueryLog: vi.fn() },
        retrieve: vi
          .fn()
          .mockResolvedValue({ evidence: [], normalizedQuery: 'empty corpus query' }),
      },
    )

    expect(result.refused).toBe(true)
    expect(auditStore.updateQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionPath: 'no_citation_refuse',
        refusalReason: 'no_citation',
        retrievalScore: 0,
      }),
    )
  })

  it('backward compat — auditStore without updateQueryLog works silently', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-compat'),
      createQueryLog: vi.fn().mockResolvedValue('mcp-ql-compat'),
    }

    const result = await askKnowledge(
      {
        auth: { scopes: ['knowledge.ask'], tokenId: 'tok-compat' },
        environment: 'local',
        governance,
        query: 'Question.',
      },
      {
        answer: vi.fn().mockResolvedValue('Answer.'),
        auditStore,
        citationStore: {
          persistCitations: vi
            .fn()
            .mockResolvedValue([
              { citationId: 'c1', documentVersionId: 'ver-1', sourceChunkId: 'chunk-1' },
            ]),
        },
        judge: vi.fn(),
        queryLogStore: { createAcceptedQueryLog: vi.fn() },
        retrieve: vi.fn().mockResolvedValue({
          evidence: evidenceAt(0.88),
          normalizedQuery: 'question',
        }),
      },
    )

    expect(result.refused).toBe(false)
    // Must not crash even when updateQueryLog is absent.
  })
})
