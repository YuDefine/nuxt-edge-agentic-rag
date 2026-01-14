import { describe, expect, it, vi } from 'vitest'

import { askKnowledge } from '../../server/utils/mcp-ask'

describe('mcp ask', () => {
  it('returns a business refusal result instead of translating it into an auth error', async () => {
    const result = await askKnowledge(
      {
        auth: {
          scopes: ['knowledge.ask'],
          tokenId: 'token-1',
        },
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
