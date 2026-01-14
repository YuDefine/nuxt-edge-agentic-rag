import { describe, expect, it, vi } from 'vitest'

import {
  ChatRateLimitExceededError,
  chatWithKnowledge,
  createChatKvRateLimitStore,
} from '../../server/utils/web-chat'

describe('web chat', () => {
  it('consumes a per-user chat rate limit and reuses the knowledge answering core', async () => {
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
})
