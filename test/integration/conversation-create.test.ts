import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * Integration tests for governance-refinements §1.7 — conversation
 * create / auto-create plumbing.
 *
 * Before this change, `/api/chat` only accepted `conversationId` for
 * follow-up turns but had no way to hand the client a fresh id on the first
 * turn. Any client-side follow-up therefore 404-ed. The fix is to
 * auto-create a conversation inside `/api/chat` when the body omits
 * `conversationId` and return the new id to the client.
 *
 * Coverage:
 *
 * - case 1: POST with no conversationId → handler calls `createForUser` and
 *   returns the new id with `conversationCreated: true`
 * - case 2: POST with a conversationId the caller does NOT own → 404
 * - case 3: POST with the caller's own visible conversationId → handler
 *   does NOT create a new row and returns that id with
 *   `conversationCreated: false`
 * - case 4: POST with another user's id (visibility store returns false)
 *   → 404, no new conversation row written
 *
 * Store-level coverage of `createForUser` lives in
 * `conversation-deleted-at-filter.test.ts` to avoid module-mock collisions
 * with the route tests here.
 */

interface CreatedRow {
  id: string
  userProfileId: string
  title: string
}

const routeState = vi.hoisted(() => ({
  created: [] as CreatedRow[],
  visibilityChecks: [] as Array<{ conversationId: string; userProfileId: string }>,
  isVisibleForResult: true,
}))

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
    // Handler derives auto-create title from redacted content (governance
    // §1.4). Pass-through audit is safe for the plumbing tests in this
    // file since they don't exercise redaction or block paths.
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
    createConversationStore: vi.fn().mockImplementation(() => ({
      createForUser: vi
        .fn()
        .mockImplementation(async (input: { userProfileId: string; title?: string }) => {
          const row: CreatedRow = {
            id: `conv-${routeState.created.length + 1}`,
            userProfileId: input.userProfileId,
            title: input.title?.trim() || 'New conversation',
          }

          routeState.created.push(row)

          return {
            ...row,
            accessLevel: 'internal',
            createdAt: '2026-04-18T09:00:00.000Z',
            updatedAt: '2026-04-18T09:00:00.000Z',
          }
        }),
      isVisibleForUser: vi
        .fn()
        .mockImplementation(async (input: { conversationId: string; userProfileId: string }) => {
          routeState.visibilityChecks.push(input)

          return routeState.isVisibleForResult
        }),
      listForUser: vi.fn(),
      getForUser: vi.fn(),
      softDeleteForUser: vi.fn(),
    })),
    createKnowledgeAuditStore: vi.fn().mockReturnValue({}),
    createKnowledgeEvidenceStore: vi.fn().mockReturnValue({}),
    getKnowledgeRuntimeConfig: vi.fn(),
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

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/cloudflare-bindings', () => ({
  getCloudflareEnv: () => ({
    AI: {
      autorag: vi.fn().mockReturnValue({ search: vi.fn() }),
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

vi.mock('../../server/utils/web-chat', () => ({
  ChatRateLimitExceededError: chatRouteMocks.MockChatRateLimitExceededError,
  chatWithKnowledge: chatRouteMocks.chatWithKnowledge,
  createChatKvRateLimitStore: chatRouteMocks.createChatKvRateLimitStore,
}))

installNuxtRouteTestGlobals()

describe('/api/chat — conversation auto-create plumbing (governance §1.7)', () => {
  beforeEach(() => {
    routeState.created.length = 0
    routeState.visibilityChecks.length = 0
    routeState.isVisibleForResult = true

    vi.stubGlobal('readValidatedBody', chatRouteMocks.readValidatedBody)
    vi.stubGlobal('requireUserSession', chatRouteMocks.requireUserSession)

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
    chatRouteMocks.requireUserSession.mockResolvedValue({
      user: {
        email: 'user@example.com',
        id: 'user-1',
      },
    })
    chatRouteMocks.chatWithKnowledge.mockResolvedValue({
      answer: 'Launch moved to Tuesday.',
      citations: [],
      refused: false,
      retrievalScore: 0.92,
    })
  })

  it('case 1: POST with no conversationId auto-creates a row and returns the new id', async () => {
    chatRouteMocks.readValidatedBody.mockResolvedValue({
      query: 'Launch timing update?',
    })

    const { default: handler } = await import('../../server/api/chat.post')
    const result = await handler(createRouteEvent())

    expect(routeState.created).toHaveLength(1)
    expect(routeState.created[0]).toMatchObject({
      id: 'conv-1',
      userProfileId: 'user-1',
      // title defaulted to the first 40 chars of the (trimmed) query.
      title: 'Launch timing update?',
    })

    expect(result).toMatchObject({
      data: {
        answer: 'Launch moved to Tuesday.',
        citations: [],
        conversationId: 'conv-1',
        conversationCreated: true,
        refused: false,
      },
    })

    // The auto-create path must not run an ownership check — there is no id
    // to check yet.
    expect(routeState.visibilityChecks).toHaveLength(0)

    // chatWithKnowledge must receive the new id so the stale resolver gets
    // wired up on every turn, including the first.
    expect(chatRouteMocks.chatWithKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
      expect.any(Object),
    )
  })

  it('case 2: POST with an unknown conversationId → 404, no row written', async () => {
    routeState.isVisibleForResult = false
    chatRouteMocks.readValidatedBody.mockResolvedValue({
      query: 'still stuck on old chat',
      conversationId: '11111111-1111-1111-1111-111111111111',
    })

    const { default: handler } = await import('../../server/api/chat.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 404,
      message: '找不到此對話',
    })

    expect(routeState.visibilityChecks).toEqual([
      {
        conversationId: '11111111-1111-1111-1111-111111111111',
        userProfileId: 'user-1',
      },
    ])
    expect(routeState.created).toHaveLength(0)
    expect(chatRouteMocks.chatWithKnowledge).not.toHaveBeenCalled()
  })

  it("case 3: POST with the caller's own visible conversationId reuses it without creating", async () => {
    chatRouteMocks.readValidatedBody.mockResolvedValue({
      query: 'follow-up turn',
      conversationId: '22222222-2222-2222-2222-222222222222',
    })

    const { default: handler } = await import('../../server/api/chat.post')
    const result = await handler(createRouteEvent())

    expect(routeState.visibilityChecks).toEqual([
      {
        conversationId: '22222222-2222-2222-2222-222222222222',
        userProfileId: 'user-1',
      },
    ])
    expect(routeState.created).toHaveLength(0)

    expect(result).toMatchObject({
      data: {
        conversationId: '22222222-2222-2222-2222-222222222222',
        conversationCreated: false,
      },
    })

    // chatWithKnowledge must receive the supplied id so the stale resolver
    // re-validates the prior citation chain.
    expect(chatRouteMocks.chatWithKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: '22222222-2222-2222-2222-222222222222',
      }),
      expect.any(Object),
    )
  })

  it("case 4: POST with another user's conversation id → 404 (isVisibleFor returns false)", async () => {
    // Simulate: user-1 tries to hijack a conversation owned by user-2. The
    // store's visibility filter collapses the three failure modes
    // (not-owned / deleted / missing) into a single `false`, which the
    // handler then surfaces as 404.
    routeState.isVisibleForResult = false
    chatRouteMocks.readValidatedBody.mockResolvedValue({
      query: 'whose chat is this anyway',
      conversationId: '33333333-3333-3333-3333-333333333333',
    })

    const { default: handler } = await import('../../server/api/chat.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 404,
    })

    expect(routeState.visibilityChecks).toEqual([
      {
        conversationId: '33333333-3333-3333-3333-333333333333',
        userProfileId: 'user-1',
      },
    ])
    expect(routeState.created).toHaveLength(0)
  })
})
