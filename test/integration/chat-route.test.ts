import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const chatRouteMocks = vi.hoisted(() => {
  class MockChatRateLimitExceededError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
      readonly retryAfterMs: number
    ) {
      super(message)
      this.name = 'ChatRateLimitExceededError'
    }
  }

  return {
    MockChatRateLimitExceededError,
    chatWithKnowledge: vi.fn(),
    createChatKvRateLimitStore: vi.fn().mockReturnValue({}),
    createCloudflareAiSearchClient: vi.fn().mockReturnValue({ search: vi.fn() }),
    createKnowledgeAuditStore: vi.fn().mockReturnValue({}),
    createKnowledgeEvidenceStore: vi.fn().mockReturnValue({}),
    getKnowledgeRuntimeConfig: vi.fn().mockReturnValue({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        rateLimitKv: 'RATE_LIMITS',
      },
      environment: 'staging',
    }),
    getRequiredD1Binding: vi.fn().mockReturnValue({}),
    getRequiredKvBinding: vi.fn().mockReturnValue({ get: vi.fn(), put: vi.fn() }),
    getRuntimeAdminAccess: vi.fn().mockReturnValue(false),
    readValidatedBody: vi.fn(),
    requireUserSession: vi.fn(),
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/ai-search', () => ({
  createCloudflareAiSearchClient: chatRouteMocks.createCloudflareAiSearchClient,
}))

vi.mock('../../server/utils/cloudflare-bindings', () => ({
  getCloudflareEnv: () => ({
    AI: {
      autorag: vi.fn().mockReturnValue({ search: vi.fn() }),
    },
  }),
  getRequiredD1Binding: chatRouteMocks.getRequiredD1Binding,
  getRequiredKvBinding: chatRouteMocks.getRequiredKvBinding,
}))

vi.mock('../../server/utils/knowledge-audit', () => ({
  createKnowledgeAuditStore: chatRouteMocks.createKnowledgeAuditStore,
}))

vi.mock('../../server/utils/knowledge-evidence-store', () => ({
  createKnowledgeEvidenceStore: chatRouteMocks.createKnowledgeEvidenceStore,
}))

vi.mock('../../server/utils/knowledge-retrieval', () => ({
  retrieveVerifiedEvidence: vi.fn(),
}))

vi.mock('../../server/utils/knowledge-runtime', () => ({
  getKnowledgeRuntimeConfig: chatRouteMocks.getKnowledgeRuntimeConfig,
  getRuntimeAdminAccess: chatRouteMocks.getRuntimeAdminAccess,
}))

vi.mock('../../server/utils/web-chat', () => ({
  ChatRateLimitExceededError: chatRouteMocks.MockChatRateLimitExceededError,
  chatWithKnowledge: chatRouteMocks.chatWithKnowledge,
  createChatKvRateLimitStore: chatRouteMocks.createChatKvRateLimitStore,
}))

installNuxtRouteTestGlobals()

describe('/api/chat route', () => {
  beforeEach(() => {
    vi.stubGlobal('readValidatedBody', chatRouteMocks.readValidatedBody)
    vi.stubGlobal('requireUserSession', chatRouteMocks.requireUserSession)

    chatRouteMocks.readValidatedBody.mockResolvedValue({ query: 'What changed?' })
    chatRouteMocks.requireUserSession.mockResolvedValue({
      user: {
        email: 'user@example.com',
        id: 'user-1',
      },
    })
  })

  it('returns unified data on success', async () => {
    chatRouteMocks.chatWithKnowledge.mockResolvedValue({
      answer: 'Launch moved to Tuesday.',
      citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
      refused: false,
      retrievalScore: 0.92,
    })

    const { default: handler } = await import('../../server/api/chat.post')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({
      data: {
        answer: 'Launch moved to Tuesday.',
        citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
        refused: false,
      },
    })
  })

  it('maps chat rate limits to 429', async () => {
    chatRouteMocks.chatWithKnowledge.mockRejectedValue(
      new chatRouteMocks.MockChatRateLimitExceededError(
        'Rate limit exceeded for /api/chat',
        429,
        240_000
      )
    )

    const { default: handler } = await import('../../server/api/chat.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      message: 'Rate limit exceeded for /api/chat',
      statusCode: 429,
    })
  })
})
