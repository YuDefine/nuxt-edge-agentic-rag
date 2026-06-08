import { useLogger, type RequestLogger } from 'evlog'
import { z } from 'zod'

import { recordAIGeneration } from '#server/utils/ai-logger'
import { emitChildLogger, forkChildLogger } from '#server/utils/sse-child-logger'

import {
  createCloudflareAiSearchClient,
  type CloudflareAiSearchBindingLike,
} from '#server/utils/ai-search'
import { requireAiBinding, requireAiSearchBinding } from '#server/utils/ai-binding'
import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getD1Database } from '#server/utils/database'
import { createCitationStore } from '#server/utils/citation-store'
import { createConversationStaleResolver } from '#server/utils/conversation-stale-resolver'
import { createConversationStore } from '#server/utils/conversation-store'
import { deriveConversationTitleFromQuery } from '#server/utils/conversation-title'
import { createKnowledgeAuditStore } from '#server/utils/knowledge-audit'
import { createKnowledgeEvidenceStore } from '#server/utils/knowledge-evidence-store'
import {
  isQueryRewritingEnabled,
  rewriteForRetrieval,
} from '#server/utils/knowledge-query-rewriter'
import { retrieveVerifiedEvidence } from '#server/utils/knowledge-retrieval'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { requireRole } from '#server/utils/require-role'
import {
  createWorkersAiRunRecorder,
  createWorkersAiAnswerAdapter,
  createWorkersAiJudgeAdapter,
  type WorkersAiBindingLike,
} from '#server/utils/workers-ai'
import {
  ChatRateLimitExceededError,
  chatWithKnowledge,
  createChatKvRateLimitStore,
} from '#server/utils/web-chat'
import { createSseChatResponse } from '#server/utils/chat-sse-response'

const chatBodySchema = z
  .object({
    query: z.string().trim().min(1, 'query is required').max(4000, 'query is too long'),
    conversationId: z.string().uuid().optional(),
  })
  .strict()

defineRouteMeta({
  openAPI: {
    tags: ['chat'],
    summary: '對企業知識庫提問並串流回答',
    description:
      '輸入使用者問題，回傳 SSE 串流回答與引用清單（行內【引N】）。需 member 權限；訪客是否可呼叫由 guest_policy 決定（same_as_member 通過、browse_only / no_access 回 403）。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['query'],
            properties: {
              query: {
                type: 'string',
                minLength: 1,
                maxLength: 4000,
                description: '使用者問題；前後空白會被裁切。',
              },
              conversationId: {
                type: 'string',
                format: 'uuid',
                description: '若延續既有對話則帶入；省略則建立新對話。',
              },
            },
          } as never,
        },
      },
    },
    responses: {
      '200': { description: 'SSE 串流，逐字送出回答與引用 metadata。' },
      '400': { description: '請求格式錯誤或 query 超過長度限制。' },
      '401': { description: '未登入或 session 過期。' },
      '403': { description: '訪客政策不允許提問。' },
      '429': { description: '速率限制觸發。' },
    },
  },
})

interface ChatLogFields {
  user: {
    id: string | null
  }
  result: {
    citationCount: number
    conversationCreated: boolean
    conversationId: string
    followUpForcedFreshRetrieval: boolean
    refused: boolean
  }
}

export default defineEventHandler(async function chatHandler(event) {
  const log = useLogger<ChatLogFields>(event)

  try {
    // B16 §6.1: Member-level gate. Admin / Member always pass; Guest
    // passes iff `guest_policy === 'same_as_member'`. Browse-only
    // Guests receive 403 "訪客僅可瀏覽，無法提問"; no-access Guests
    // receive 403 "帳號待管理員審核". The UI consumes these messages
    // directly (see Phase 4/5 `GuestAccessGate.vue`).
    //
    // `fullSession` carries the canonical better-auth `AuthUser` shape
    // (`id: string`) that downstream stores expect. Avoid calling
    // `requireUserSession(event)` again here — `requireRole` already ran
    // it, and each call re-invokes `auth.api.getSession(headers)`.
    const { session: sessionWithRole, fullSession: session } = await requireRole(event, 'member')
    const sessionUser = sessionWithRole.user
    log.set({
      operation: 'web-chat',
      user: {
        id: session.user.id ?? null,
      },
    })

    const body = await readValidatedBody(event, chatBodySchema.parse)
    const runtimeConfig = getKnowledgeRuntimeConfig()
    const database = await getD1Database()
    const conversationStore = createConversationStore(database)

    // governance §1.7: resolve the effective conversation id.
    //
    // - If the client supplied `conversationId`, verify it exists, is owned by
    //   the caller, and is not soft-deleted (governance §1.3). Collapsed into
    //   404 to avoid leaking ownership.
    // - Otherwise auto-create one now so the caller can thread follow-up
    //   turns through the same id. The title defaults to the first 40
    //   characters of the query (trimmed) — good enough for the sidebar list
    //   UX without forcing the client to pick a title up front.
    let effectiveConversationId: string
    let createdConversation = false

    if (body.conversationId) {
      const visible = await conversationStore.isVisibleForUser({
        conversationId: body.conversationId,
        userProfileId: session.user.id,
      })

      if (!visible) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: '找不到此對話',
        })
      }

      effectiveConversationId = body.conversationId
    } else {
      // persist-refusal-and-label-new-chat: title derivation centralised in
      // `deriveConversationTitleFromQuery`. Audit-blocked queries fall back
      // to the fixed `'無法處理的提問'` label so internal redaction markers
      // never reach the sidebar conversation list.
      const created = await conversationStore.createForUser({
        userProfileId: session.user.id,
        title: deriveConversationTitleFromQuery(body.query),
      })

      effectiveConversationId = created.id
      createdConversation = true
    }

    const aiSearchClient = createCloudflareAiSearchClient({
      aiSearchBinding: getRequiredAiSearchBinding(event),
      instanceId: getRequiredAiSearchInstanceId(runtimeConfig.bindings.aiSearchIndex),
      gatewayConfig: runtimeConfig.aiGateway,
    })
    const workersAiBinding = getRequiredWorkersAiBinding(event)
    const workersAiRuns = createWorkersAiRunRecorder()
    const auditStore = createKnowledgeAuditStore(database)
    const staleResolver = createConversationStaleResolver(database)
    // §S-OB (change rag-query-rewriting): capture rewriter outcome inside
    // the retrieve closure and surface it on auditStore.updateQueryLog so
    // the spec scenario "Successful rewrite records both status and
    // rewritten query" is satisfied. Self-correction retry overrides on
    // the second retrieve call — the audit reflects the LAST retrieve in
    // the chain, which is the one whose evidence shaped the answer.
    let lastRewriterStatus: string = 'disabled'
    let lastRewrittenQuery: string | null = null

    const runChatRequest = (stream?: {
      onTextDelta?: (delta: string) => Promise<void> | void
      signal?: AbortSignal
    }) =>
      chatWithKnowledge(
        {
          auth: {
            // B16 Q2=A: role is the single source of truth. The allowlist
            // already fed `session.user.role` via the better-auth hook
            // (see `server/auth.config.ts`); re-reading the env var here
            // would be both redundant and a regression to the Phase-0
            // two-source model.
            isAdmin: sessionUser.role === 'admin',
            userId: session.user.id,
          },
          conversationId: effectiveConversationId,
          governance: runtimeConfig.governance,
          environment: runtimeConfig.environment,
          query: body.query,
        },
        {
          answer: createWorkersAiAnswerAdapter({
            binding: workersAiBinding,
            onUsage: workersAiRuns.record,
          }),
          persistCitations: createCitationStore(database).persistCitations,
          auditStore: {
            ...auditStore,
            updateQueryLog: auditStore.updateQueryLog
              ? (input) =>
                  auditStore.updateQueryLog({
                    ...input,
                    workersAiRunsJson: workersAiRuns.serialize(),
                    rewriterStatus: lastRewriterStatus,
                    rewrittenQuery: lastRewrittenQuery,
                  })
              : undefined,
          },
          judge: createWorkersAiJudgeAdapter({
            binding: workersAiBinding,
            onUsage: workersAiRuns.record,
          }),
          rateLimitStore: createChatKvRateLimitStore(
            getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv),
          ),
          resolveStaleness: staleResolver.resolveStaleness,
          retrieve: async (input) => {
            const rewriterEnabled =
              input.useRewriter !== false && isQueryRewritingEnabled(runtimeConfig)
            const result = await retrieveVerifiedEvidence(
              {
                allowedAccessLevels: input.allowedAccessLevels,
                query: input.query,
              },
              {
                governance: runtimeConfig.governance,
                rewriter: rewriterEnabled
                  ? (q) =>
                      rewriteForRetrieval(q, {
                        ai: workersAiBinding,
                        runtimeConfig,
                        onUsage: workersAiRuns.record,
                      })
                  : undefined,
                search: aiSearchClient.search,
                store: createKnowledgeEvidenceStore(database),
              },
            )
            lastRewriterStatus = result.rewriterStatus
            lastRewrittenQuery = result.rewrittenQuery
            return result
          },
          ...(stream ? { stream } : {}),
        },
      )

    if (wantsSseResponse(event)) {
      // TD-057: SSE responses span past handler return — Nitro's
      // `afterResponse` hook emits the request's wide event as soon as the
      // Response is constructed, well before the client consumes the stream.
      // Anything written via `log.set` / `log.error` from inside
      // `ReadableStream.start()` lands on a sealed wide event and is
      // dropped with `[evlog] log.X() called after the wide event was
      // emitted` warnings.
      //
      // T3 evlog adoption (adopt-evlog-nuxthub-ai-t3): switched the inline
      // `createRequestLogger` / `runStreamLogDrain` pair to the canonical
      // `forkChildLogger` + `emitChildLogger` helpers from
      // `#server/utils/sse-child-logger`. The parent (request-scoped) wide
      // event still emits normally in `afterResponse` with
      // `operation: 'web-chat'`; the child carries
      // `operation: 'web-chat-sse-stream'` plus `_parentRequestId` for
      // correlation, and owns the `result` / mid-stream `error` fields.
      const streamLog = forkChildLogger<ChatLogFields>(event, {
        operation: 'web-chat-sse-stream',
        user: { id: session.user.id ?? null },
      })

      return createSseChatResponse({
        conversationCreated: createdConversation,
        conversationId: effectiveConversationId,
        execute: runChatRequest,
        log: streamLog,
        onResult: (result) => {
          recordChatResult(streamLog, {
            conversationCreated: createdConversation,
            conversationId: effectiveConversationId,
            result,
          })
          // Surface AI generation telemetry (Workers AI runs collected by
          // the chat pipeline via `workersAiRuns`) onto the child wide
          // event. We pick the dominant generation (longest duration) as
          // the primary `ai.*` summary; per-run detail still lives in the
          // audit log via `workersAiRunsJson`.
          recordPrimaryAiGeneration(streamLog, workersAiRuns.snapshot())
        },
        // T3: emit in try/catch/finally — onStreamSettled already handles
        // both success and error; emitChildLogger is idempotent so a second
        // call (e.g. from createSseChatResponse error path) is a no-op.
        onStreamSettled: ({ error }) =>
          emitChildLogger(event, streamLog, { error: error ?? undefined }),
      })
    }

    const result = await runChatRequest()

    recordChatResult(log, {
      conversationCreated: createdConversation,
      conversationId: effectiveConversationId,
      result,
    })
    recordPrimaryAiGeneration(log, workersAiRuns.snapshot())

    return {
      data: {
        answer: result.answer,
        citations: result.citations,
        conversationId: effectiveConversationId,
        conversationCreated: createdConversation,
        refused: result.refused,
        ...(result.followUp
          ? {
              followUp: {
                conversationId: result.followUp.conversationId,
                forcedFreshRetrieval: result.followUp.forcedFreshRetrieval,
                staleDocumentVersionIds: result.followUp.stale.staleDocumentVersionIds,
              },
            }
          : {}),
      },
    }
  } catch (error) {
    if (error instanceof ChatRateLimitExceededError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
        message: error.message,
      })
    }

    if (error instanceof z.ZodError) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'Invalid chat request',
      })
    }

    if (isHandledError(error)) {
      throw error
    }

    log.error(error as Error, { operation: 'web-chat' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Chat failed',
    })
  }
})

function getRequiredAiSearchBinding(event: {
  context: Record<string, unknown> & { cloudflare?: { env?: Record<string, unknown> } }
}): CloudflareAiSearchBindingLike {
  return requireAiSearchBinding<CloudflareAiSearchBindingLike>(event)
}

function getRequiredWorkersAiBinding(event: {
  context: Record<string, unknown> & { cloudflare?: { env?: Record<string, unknown> } }
}): WorkersAiBindingLike {
  return requireAiBinding<WorkersAiBindingLike>(event, {
    method: 'run',
    message: 'Cloudflare Workers AI binding "AI" is not available',
  })
}

function getRequiredAiSearchInstanceId(instanceId: string): string {
  if (!instanceId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Knowledge AI Search instance id is not configured',
    })
  }

  return instanceId
}

function isHandledError(error: unknown): error is { statusCode: number } {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}

function wantsSseResponse(event: { headers?: Headers }): boolean {
  return event.headers?.get('accept')?.includes('text/event-stream') ?? false
}

function recordChatResult(
  log: RequestLogger<ChatLogFields>,
  input: {
    conversationCreated: boolean
    conversationId: string
    result: Awaited<ReturnType<typeof chatWithKnowledge>>
  },
) {
  log.set({
    result: {
      conversationId: input.conversationId,
      conversationCreated: input.conversationCreated,
      citationCount: input.result.citations.length,
      refused: input.result.refused,
      followUpForcedFreshRetrieval: input.result.followUp?.forcedFreshRetrieval ?? false,
    },
  })
}

/**
 * T3 evlog adoption: pick the dominant Workers AI run (longest latency, by
 * convention the answer-generation call) and surface it as the primary
 * `ai.*` summary on the wide event. Returns silently when no runs were
 * recorded (e.g. fail-fast on auth / rate-limit before reaching the model).
 *
 * Per-run detail (judge / answer / rewriter together) still lives in the
 * audit row via `workersAiRunsJson` — wide event only carries the
 * highest-cost slice so dashboards aggregate cleanly.
 */
function recordPrimaryAiGeneration(
  log: RequestLogger<ChatLogFields>,
  runs: readonly {
    latencyMs: number
    model: string
    modelRole: string
    usage: {
      cachedPromptTokens: number | null
      completionTokens: number | null
      promptTokens: number | null
      totalTokens: number | null
    } | null
  }[],
) {
  const [first, ...rest] = runs
  if (!first) return
  const primary = rest.reduce((acc, r) => (r.latencyMs > acc.latencyMs ? r : acc), first)
  recordAIGeneration(log as unknown as Parameters<typeof recordAIGeneration>[0], {
    provider: 'workers-ai',
    model: primary.model,
    promptTokens: primary.usage?.promptTokens ?? undefined,
    completionTokens: primary.usage?.completionTokens ?? undefined,
    durationMs: primary.latencyMs,
    cached: (primary.usage?.cachedPromptTokens ?? 0) > 0,
    // Workers AI free tier — cost stays at undefined; PRICING table in
    // ai-logger.ts maps `@cf/...` models to 0 explicitly. Once we move to
    // paid tier, `estimateCostUsd(primary.model, primary.usage)` is the
    // one-line swap-in.
  })
}
