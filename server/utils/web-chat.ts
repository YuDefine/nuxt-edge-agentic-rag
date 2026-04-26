import type { KnowledgeGovernanceConfig } from '#shared/schemas/knowledge-runtime'
import type { DecisionPath, RefusalReason } from '#shared/types/observability'
import { isAbortError } from '#shared/utils/abort'
import { REFUSAL_MESSAGE_CONTENT } from '#shared/utils/chat-refusal'
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
    readonly retryAfterMs: number,
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
      onTextDelta?: (delta: string) => Promise<void> | void
      query: string
      retrievalScore: number
      signal?: AbortSignal
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
        /**
         * persist-refusal-and-label-new-chat: marks the row as a refusal
         * assistant turn so reload paths can render `RefusalMessage.vue`.
         * Defaults to `false` when omitted; MCP callers MUST pass `false`
         * explicitly because MCP refusal contracts are owned separately.
         */
        refused?: boolean
        /**
         * persist-refusal-and-label-new-chat: specific RefusalReason value
         * for refusal assistant rows. `null` (or omit) for user / system /
         * accepted rows.
         */
        refusalReason?: string | null
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
      input: WebCitationPersistenceInput,
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
    /**
     * §S-RW (change rag-query-rewriting): forwarded to `answerKnowledgeQuery`
     * which sets `useRewriter: false` on the self-correction retry pass so
     * the judge-supplied `reformulatedQuery` is not re-rewritten. Caller's
     * retrieve closure MUST honour `input.useRewriter !== false` when
     * deciding whether to invoke the rewriter — see entry-point examples in
     * `server/api/chat.post.ts`.
     */
    retrieve: (input: {
      allowedAccessLevels: string[]
      query: string
      useRewriter?: boolean
    }) => Promise<{
      evidence: VerifiedKnowledgeEvidence[]
      normalizedQuery: string
    }>
    stream?: {
      onTextDelta?: (delta: string) => Promise<void> | void
      signal?: AbortSignal
    }
  },
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
  /**
   * persist-refusal-and-label-new-chat: specific reason populated when
   * `refused === true` so the SSE refusal event payload (and downstream
   * `RefusalMessage.vue`) can render reason-specific copy. `null` when
   * `refused === false`.
   */
  refusalReason: RefusalReason | null
  retrievalScore: number
}> {
  // Coerce `input.now` (epoch ms or undefined) into a Date once so persistence
  // calls below don't repeat the `typeof === 'number' ? new Date(...) : undefined`
  // ternary. `auditStore` callees expect `Date | undefined`, not epoch ms.
  const nowDate = typeof input.now === 'number' ? new Date(input.now) : undefined

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
      rateLimit.retryAfterMs,
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
          'the stale conversation resolver is required (governance §1.1)',
      )
    }

    staleResult = await options.resolveStaleness({ conversationId: input.conversationId })
    forcedFreshRetrieval = staleResult.isStale
  }

  const audit = auditKnowledgeText(input.query)

  if (audit.shouldBlock) {
    // observability-and-debug §1.2: audit-blocked path is a pre-pipeline
    // refusal — the decision is fully known here. Lifted to the outer
    // `audit.shouldBlock` block (rather than nested inside `auditStore`)
    // so the return shape can surface the same reason whether or not an
    // audit store is wired.
    const blockedDecisionPath: DecisionPath = 'restricted_blocked'
    const blockedRefusalReason: RefusalReason = 'restricted_scope'

    if (options.auditStore) {
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
        refused: false,
        userProfileId: input.auth.userId,
      })

      // persist-refusal-and-label-new-chat: audit-blocked is a refusal
      // outcome — write the assistant turn so reload paths can render
      // `RefusalMessage.vue` from `messages.refused = 1`. content uses
      // the shared REFUSAL_MESSAGE_CONTENT constant; per-reason copy
      // belongs in the UI template, not in `messages.content`. Reason is
      // `'restricted_scope'` so reload UI shows credential-leak guidance.
      await options.auditStore.createMessage({
        channel: 'web',
        content: REFUSAL_MESSAGE_CONTENT,
        conversationId: input.conversationId ?? null,
        queryLogId,
        role: 'assistant',
        refused: true,
        refusalReason: blockedRefusalReason,
        userProfileId: input.auth.userId,
      })
    }

    return {
      answer: null,
      citations: [],
      refused: true,
      refusalReason: blockedRefusalReason,
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
        now: nowDate,
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
      now: nowDate,
      queryLogId: queryLogId ?? undefined,
      role: 'user',
      refused: false,
      userProfileId: input.auth.userId,
    })
  }

  const pipelineStartMs = Date.now()
  let firstTokenLatencyMs: number | null = null
  let telemetry: KnowledgeAnsweringTelemetry | null = null

  let result: Awaited<ReturnType<typeof answerKnowledgeQuery>>
  try {
    result = await answerKnowledgeQuery(
      {
        allowedAccessLevels,
        query: input.query,
      },
      {
        answer: (answerInput) =>
          options.answer({
            ...answerInput,
            onTextDelta: options.stream?.onTextDelta
              ? async (delta) => {
                  if (firstTokenLatencyMs === null) {
                    firstTokenLatencyMs = Date.now() - pipelineStartMs
                  }
                  await options.stream?.onTextDelta?.(delta)
                }
              : undefined,
            signal: options.stream?.signal,
          }),
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
            ...(nowDate ? { now: nowDate } : {}),
          }

          return options.persistCitations(payload)
        },
        retrieve: options.retrieve,
        stream: options.stream,
      },
    )
  } catch (error) {
    if (options.auditStore?.updateQueryLog && queryLogId) {
      if (isAbortError(error)) {
        const abortSnapshot = telemetry as KnowledgeAnsweringTelemetry | null
        await options.auditStore.updateQueryLog({
          queryLogId,
          firstTokenLatencyMs,
          completionLatencyMs: null,
          retrievalScore: abortSnapshot?.retrievalScore ?? null,
          judgeScore: abortSnapshot?.judgeScore ?? null,
          decisionPath: abortSnapshot?.decisionPath ?? null,
          refusalReason: abortSnapshot?.refusalReason ?? null,
        })
      } else {
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

        // persist-refusal-and-label-new-chat: pipeline_error is a refusal
        // outcome from the user's perspective — the SSE container surfaces
        // a refusal experience after this throw. Persist the assistant
        // turn so reload paths still see the refusal even if the original
        // stream never completed. Reason is `'pipeline_error'` so reload
        // UI shows the transient-failure guidance copy. Aborts are NOT
        // persisted because they represent the user choosing to cancel
        // mid-stream, not a refusal. The outer
        // `options.auditStore?.updateQueryLog && queryLogId` guard
        // already implies `auditStore` is truthy here.
        await options.auditStore.createMessage({
          channel: 'web',
          content: REFUSAL_MESSAGE_CONTENT,
          conversationId: input.conversationId ?? null,
          now: nowDate,
          queryLogId,
          role: 'assistant',
          refused: true,
          refusalReason: 'pipeline_error',
          userProfileId: input.auth.userId,
        })
      }
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
      firstTokenLatencyMs,
      completionLatencyMs,
      retrievalScore: snapshot.retrievalScore,
      judgeScore: snapshot.judgeScore,
      decisionPath: snapshot.decisionPath,
      refusalReason: snapshot.refusalReason,
    })
  }

  // persist-refusal-and-label-new-chat: derive the effective refusal reason
  // before message persistence so both the assistant message row and the
  // function return use the same value. Reason comes from telemetry
  // (typically `no_citation` or `low_confidence`); fall back to
  // `no_citation` when the pipeline exited without emitting telemetry so
  // reload still gets a usable copy bucket. Accepted answers are `null`.
  // The cast mirrors the surrounding code — control-flow narrowing through
  // the `onDecision` callback assignment loses the original type otherwise.
  const telemetrySnapshot = telemetry as KnowledgeAnsweringTelemetry | null
  const effectiveRefusalReason: RefusalReason | null =
    result.refused || result.answer === null
      ? (telemetrySnapshot?.refusalReason ?? 'no_citation')
      : null

  if (options.auditStore) {
    if (result.refused || result.answer === null) {
      // persist-refusal-and-label-new-chat: pipeline refusal outcome —
      // judge rejected, retrieval coverage too low, or the orchestration
      // returned a null answer. Persist the assistant turn so reload
      // paths render `RefusalMessage.vue` from `messages.refused = 1`.
      // No citationsJson because there is no cited evidence to replay.
      await options.auditStore.createMessage({
        channel: 'web',
        content: REFUSAL_MESSAGE_CONTENT,
        conversationId: input.conversationId ?? null,
        now: nowDate,
        queryLogId: queryLogId ?? undefined,
        role: 'assistant',
        refused: true,
        refusalReason: effectiveRefusalReason,
        userProfileId: input.auth.userId,
      })
    } else {
      // Governance §1.1: persist a de-duplicated list of cited
      // `document_version_id` values so the stale resolver can re-validate
      // them on the next follow-up turn.
      const citedDocumentVersionIds = [
        ...new Set(result.citations.map((citation) => citation.documentVersionId)),
      ]

      await options.auditStore.createMessage({
        channel: 'web',
        citationsJson: JSON.stringify(
          citedDocumentVersionIds.map((documentVersionId) => ({ documentVersionId })),
        ),
        content: result.answer,
        conversationId: input.conversationId ?? null,
        now: nowDate,
        queryLogId: queryLogId ?? undefined,
        role: 'assistant',
        refused: false,
        refusalReason: null,
        userProfileId: input.auth.userId,
      })
    }
  }

  if (staleResult && input.conversationId) {
    return {
      ...result,
      refusalReason: effectiveRefusalReason,
      followUp: {
        conversationId: input.conversationId,
        forcedFreshRetrieval,
        stale: staleResult,
      },
    }
  }

  return {
    ...result,
    refusalReason: effectiveRefusalReason,
  }
}
