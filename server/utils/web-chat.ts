import type { KnowledgeGovernanceConfig } from '#shared/schemas/knowledge-runtime'
import { answerKnowledgeQuery } from './knowledge-answering'
import {
  auditKnowledgeText,
  type CreateMessageInput,
  type CreateQueryLogInput,
} from './knowledge-audit'
import { getAllowedAccessLevels } from './knowledge-runtime'
import type { VerifiedKnowledgeEvidence } from './knowledge-retrieval'
import type { StaleResolverResult } from './conversation-stale-resolver'
import {
  consumeFixedWindowRateLimit,
  FIXED_WINDOW_RATE_LIMIT_PRESETS,
  type FixedWindowRateLimitStore,
} from './rate-limiter'

export class ChatRateLimitExceededError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterMs: number
  ) {
    super(message)
    this.name = 'ChatRateLimitExceededError'
  }
}

interface WebCitationPersistenceInput {
  citations: Array<{
    chunkTextSnapshot: string
    citationLocator: string
    documentVersionId: string
    queryLogId: string
    sourceChunkId: string
  }>
  now?: Date
}

interface KvLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export function createChatKvRateLimitStore(kv: KvLike): FixedWindowRateLimitStore {
  return {
    async get(key) {
      const value = await kv.get(key)

      if (!value) {
        return null
      }

      return JSON.parse(value) as { count: number; windowStart: number }
    },
    async set(key, value) {
      await kv.put(key, JSON.stringify(value), {
        expirationTtl: Math.ceil(FIXED_WINDOW_RATE_LIMIT_PRESETS.chat.windowMs / 1000),
      })
    },
  }
}

export interface ChatFollowUpContext {
  conversationId: string
  stale: StaleResolverResult
}

export async function chatWithKnowledge(
  input: {
    auth: {
      isAdmin: boolean
      userId: string
    }
    /**
     * Optional conversation context. When supplied, the orchestration MUST
     * use the `resolveStaleness` option to decide whether the latest cited
     * document versions are still current. Stale conversations are forced
     * onto a fresh retrieval path — the previous citation chain is never
     * treated as truth again. Missing conversation, deleted conversation, or
     * conversations owned by a different user MUST be rejected by the
     * caller before this function is invoked; this helper does not repeat
     * the ownership check.
     */
    conversationId?: string
    governance: KnowledgeGovernanceConfig
    environment: string
    now?: number
    query: string
  },
  options: {
    answer: (input: {
      evidence: VerifiedKnowledgeEvidence[]
      modelRole: string
      query: string
      retrievalScore: number
    }) => Promise<string>
    auditStore?: {
      createMessage(input: CreateMessageInput): Promise<string>
      createQueryLog(input: CreateQueryLogInput): Promise<string>
    }
    judge: (input: {
      evidence: VerifiedKnowledgeEvidence[]
      query: string
      retrievalScore: number
    }) => Promise<{
      reformulatedQuery?: string
      shouldAnswer: boolean
    }>
    persistCitations?: (
      input: WebCitationPersistenceInput
    ) => Promise<Array<{ citationId: string; documentVersionId: string; sourceChunkId: string }>>
    /**
     * Resolves whether `input.conversationId` is stale (governance §1.1).
     *
     * Required when `input.conversationId` is provided. When the resolver
     * reports `isStale: true`, the orchestration MUST fall back to fresh
     * retrieval instead of treating the prior citation chain as truth — see
     * `design.md` `Conversation Lifecycle Is Dynamic, Not Cached Truth`.
     *
     * This helper still calls `options.retrieve` either way; the concrete
     * behavioural difference is that on the stale path we MUST NOT inject a
     * same-document follow-up hint into the query and we flag the run via
     * the returned `followUp.forcedFreshRetrieval` so callers can record it.
     */
    resolveStaleness?: (input: { conversationId: string }) => Promise<StaleResolverResult>
    rateLimitStore: FixedWindowRateLimitStore
    retrieve: (input: { allowedAccessLevels: string[]; query: string }) => Promise<{
      evidence: VerifiedKnowledgeEvidence[]
      normalizedQuery: string
    }>
  }
): Promise<{
  answer: string | null
  citations: Array<{ citationId: string; documentVersionId: string; sourceChunkId: string }>
  /**
   * Populated only when `input.conversationId` + `options.resolveStaleness`
   * were both provided. `forcedFreshRetrieval` is `true` when the previous
   * citation chain was considered stale and the orchestration therefore
   * ignored it in favour of fresh retrieval.
   */
  followUp?: {
    conversationId: string
    forcedFreshRetrieval: boolean
    stale: StaleResolverResult
  }
  refused: boolean
  retrievalScore: number
}> {
  const rateLimit = await consumeFixedWindowRateLimit({
    key: `web:${input.environment}:chat:${input.auth.userId}`,
    now: input.now,
    preset: FIXED_WINDOW_RATE_LIMIT_PRESETS.chat,
    store: options.rateLimitStore,
  })

  if (!rateLimit.allowed) {
    throw new ChatRateLimitExceededError(
      'Rate limit exceeded for /api/chat',
      429,
      rateLimit.retryAfterMs
    )
  }

  const allowedAccessLevels = getAllowedAccessLevels({
    channel: 'web',
    isAdmin: input.auth.isAdmin,
    isAuthenticated: true,
  })

  // Resolve staleness BEFORE we touch retrieval. The resolver is pure read —
  // it never mutates prior messages. Whether it reports stale or not, we
  // still run `options.retrieve` against current `is_current` evidence below;
  // the stale flag only controls whether we keep any "same-document
  // follow-up" shortcuts and what we record in `followUp`.
  let staleResult: StaleResolverResult | null = null
  let forcedFreshRetrieval = false

  if (input.conversationId) {
    if (!options.resolveStaleness) {
      throw new Error(
        'chatWithKnowledge: conversationId provided without options.resolveStaleness — ' +
          'the stale conversation resolver is required (governance §1.1)'
      )
    }

    staleResult = await options.resolveStaleness({ conversationId: input.conversationId })
    forcedFreshRetrieval = staleResult.isStale
  }

  const audit = auditKnowledgeText(input.query)

  if (audit.shouldBlock) {
    if (options.auditStore) {
      const queryLogId = await options.auditStore.createQueryLog({
        allowedAccessLevels,
        channel: 'web',
        configSnapshotVersion: input.governance.configSnapshotVersion,
        environment: input.environment,
        queryText: input.query,
        status: 'blocked',
        userProfileId: input.auth.userId,
      })

      await options.auditStore.createMessage({
        channel: 'web',
        content: input.query,
        conversationId: input.conversationId ?? null,
        queryLogId,
        role: 'user',
        userProfileId: input.auth.userId,
      })
    }

    return {
      answer: null,
      citations: [],
      refused: true,
      retrievalScore: 0,
      ...(staleResult && input.conversationId
        ? {
            followUp: {
              conversationId: input.conversationId,
              forcedFreshRetrieval,
              stale: staleResult,
            },
          }
        : {}),
    }
  }

  const queryLogId = options.auditStore
    ? await options.auditStore.createQueryLog({
        allowedAccessLevels,
        channel: 'web',
        configSnapshotVersion: input.governance.configSnapshotVersion,
        environment: input.environment,
        now: typeof input.now === 'number' ? new Date(input.now) : undefined,
        queryText: input.query,
        status: 'accepted',
        userProfileId: input.auth.userId,
      })
    : null

  if (options.auditStore) {
    await options.auditStore.createMessage({
      channel: 'web',
      content: input.query,
      conversationId: input.conversationId ?? null,
      now: typeof input.now === 'number' ? new Date(input.now) : undefined,
      queryLogId: queryLogId ?? undefined,
      role: 'user',
      userProfileId: input.auth.userId,
    })
  }

  const result = await answerKnowledgeQuery(
    {
      allowedAccessLevels,
      query: input.query,
    },
    {
      answer: options.answer,
      governance: {
        models: input.governance.models,
        thresholds: input.governance.thresholds,
      },
      judge: options.judge,
      persistCitations: async (citations) => {
        if (!options.persistCitations || !queryLogId) {
          // Even without a persistence sink we MUST still surface
          // `documentVersionId` on the returned shape so the orchestration
          // can record it on the assistant message (governance §1.1 stale
          // resolver input). The placeholder citationId is never persisted
          // — it just satisfies the shared `answerWithCitations` contract.
          return citations.map((citation) => ({
            citationId: '',
            documentVersionId: citation.documentVersionId,
            sourceChunkId: citation.sourceChunkId,
          }))
        }

        return options.persistCitations({
          citations: citations.map((citation) => ({ ...citation, queryLogId })),
          ...(typeof input.now === 'number' ? { now: new Date(input.now) } : {}),
        })
      },
      retrieve: options.retrieve,
    }
  )

  if (!result.refused && result.answer !== null && options.auditStore) {
    // Governance §1.1: persist a de-duplicated list of cited
    // `document_version_id` values so the stale resolver can re-validate
    // them on the next follow-up turn.
    const citedDocumentVersionIds = [
      ...new Set(result.citations.map((citation) => citation.documentVersionId)),
    ]

    await options.auditStore.createMessage({
      channel: 'web',
      citationsJson: JSON.stringify(
        citedDocumentVersionIds.map((documentVersionId) => ({ documentVersionId }))
      ),
      content: result.answer,
      conversationId: input.conversationId ?? null,
      now: typeof input.now === 'number' ? new Date(input.now) : undefined,
      queryLogId: queryLogId ?? undefined,
      role: 'assistant',
      userProfileId: input.auth.userId,
    })
  }

  if (staleResult && input.conversationId) {
    return {
      ...result,
      followUp: {
        conversationId: input.conversationId,
        forcedFreshRetrieval,
        stale: staleResult,
      },
    }
  }

  return result
}
