import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { chatWithKnowledge, createChatKvRateLimitStore } from '#server/utils/web-chat'
import type { StaleResolverResult } from '#server/utils/conversation-stale-resolver'

/**
 * Integration tests for governance-refinements §1.2 — Web follow-up path.
 *
 * When a caller hands `chatWithKnowledge` a `conversationId`, the
 * orchestration MUST:
 *
 * 1. Ask `options.resolveStaleness` whether the prior citation chain is
 *    still valid.
 * 2. Proceed with fresh retrieval regardless (there is no stateful shortcut
 *    in v1.0.0), but report `followUp.forcedFreshRetrieval=true` when the
 *    resolver flagged the conversation as stale so upstream surfaces can
 *    log the decision.
 * 3. Throw when `conversationId` is provided without a resolver — failing
 *    closed is safer than silently ignoring the governance contract.
 *
 * Happy-path retrieval is covered in unit/web-chat.test.ts; here we focus on
 * the staleness wiring.
 */

const CURRENT_EVIDENCE = [
  {
    accessLevel: 'internal',
    categorySlug: 'launch',
    chunkText: 'Launch moved to Tuesday.',
    citationLocator: 'lines 1-3',
    documentId: 'doc-1',
    documentTitle: 'Launch Plan',
    documentVersionId: 'ver-current',
    excerpt: 'Launch moved to Tuesday.',
    score: 0.92,
    sourceChunkId: 'chunk-current',
    title: 'Launch Plan',
  },
]

function baseInput() {
  const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance

  return {
    auth: { isAdmin: false, userId: 'user-1' },
    governance,
    environment: 'local',
    now: 60_000,
    query: 'What is the new launch timing?',
  }
}

function baseOptions(
  overrides: {
    resolveStaleness?: (input: { conversationId: string }) => Promise<StaleResolverResult>
    retrieve?: ReturnType<typeof vi.fn>
    auditStore?: {
      createMessage: ReturnType<typeof vi.fn>
      createQueryLog: ReturnType<typeof vi.fn>
    }
  } = {}
) {
  const retrieve =
    overrides.retrieve ??
    vi.fn().mockResolvedValue({
      evidence: CURRENT_EVIDENCE,
      normalizedQuery: 'what is the new launch timing',
    })

  return {
    answer: vi.fn().mockResolvedValue('Launch moved to Tuesday.'),
    auditStore:
      overrides.auditStore ??
      ({
        createMessage: vi.fn().mockResolvedValue('msg-id'),
        createQueryLog: vi.fn().mockResolvedValue('query-log-id'),
      } as unknown as undefined),
    judge: vi.fn(),
    rateLimitStore: createChatKvRateLimitStore({
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    }),
    resolveStaleness: overrides.resolveStaleness,
    retrieve,
  }
}

describe('chatWithKnowledge — conversation follow-up', () => {
  it('flags forcedFreshRetrieval=true when the resolver reports stale', async () => {
    const resolveStaleness = vi.fn().mockResolvedValue({
      conversationId: 'conv-1',
      hasAssistantHistory: true,
      isStale: true,
      staleDocumentVersionIds: ['ver-old'],
      latestAssistantMessage: {
        id: 'msg-prev',
        createdAt: '2026-04-18T10:00:00.000Z',
        citedDocumentVersionIds: ['ver-old'],
      },
    } satisfies StaleResolverResult)

    const result = await chatWithKnowledge(
      { ...baseInput(), conversationId: 'conv-1' },
      baseOptions({ resolveStaleness })
    )

    expect(resolveStaleness).toHaveBeenCalledWith({ conversationId: 'conv-1' })
    expect(result.followUp).toEqual({
      conversationId: 'conv-1',
      forcedFreshRetrieval: true,
      stale: expect.objectContaining({ isStale: true, staleDocumentVersionIds: ['ver-old'] }),
    })
    // Answer still produced — fresh retrieval just ran with current evidence.
    expect(result.answer).toBe('Launch moved to Tuesday.')
    expect(result.refused).toBe(false)
  })

  it('flags forcedFreshRetrieval=false when the conversation is still fresh', async () => {
    const resolveStaleness = vi.fn().mockResolvedValue({
      conversationId: 'conv-1',
      hasAssistantHistory: true,
      isStale: false,
      staleDocumentVersionIds: [],
      latestAssistantMessage: {
        id: 'msg-prev',
        createdAt: '2026-04-18T10:00:00.000Z',
        citedDocumentVersionIds: ['ver-current'],
      },
    } satisfies StaleResolverResult)

    const result = await chatWithKnowledge(
      { ...baseInput(), conversationId: 'conv-1' },
      baseOptions({ resolveStaleness })
    )

    expect(result.followUp).toEqual({
      conversationId: 'conv-1',
      forcedFreshRetrieval: false,
      stale: expect.objectContaining({ isStale: false, staleDocumentVersionIds: [] }),
    })
  })

  it('invokes the resolver BEFORE retrieval so staleness is known upfront', async () => {
    const order: string[] = []
    const resolveStaleness = vi.fn().mockImplementation(async () => {
      order.push('resolveStaleness')

      return {
        conversationId: 'conv-1',
        hasAssistantHistory: true,
        isStale: true,
        staleDocumentVersionIds: ['ver-old'],
        latestAssistantMessage: null,
      } satisfies StaleResolverResult
    })
    const retrieve = vi.fn().mockImplementation(async () => {
      order.push('retrieve')

      return {
        evidence: CURRENT_EVIDENCE,
        normalizedQuery: 'what is the new launch timing',
      }
    })

    await chatWithKnowledge(
      { ...baseInput(), conversationId: 'conv-1' },
      baseOptions({ resolveStaleness, retrieve })
    )

    expect(order.indexOf('resolveStaleness')).toBeLessThan(order.indexOf('retrieve'))
  })

  it('throws when conversationId is provided without resolveStaleness (fails closed)', async () => {
    await expect(
      chatWithKnowledge(
        { ...baseInput(), conversationId: 'conv-1' },
        baseOptions({ resolveStaleness: undefined })
      )
    ).rejects.toThrow(/stale conversation resolver is required/)
  })

  it('omits followUp when no conversationId is supplied (backward compat with session-only chat)', async () => {
    const result = await chatWithKnowledge(baseInput(), baseOptions({ resolveStaleness: vi.fn() }))

    expect(result.followUp).toBeUndefined()
  })

  it('does not consult retrieval or the resolver when rate limiting trips first', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ count: 30, windowStart: 0 })),
      put: vi.fn(),
    }
    const resolveStaleness = vi.fn()
    const retrieve = vi.fn()

    await expect(
      chatWithKnowledge(
        { ...baseInput(), conversationId: 'conv-1' },
        {
          ...baseOptions({ resolveStaleness, retrieve }),
          rateLimitStore: createChatKvRateLimitStore(kv),
        }
      )
    ).rejects.toThrow(/Rate limit exceeded/)

    expect(resolveStaleness).not.toHaveBeenCalled()
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('persists conversationId + cited documentVersionIds on audit messages (governance §1.1 + §1.4)', async () => {
    // Regression: without these fields the soft-delete purge silently
    // skips every row and the stale resolver can never find the latest
    // cited document_version_ids to re-validate.
    const createMessage = vi.fn().mockResolvedValue('msg-id')
    const auditStore = {
      createMessage,
      createQueryLog: vi.fn().mockResolvedValue('query-log-id'),
    }
    const resolveStaleness = vi.fn().mockResolvedValue({
      conversationId: 'conv-1',
      hasAssistantHistory: false,
      isStale: false,
      staleDocumentVersionIds: [],
      latestAssistantMessage: null,
    } satisfies StaleResolverResult)

    const result = await chatWithKnowledge(
      { ...baseInput(), conversationId: 'conv-1' },
      baseOptions({ resolveStaleness, auditStore })
    )

    expect(result.answer).toBe('Launch moved to Tuesday.')
    expect(result.refused).toBe(false)

    // User message MUST carry conversationId so governance §1.4 purge can
    // NULL its content_text on soft-delete.
    expect(createMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channel: 'web',
        content: 'What is the new launch timing?',
        conversationId: 'conv-1',
        role: 'user',
      })
    )

    // Assistant message MUST carry conversationId AND a citationsJson that
    // contains the cited document_version_id values, so governance §1.1
    // stale resolver can re-validate on the next follow-up turn.
    const assistantCall = createMessage.mock.calls.find(
      ([arg]) => (arg as { role: string }).role === 'assistant'
    )
    expect(assistantCall).toBeDefined()
    const assistantArg = assistantCall?.[0] as {
      citationsJson: string
      conversationId: string
      role: string
    }
    expect(assistantArg.conversationId).toBe('conv-1')
    const parsed = JSON.parse(assistantArg.citationsJson) as Array<{
      documentVersionId: string
    }>
    expect(parsed).toEqual([{ documentVersionId: 'ver-current' }])
  })

  it('still returns followUp on the credential-block early-return branch', async () => {
    const resolveStaleness = vi.fn().mockResolvedValue({
      conversationId: 'conv-1',
      hasAssistantHistory: true,
      isStale: true,
      staleDocumentVersionIds: ['ver-old'],
      latestAssistantMessage: null,
    } satisfies StaleResolverResult)
    const retrieve = vi.fn()

    const result = await chatWithKnowledge(
      {
        ...baseInput(),
        conversationId: 'conv-1',
        query: 'password=hunter2',
      },
      baseOptions({ resolveStaleness, retrieve })
    )

    expect(result.refused).toBe(true)
    expect(retrieve).not.toHaveBeenCalled()
    expect(result.followUp).toEqual({
      conversationId: 'conv-1',
      forcedFreshRetrieval: true,
      stale: expect.objectContaining({ isStale: true }),
    })
  })
})
