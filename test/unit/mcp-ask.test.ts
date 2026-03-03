import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { askKnowledge, createMcpQueryLogStore } from '#server/utils/mcp-ask'

describe('mcp ask', () => {
  it('returns a business refusal result instead of translating it into an auth error', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const result = await askKnowledge(
      {
        auth: {
          scopes: ['knowledge.ask'],
          tokenId: 'token-1',
        },
        governance,
        query: 'What is the payroll exception policy?',
      },
      {
        answer: vi.fn(),
        citationStore: {
          persistCitations: vi.fn(),
        },
        judge: vi.fn(),
        queryLogStore: {
          createAcceptedQueryLog: vi.fn().mockResolvedValue('query-log-1'),
        },
        retrieve: vi.fn().mockResolvedValue({
          evidence: [],
          normalizedQuery: 'what is the payroll exception policy?',
        }),
      }
    )

    expect(result).toEqual({
      citations: [],
      refused: true,
    })
  })

  it('blocks credential-bearing queries before retrieval and writes only redacted audit records', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'production',
    }).governance
    const retrieve = vi.fn()
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('message-1'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-blocked'),
    }

    const result = await askKnowledge(
      {
        auth: {
          scopes: ['knowledge.ask'],
          tokenId: 'token-3',
        },
        environment: 'production',
        governance,
        query: 'api_key=super-secret-value',
      },
      {
        answer: vi.fn(),
        auditStore,
        citationStore: {
          persistCitations: vi.fn(),
        },
        judge: vi.fn(),
        queryLogStore: {
          createAcceptedQueryLog: vi.fn(),
        },
        retrieve,
      }
    )

    expect(auditStore.createQueryLog).toHaveBeenCalledWith({
      allowedAccessLevels: ['internal'],
      channel: 'mcp',
      configSnapshotVersion: governance.configSnapshotVersion,
      environment: 'production',
      mcpTokenId: 'token-3',
      queryText: 'api_key=super-secret-value',
      status: 'blocked',
      userProfileId: null,
    })
    expect(auditStore.createMessage).toHaveBeenCalledWith({
      channel: 'mcp',
      content: 'api_key=super-secret-value',
      queryLogId: 'query-log-blocked',
      role: 'user',
      userProfileId: null,
    })
    expect(retrieve).not.toHaveBeenCalled()
    expect(result).toEqual({
      citations: [],
      refused: true,
    })
  })

  it('reuses the knowledge answering core and persists citations against the created query log', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const queryLogStore = {
      createAcceptedQueryLog: vi.fn().mockResolvedValue('query-log-7'),
    }
    const citationStore = {
      persistCitations: vi.fn().mockResolvedValue([
        {
          citationId: 'citation-1',
          sourceChunkId: 'chunk-1',
        },
      ]),
    }

    const result = await askKnowledge(
      {
        auth: {
          scopes: ['knowledge.ask', 'knowledge.restricted.read'],
          tokenId: 'token-2',
        },
        governance,
        query: 'Summarize the restricted launch plan.',
      },
      {
        answer: vi.fn().mockResolvedValue('Launch is planned for next Tuesday.'),
        citationStore,
        judge: vi.fn(),
        queryLogStore,
        retrieve: vi.fn().mockResolvedValue({
          evidence: [
            {
              accessLevel: 'restricted',
              categorySlug: 'launch',
              chunkText: 'Launch is planned for next Tuesday.',
              citationLocator: 'lines 8-10',
              documentId: 'doc-9',
              documentTitle: 'Launch Plan',
              documentVersionId: 'ver-9',
              excerpt: 'Launch is planned for next Tuesday.',
              score: 0.92,
              sourceChunkId: 'chunk-1',
              title: 'Launch Plan',
            },
          ],
          normalizedQuery: 'summarize the restricted launch plan',
        }),
      }
    )

    expect(queryLogStore.createAcceptedQueryLog).toHaveBeenCalledWith({
      allowedAccessLevels: ['internal', 'restricted'],
      configSnapshotVersion: governance.configSnapshotVersion,
      environment: 'local',
      queryText: 'Summarize the restricted launch plan.',
      status: 'accepted',
      tokenId: 'token-2',
    })
    expect(citationStore.persistCitations).toHaveBeenCalledWith({
      citations: [
        {
          chunkTextSnapshot: 'Launch is planned for next Tuesday.',
          citationLocator: 'lines 8-10',
          documentVersionId: 'ver-9',
          queryLogId: 'query-log-7',
          sourceChunkId: 'chunk-1',
        },
      ],
    })
    expect(result).toEqual({
      answer: 'Launch is planned for next Tuesday.',
      citations: [
        {
          citationId: 'citation-1',
          sourceChunkId: 'chunk-1',
        },
      ],
      refused: false,
    })
  })
})

describe('createMcpQueryLogStore (observability-and-debug §0.1 / §0.3)', () => {
  it('binds NULL for every debug field when caller supplies none (backward compatibility)', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const database = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({ run }),
      }),
    }
    const store = createMcpQueryLogStore(database)

    await store.createAcceptedQueryLog({
      allowedAccessLevels: ['internal'],
      configSnapshotVersion: 'v1',
      environment: 'staging',
      queryText: 'hello',
      status: 'accepted',
      tokenId: 'token-x',
    })

    const prepareCall = vi.mocked(database.prepare).mock.calls[0]?.[0] ?? ''
    const bind = vi.mocked(database.prepare).mock.results[0]?.value.bind as ReturnType<typeof vi.fn>

    // tasks.md §0 schema prerequisites: INSERT must include the six debug columns.
    expect(prepareCall).toContain('first_token_latency_ms')
    expect(prepareCall).toContain('completion_latency_ms')
    expect(prepareCall).toContain('retrieval_score')
    expect(prepareCall).toContain('judge_score')
    expect(prepareCall).toContain('decision_path')
    expect(prepareCall).toContain('refusal_reason')

    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      'mcp',
      null,
      'token-x',
      'staging',
      'hello',
      '[]',
      '["internal"]',
      0,
      'v1',
      'accepted',
      expect.any(String),
      null,
      null,
      null,
      null,
      null,
      null
    )
  })

  it('persists supplied debug fields verbatim (no fabrication)', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const database = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({ run }),
      }),
    }
    const store = createMcpQueryLogStore(database)

    await store.createAcceptedQueryLog({
      allowedAccessLevels: ['internal'],
      configSnapshotVersion: 'v1',
      environment: 'staging',
      queryText: 'hello',
      status: 'accepted',
      tokenId: 'token-x',
      firstTokenLatencyMs: 250,
      completionLatencyMs: 1_800,
      retrievalScore: 0.91,
      judgeScore: 0.66,
      decisionPath: 'direct_answer',
      refusalReason: null,
    })

    const bind = vi.mocked(database.prepare).mock.results[0]?.value.bind as ReturnType<typeof vi.fn>

    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      'mcp',
      null,
      'token-x',
      'staging',
      'hello',
      '[]',
      '["internal"]',
      0,
      'v1',
      'accepted',
      expect.any(String),
      250,
      1_800,
      0.91,
      0.66,
      'direct_answer',
      null
    )
  })
})
