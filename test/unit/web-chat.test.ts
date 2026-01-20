import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '../../shared/schemas/knowledge-runtime'
import {
  ChatRateLimitExceededError,
  chatWithKnowledge,
  createChatKvRateLimitStore,
} from '../../server/utils/web-chat'

describe('web chat', () => {
  it('consumes a per-user chat rate limit and reuses the knowledge answering core', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'staging',
    }).governance
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ count: 1, windowStart: 0 })),
      put: vi.fn().mockResolvedValue(undefined),
    }

    const result = await chatWithKnowledge(
      {
        auth: {
          isAdmin: true,
          userId: 'user-1',
        },
        governance,
        environment: 'staging',
        now: 60_000,
        query: 'Summarize the restricted launch plan.',
      },
      {
        answer: vi.fn().mockResolvedValue('Launch is planned for next Tuesday.'),
        judge: vi.fn(),
        rateLimitStore: createChatKvRateLimitStore(kv),
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

    expect(kv.get).toHaveBeenCalledWith('web:staging:chat:user-1')
    expect(kv.put).toHaveBeenCalledWith(
      'web:staging:chat:user-1',
      JSON.stringify({ count: 2, windowStart: 0 }),
      { expirationTtl: 300 }
    )
    expect(result).toEqual({
      answer: 'Launch is planned for next Tuesday.',
      citations: [],
      refused: false,
      retrievalScore: 0.92,
    })
  })

  it('returns 429 before retrieval when the user exceeds the active chat window', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ count: 30, windowStart: 0 })),
      put: vi.fn(),
    }
    const retrieve = vi.fn()

    await expect(
      chatWithKnowledge(
        {
          auth: {
            isAdmin: false,
            userId: 'user-2',
          },
          governance,
          environment: 'local',
          now: 60_000,
          query: 'What changed in revenue guidance?',
        },
        {
          answer: vi.fn(),
          judge: vi.fn(),
          rateLimitStore: createChatKvRateLimitStore(kv),
          retrieve,
        }
      )
    ).rejects.toThrowError(
      new ChatRateLimitExceededError('Rate limit exceeded for /api/chat', 429, 240000)
    )

    expect(retrieve).not.toHaveBeenCalled()
  })

  it('blocks credential-bearing chat input before retrieval and persists only redacted audit metadata', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const retrieve = vi.fn()
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('message-2'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-blocked'),
    }

    const result = await chatWithKnowledge(
      {
        auth: {
          isAdmin: false,
          userId: 'user-3',
        },
        governance,
        environment: 'local',
        now: 60_000,
        query: 'password=hunter2',
      },
      {
        answer: vi.fn(),
        auditStore,
        judge: vi.fn(),
        rateLimitStore: createChatKvRateLimitStore({
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn().mockResolvedValue(undefined),
        }),
        retrieve,
      }
    )

    expect(auditStore.createQueryLog).toHaveBeenCalledWith({
      allowedAccessLevels: ['internal'],
      channel: 'web',
      configSnapshotVersion: expect.any(String),
      environment: 'local',
      queryText: 'password=hunter2',
      status: 'blocked',
      userProfileId: 'user-3',
    })
    expect(auditStore.createMessage).toHaveBeenCalledWith({
      channel: 'web',
      content: 'password=hunter2',
      queryLogId: 'query-log-blocked',
      role: 'user',
      userProfileId: 'user-3',
    })
    expect(retrieve).not.toHaveBeenCalled()
    expect(result).toEqual({
      answer: null,
      citations: [],
      refused: true,
      retrievalScore: 0,
    })
  })

  it('stamps accepted web query logs with the shared config snapshot version', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'staging',
    }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('message-9'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-accepted'),
    }

    await chatWithKnowledge(
      {
        auth: {
          isAdmin: false,
          userId: 'user-9',
        },
        governance,
        environment: 'staging',
        query: 'What changed in revenue guidance?',
      },
      {
        answer: vi.fn().mockResolvedValue('Revenue guidance was updated.'),
        auditStore,
        judge: vi.fn(),
        rateLimitStore: createChatKvRateLimitStore({
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn().mockResolvedValue(undefined),
        }),
        retrieve: vi.fn().mockResolvedValue({
          evidence: [
            {
              accessLevel: 'internal',
              categorySlug: 'finance',
              chunkText: 'Revenue guidance was updated.',
              citationLocator: 'lines 2-4',
              documentId: 'doc-2',
              documentTitle: 'Quarterly Report',
              documentVersionId: 'ver-2',
              excerpt: 'Revenue guidance was updated.',
              score: 0.91,
              sourceChunkId: 'chunk-2',
              title: 'Quarterly Report',
            },
          ],
          normalizedQuery: 'what changed in revenue guidance',
        }),
      }
    )

    expect(auditStore.createQueryLog).toHaveBeenCalledWith({
      allowedAccessLevels: ['internal'],
      channel: 'web',
      configSnapshotVersion: governance.configSnapshotVersion,
      environment: 'staging',
      now: undefined,
      queryText: 'What changed in revenue guidance?',
      status: 'accepted',
      userProfileId: 'user-9',
    })
  })

  it('persists citations against the accepted web query log when evidence is answered directly', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'staging',
    }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('message-10'),
      createQueryLog: vi.fn().mockResolvedValue('query-log-10'),
    }
    const persistCitations = vi.fn().mockResolvedValue([
      {
        citationId: 'citation-10',
        sourceChunkId: 'chunk-10',
      },
    ])

    const result = await chatWithKnowledge(
      {
        auth: {
          isAdmin: false,
          userId: 'user-10',
        },
        governance,
        environment: 'staging',
        now: 60_000,
        query: 'PO 和 PR 有什麼差別？',
      },
      {
        answer: vi.fn().mockResolvedValue('PO 是採購訂單，PR 是請購需求。'),
        auditStore,
        judge: vi.fn(),
        persistCitations,
        rateLimitStore: createChatKvRateLimitStore({
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn().mockResolvedValue(undefined),
        }),
        retrieve: vi.fn().mockResolvedValue({
          evidence: [
            {
              accessLevel: 'internal',
              categorySlug: 'procurement',
              chunkText: 'PO 是採購訂單，PR 是請購需求。',
              citationLocator: 'lines 3-5',
              documentId: 'doc-10',
              documentTitle: '採購流程',
              documentVersionId: 'ver-10',
              excerpt: 'PO 是採購訂單，PR 是請購需求。',
              score: 0.9,
              sourceChunkId: 'chunk-10',
              title: '採購流程',
            },
          ],
          normalizedQuery: 'po 和 pr 有什麼差別',
        }),
      }
    )

    expect(persistCitations).toHaveBeenCalledWith({
      citations: [
        {
          chunkTextSnapshot: 'PO 是採購訂單，PR 是請購需求。',
          citationLocator: 'lines 3-5',
          documentVersionId: 'ver-10',
          queryLogId: 'query-log-10',
          sourceChunkId: 'chunk-10',
        },
      ],
      now: new Date(60_000),
    })
    expect(result).toEqual({
      answer: 'PO 是採購訂單，PR 是請購需求。',
      citations: [
        {
          citationId: 'citation-10',
          sourceChunkId: 'chunk-10',
        },
      ],
      refused: false,
      retrievalScore: 0.9,
    })
  })
})
