import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const chatRouteMocks = vi.hoisted(() => {
  class MockChatRateLimitExceededError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
      readonly retryAfterMs: number,
    ) {
      super(message)
      this.name = 'ChatRateLimitExceededError'
    }
  }

  return {
    MockChatRateLimitExceededError,
    // The chat handler derives the auto-create conversation title from the
    // redacted copy of the query (governance §1.4 no-leak) via
    // `auditKnowledgeText`. Tests that don't set their own prompt content
    // get a safe placeholder with no redaction applied.
    auditKnowledgeText: vi.fn((text: string) => ({
      redactedText: text,
      redactionApplied: false,
      riskFlags: [],
      shouldBlock: false,
    })),
    chatWithKnowledge: vi.fn(),
    createCitationStore: vi.fn().mockReturnValue({
      persistCitations: vi.fn().mockResolvedValue([]),
    }),
    createChatKvRateLimitStore: vi.fn().mockReturnValue({}),
    createCloudflareAiSearchClient: vi.fn().mockReturnValue({ search: vi.fn() }),
    createConversationStaleResolver: vi.fn().mockReturnValue({
      resolveStaleness: vi.fn(),
    }),
    createConversationStore: vi.fn(),
    createKnowledgeAuditStore: vi.fn().mockReturnValue({}),
    createKnowledgeEvidenceStore: vi.fn().mockReturnValue({}),
    getKnowledgeRuntimeConfig: vi.fn(),
    getRequiredD1Binding: vi.fn().mockReturnValue({}),
    getRequiredKvBinding: vi.fn().mockReturnValue({ get: vi.fn(), put: vi.fn() }),
    getRuntimeAdminAccess: vi.fn().mockReturnValue(false),
    readValidatedBody: vi.fn(),
    requireRole: vi.fn(),
    requireUserSession: vi.fn(),
    workersAiRun: vi.fn().mockResolvedValue({ response: 'ok' }),
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

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/cloudflare-bindings', () => ({
  getCloudflareEnv: () => ({
    AI: {
      autorag: vi.fn().mockReturnValue({ search: vi.fn() }),
      run: chatRouteMocks.workersAiRun,
    },
  }),
  getRequiredD1Binding: chatRouteMocks.getRequiredD1Binding,
  getRequiredKvBinding: chatRouteMocks.getRequiredKvBinding,
}))

vi.mock('../../server/utils/citation-store', () => ({
  createCitationStore: chatRouteMocks.createCitationStore,
}))

vi.mock('../../server/utils/conversation-stale-resolver', () => ({
  createConversationStaleResolver: chatRouteMocks.createConversationStaleResolver,
}))

vi.mock('../../server/utils/conversation-store', () => ({
  createConversationStore: chatRouteMocks.createConversationStore,
}))

vi.mock('../../server/utils/knowledge-audit', () => ({
  auditKnowledgeText: chatRouteMocks.auditKnowledgeText,
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

vi.mock('../../server/utils/require-role', () => ({
  requireRole: chatRouteMocks.requireRole,
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
    chatRouteMocks.auditKnowledgeText.mockReset()
    chatRouteMocks.auditKnowledgeText.mockImplementation((text: string) => ({
      redactedText: text,
      redactionApplied: false,
      riskFlags: [],
      shouldBlock: false,
    }))
    chatRouteMocks.chatWithKnowledge.mockReset()
    chatRouteMocks.createCitationStore.mockClear()
    chatRouteMocks.createChatKvRateLimitStore.mockClear()
    chatRouteMocks.createCloudflareAiSearchClient.mockClear()
    chatRouteMocks.createConversationStaleResolver.mockClear()
    chatRouteMocks.createConversationStore.mockReset()
    chatRouteMocks.createKnowledgeAuditStore.mockClear()
    chatRouteMocks.createKnowledgeEvidenceStore.mockClear()
    chatRouteMocks.getKnowledgeRuntimeConfig.mockReset()
    chatRouteMocks.getRequiredKvBinding.mockReset()
    chatRouteMocks.requireRole.mockReset()
    chatRouteMocks.requireUserSession.mockReset()
    chatRouteMocks.workersAiRun.mockReset()
    chatRouteMocks.workersAiRun.mockResolvedValue({ response: 'ok' })

    chatRouteMocks.getKnowledgeRuntimeConfig.mockReturnValue(
      createKnowledgeRuntimeConfig({
        bindings: {
          aiSearchIndex: 'knowledge-index',
          d1Database: 'DB',
          rateLimitKv: 'RATE_LIMITS',
        },
        environment: 'local',
      }),
    )
    chatRouteMocks.readValidatedBody.mockResolvedValue({ query: 'What changed?' })
    chatRouteMocks.requireRole.mockResolvedValue({
      role: 'member',
      session: {
        user: {
          email: 'user@example.com',
          id: 'user-1',
        },
      },
      fullSession: {
        user: {
          email: 'user@example.com',
          id: 'user-1',
        },
      },
    })
    chatRouteMocks.requireUserSession.mockResolvedValue({
      user: {
        email: 'user@example.com',
        id: 'user-1',
      },
    })
    chatRouteMocks.getRequiredKvBinding.mockReturnValue({ get: vi.fn(), put: vi.fn() })
    chatRouteMocks.createConversationStore.mockReturnValue({
      createForUser: vi.fn().mockResolvedValue({
        id: 'conv-auto',
        userProfileId: 'user-1',
        accessLevel: 'internal',
        title: 'What changed?',
        createdAt: '2026-04-18T09:00:00.000Z',
        updatedAt: '2026-04-18T09:00:00.000Z',
      }),
      isVisibleForUser: vi.fn().mockResolvedValue(true),
      listForUser: vi.fn(),
      getForUser: vi.fn(),
      softDeleteForUser: vi.fn(),
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
        conversationId: 'conv-auto',
        conversationCreated: true,
        refused: false,
      },
    })

    // observability-and-debug §4.2 — regression: /api/chat response must never
    // leak any of the 6 internal debug fields, even though the upstream
    // chatWithKnowledge may expose `retrievalScore` in its internal result.
    const serialized = JSON.stringify(result)
    for (const field of [
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
    ] as const) {
      expect(serialized).not.toContain(`"${field}"`)
    }
  })

  it('maps chat rate limits to 429', async () => {
    chatRouteMocks.chatWithKnowledge.mockRejectedValue(
      new chatRouteMocks.MockChatRateLimitExceededError(
        'Rate limit exceeded for /api/chat',
        429,
        240_000,
      ),
    )

    const { default: handler } = await import('../../server/api/chat.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      message: 'Rate limit exceeded for /api/chat',
      statusCode: 429,
    })
  })

  it('injects citation persistence into the web chat orchestration', async () => {
    chatRouteMocks.chatWithKnowledge.mockImplementationOnce(async (_input, options) => {
      expect(options.persistCitations).toBeTypeOf('function')

      return {
        answer: 'Launch moved to Tuesday.',
        citations: await options.persistCitations({
          citations: [
            {
              chunkTextSnapshot: 'Launch moved to Tuesday.',
              citationLocator: 'lines 1-3',
              documentVersionId: 'ver-1',
              sourceChunkId: 'chunk-1',
            },
          ],
          queryLogId: 'query-log-1',
        }),
        refused: false,
      }
    })

    const { default: handler } = await import('../../server/api/chat.post')
    const result = await handler(createRouteEvent())

    const citationStore = chatRouteMocks.createCitationStore.mock.results[0]?.value as {
      persistCitations: ReturnType<typeof vi.fn>
    }

    expect(chatRouteMocks.createCitationStore).toHaveBeenCalledTimes(1)
    expect(citationStore.persistCitations).toHaveBeenCalledWith({
      citations: [
        {
          chunkTextSnapshot: 'Launch moved to Tuesday.',
          citationLocator: 'lines 1-3',
          documentVersionId: 'ver-1',
          sourceChunkId: 'chunk-1',
        },
      ],
      queryLogId: 'query-log-1',
    })
    expect(result).toEqual({
      data: {
        answer: 'Launch moved to Tuesday.',
        citations: [],
        conversationId: 'conv-auto',
        conversationCreated: true,
        refused: false,
      },
    })
  })

  it('injects aiGateway runtime config into the search client', async () => {
    chatRouteMocks.getKnowledgeRuntimeConfig.mockReturnValueOnce(
      createKnowledgeRuntimeConfig({
        aiGateway: {
          id: 'agentic-rag-production',
          cacheEnabled: true,
        },
        bindings: {
          aiSearchIndex: 'knowledge-index',
          d1Database: 'DB',
          rateLimitKv: 'RATE_LIMITS',
        },
        environment: 'local',
      }),
    )
    chatRouteMocks.chatWithKnowledge.mockResolvedValueOnce({
      answer: 'ok',
      citations: [],
      refused: false,
    })

    const { default: handler } = await import('../../server/api/chat.post')
    await handler(createRouteEvent())

    expect(chatRouteMocks.createCloudflareAiSearchClient).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayConfig: {
          id: 'agentic-rag-production',
          cacheEnabled: true,
        },
        indexName: 'knowledge-index',
      }),
    )
  })

  it('injects workers-ai backed answer and judge adapters into the web orchestration', async () => {
    chatRouteMocks.workersAiRun
      .mockResolvedValueOnce({ response: 'ok' })
      .mockResolvedValueOnce({ response: { shouldAnswer: false } })
    chatRouteMocks.chatWithKnowledge.mockImplementationOnce(async (_input, options) => {
      const answer = await options.answer({
        evidence: [
          {
            chunkText: '採購流程需要先建立請購單，再建立採購單。',
            documentTitle: '採購流程',
          },
        ],
        modelRole: 'defaultAnswer',
        query: '採購流程是什麼？',
        retrievalScore: 0.9,
      })
      const judgment = await options.judge({
        evidence: [{ chunkText: '採購流程需要先建立請購單，再建立採購單。' }],
        query: '請比較採購與請購差異',
        retrievalScore: 0.56,
      })

      return {
        answer: `${answer}|${String(judgment.shouldAnswer)}`,
        citations: [],
        refused: false,
      }
    })

    const { default: handler } = await import('../../server/api/chat.post')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({
      data: {
        answer: 'ok|false',
        citations: [],
        conversationId: 'conv-auto',
        conversationCreated: true,
        refused: false,
      },
    })
    expect(chatRouteMocks.workersAiRun).toHaveBeenNthCalledWith(
      1,
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      expect.objectContaining({
        messages: expect.any(Array),
      }),
    )
    expect(chatRouteMocks.workersAiRun).toHaveBeenNthCalledWith(
      2,
      '@cf/moonshotai/kimi-k2.5',
      expect.objectContaining({
        response_format: expect.objectContaining({
          type: 'json_schema',
        }),
      }),
    )
  })

  it('attaches workers-ai telemetry when the wrapped audit store updates query logs', async () => {
    const auditStore = {
      createMessage: vi.fn(),
      createQueryLog: vi.fn(),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    chatRouteMocks.createKnowledgeAuditStore.mockReturnValueOnce(auditStore)
    chatRouteMocks.workersAiRun.mockResolvedValueOnce({
      response: 'Workers AI answer',
      usage: {
        completion_tokens: 18,
        prompt_tokens: 120,
        prompt_tokens_details: {
          cached_tokens: 24,
        },
        total_tokens: 138,
      },
    })
    chatRouteMocks.chatWithKnowledge.mockImplementationOnce(async (_input, options) => {
      await options.answer({
        evidence: [
          {
            chunkText: '採購流程需要先建立請購單，再建立採購單。',
            documentTitle: '採購流程',
          },
        ],
        modelRole: 'defaultAnswer',
        query: '採購流程是什麼？',
        retrievalScore: 0.9,
      })
      await options.auditStore?.updateQueryLog?.({
        completionLatencyMs: 320,
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: null,
        judgeScore: null,
        queryLogId: 'query-log-1',
        refusalReason: null,
        retrievalScore: 0.9,
      })

      return {
        answer: 'Workers AI answer',
        citations: [],
        refused: false,
      }
    })

    const { default: handler } = await import('../../server/api/chat.post')
    await handler(createRouteEvent())

    expect(auditStore.updateQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        queryLogId: 'query-log-1',
        workersAiRunsJson: expect.any(String),
      }),
    )

    const workersAiRunsJson =
      vi.mocked(auditStore.updateQueryLog).mock.calls[0]?.[0]?.workersAiRunsJson ?? '[]'

    expect(JSON.parse(workersAiRunsJson)).toEqual([
      {
        latencyMs: expect.any(Number),
        model: '@cf/meta/llama-4-scout-17b-16e-instruct',
        modelRole: 'defaultAnswer',
        usage: {
          cachedPromptTokens: 24,
          completionTokens: 18,
          promptTokens: 120,
          totalTokens: 138,
        },
      },
    ])
  })

  it('surfaces gateway 5xx to client as 500 without silently retrying', async () => {
    // Simulate Workers AI / Gateway returning a 5xx: the binding call
    // propagates the error to `chatWithKnowledge`, which re-throws.
    // Spec `ai-gateway-routing` "Gateway Routing Failures Surface To
    // Caller": handler MUST NOT swallow or retry bypassing the gateway.
    chatRouteMocks.chatWithKnowledge.mockRejectedValueOnce(
      new Error('Cloudflare AI Gateway returned 502 Bad Gateway'),
    )

    const { default: handler } = await import('../../server/api/chat.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Chat failed',
    })

    // Handler fired chatWithKnowledge exactly once — no silent retry
    // with the gateway parameter omitted.
    expect(chatRouteMocks.chatWithKnowledge).toHaveBeenCalledTimes(1)
  })

  it('falls back to empty gateway id when aiGateway config is not set', async () => {
    // Default runtime config in beforeEach has no aiGateway override,
    // so createKnowledgeRuntimeConfig should produce `{ id: '', cacheEnabled: true }`.
    chatRouteMocks.chatWithKnowledge.mockResolvedValueOnce({
      answer: 'ok',
      citations: [],
      refused: false,
    })

    const { default: handler } = await import('../../server/api/chat.post')
    await handler(createRouteEvent())

    expect(chatRouteMocks.createCloudflareAiSearchClient).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayConfig: { id: '', cacheEnabled: true },
      }),
    )
  })

  it('derives isAdmin from requireRole result instead of the narrow session snapshot', async () => {
    chatRouteMocks.requireRole.mockResolvedValueOnce({
      role: 'admin',
      session: {
        user: {
          email: 'admin@example.com',
          id: 'user-1',
          role: 'admin',
        },
      },
      fullSession: {
        user: {
          email: 'admin@example.com',
          id: 'user-1',
        },
      },
    })
    chatRouteMocks.requireUserSession.mockResolvedValueOnce({
      user: {
        email: 'admin@example.com',
        id: 'user-1',
      },
    })
    chatRouteMocks.chatWithKnowledge.mockResolvedValueOnce({
      answer: 'admin answer',
      citations: [],
      refused: false,
    })

    const { default: handler } = await import('../../server/api/chat.post')
    await handler(createRouteEvent())

    expect(chatRouteMocks.chatWithKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          isAdmin: true,
          userId: 'user-1',
        }),
      }),
      expect.any(Object),
    )
  })
})
