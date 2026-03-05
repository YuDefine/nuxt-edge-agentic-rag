import type { KnowledgeGovernanceConfig } from '#shared/schemas/knowledge-runtime'
import type { DecisionPath, RefusalReason } from '#shared/types/observability'
import { answerKnowledgeQuery, type KnowledgeAnsweringTelemetry } from './knowledge-answering'
import { auditKnowledgeText } from './knowledge-audit'
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
      createMessage(input: {
        channel: 'mcp' | 'web'
        citationsJson?: string
        conversationId?: string | null
        content: string
        now?: Date
        queryLogId?: string
        role: 'system' | 'user' | 'assistant' | 'tool'
        userProfileId?: string | null
      }): Promise<string>
      createQueryLog(input: {
        allowedAccessLevels: string[]
        channel: 'mcp' | 'web'
        configSnapshotVersion: string
        environment: string
        mcpTokenId?: string | null
        now?: Date
        queryText: string
        status: 'accepted' | 'blocked' | 'limited' | 'rejected'
        userProfileId?: string | null
        // observability-and-debug §1.2: derived debug fields written on the
        // initial INSERT for paths that are known at creation time (i.e. the
        // blocked / pre-pipeline refusal path). Happy-path / pipeline-error
        // paths leave these undefined here and back-fill via `updateQueryLog`
        // after the pipeline completes.
        firstTokenLatencyMs?: number | null
        completionLatencyMs?: number | null
        retrievalScore?: number | null
        judgeScore?: number | null
        decisionPath?: string | null
        refusalReason?: string | null
      }): Promise<string>
      /**
       * observability-and-debug §1.2 — back-fill derived debug fields on a
       * query_log row after the answering pipeline returned (or threw).
       * Optional so legacy test fixtures that only stub
       * `{createMessage, createQueryLog}` continue to work.
       */
      updateQueryLog?(input: {
        queryLogId: string
        firstTokenLatencyMs?: number | null
        completionLatencyMs?: number | null
        retrievalScore?: number | null
        judgeScore?: number | null
        decisionPath?: string | null
        refusalReason?: string | null
      }): Promise<void>
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
      // observability-and-debug §1.2: audit-blocked path is a pre-pipeline
      // refusal, so the decision is fully known at INSERT time — no separate
      // `updateQueryLog` back-fill is needed.
      const blockedDecisionPath: DecisionPath = 'restricted_blocked'
      const blockedRefusalReason: RefusalReason = 'restricted_scope'
      const queryLogId = await options.auditStore.createQueryLog({
        allowedAccessLevels,
        channel: 'web',
        configSnapshotVersion: input.governance.configSnapshotVersion,
        environment: input.environment,
        queryText: input.query,
        status: 'blocked',
        userProfileId: input.auth.userId,
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
        retrievalScore: null,
        judgeScore: null,
        decisionPath: blockedDecisionPath,
        refusalReason: blockedRefusalReason,
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

  // observability-and-debug §1.2: measure completion latency for the
  // accepted path so the debug surface can show end-to-end time without
  // replaying the pipeline. `firstTokenLatencyMs` stays null until SSE
  // streaming is instrumented (not in this phase). When an audit store with
  // `updateQueryLog` is supplied, the derived fields are back-filled on the
  // query_log row after the pipeline returns (happy + refusal + error).
  const pipelineStartMs = Date.now()
  let telemetry: KnowledgeAnsweringTelemetry | null = null

  let result: Awaited<ReturnType<typeof answerKnowledgeQuery>>
  try {
    result = await answerKnowledgeQuery(
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
        onDecision: (snapshot) => {
          telemetry = snapshot
        },
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

          const payload: WebCitationPersistenceInput = {
            citations: citations.map((citation) => ({
              ...citation,
              queryLogId,
            })),
          }

          if (typeof input.now === 'number') {
            payload.now = new Date(input.now)
          }

          return options.persistCitations(payload)
        },
        retrieve: options.retrieve,
      }
    )
  } catch (error) {
    if (options.auditStore?.updateQueryLog && queryLogId) {
      // observability-and-debug §1.2: pipeline threw → record the failure
      // path. Latency stays null because we cannot trust partial timing
      // after a thrown error.
      await options.auditStore.updateQueryLog({
        queryLogId,
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
        retrievalScore: null,
        judgeScore: null,
        decisionPath: 'pipeline_error',
        refusalReason: 'pipeline_error',
      })
    }
    throw error
  }

  if (options.auditStore?.updateQueryLog && queryLogId) {
    const completionLatencyMs = Date.now() - pipelineStartMs
    // telemetry is populated by `onDecision` for every normal branch of
    // answerKnowledgeQuery. If it's null here the pipeline returned without
    // emitting — treat that as pipeline_error to avoid fabricating a path.
    const snapshot: KnowledgeAnsweringTelemetry = telemetry ?? {
      decisionPath: 'pipeline_error',
      refusalReason: 'pipeline_error',
      retrievalScore: result.retrievalScore,
      judgeScore: null,
    }
    await options.auditStore.updateQueryLog({
      queryLogId,
      firstTokenLatencyMs: null,
      completionLatencyMs,
      retrievalScore: snapshot.retrievalScore,
      judgeScore: snapshot.judgeScore,
      decisionPath: snapshot.decisionPath,
      refusalReason: snapshot.refusalReason,
    })
  }

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
