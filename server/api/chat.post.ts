import { useLogger, type RequestLogger } from 'evlog'
import { z } from 'zod'

import {
  createCloudflareAiSearchClient,
  type CloudflareAiBindingLike,
} from '#server/utils/ai-search'
import { requireAiBinding } from '#server/utils/ai-binding'
import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getD1Database } from '#server/utils/database'
import { createCitationStore } from '#server/utils/citation-store'
import { createConversationStaleResolver } from '#server/utils/conversation-stale-resolver'
import { createConversationStore } from '#server/utils/conversation-store'
import { auditKnowledgeText, createKnowledgeAuditStore } from '#server/utils/knowledge-audit'
import { createKnowledgeEvidenceStore } from '#server/utils/knowledge-evidence-store'
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

const chatBodySchema = z
  .object({
    query: z.string().trim().min(1, 'query is required').max(4000, 'query is too long'),
    conversationId: z.string().uuid().optional(),
  })
  .strict()

const CHAT_STREAM_CONTENT_TYPE = 'text/event-stream; charset=utf-8'

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
      // Derive title from the redacted copy, not the raw query, so that
      // credential / PII fragments never land on conversations.title.
      // Empty-string fallback lets the store apply its DEFAULT_TITLE.
      const titleSource = auditKnowledgeText(body.query).redactedText
      const derivedTitle = titleSource.trim().slice(0, 40)
      const created = await conversationStore.createForUser({
        userProfileId: session.user.id,
        title: derivedTitle,
      })

      effectiveConversationId = created.id
      createdConversation = true
    }

    const aiSearchClient = createCloudflareAiSearchClient({
      aiBinding: getRequiredAiSearchBinding(event),
      indexName: getRequiredAiSearchIndex(runtimeConfig.bindings.aiSearchIndex),
      gatewayConfig: runtimeConfig.aiGateway,
    })
    const workersAiBinding = getRequiredWorkersAiBinding(event)
    const workersAiRuns = createWorkersAiRunRecorder()
    const auditStore = createKnowledgeAuditStore(database)
    const staleResolver = createConversationStaleResolver(database)
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
          retrieve: (input) =>
            retrieveVerifiedEvidence(input, {
              governance: runtimeConfig.governance,
              search: aiSearchClient.search,
              store: createKnowledgeEvidenceStore(database),
            }),
          ...(stream ? { stream } : {}),
        },
      )

    if (wantsSseResponse(event)) {
      return createSseChatResponse({
        conversationCreated: createdConversation,
        conversationId: effectiveConversationId,
        execute: runChatRequest,
        log,
      })
    }

    const result = await runChatRequest()

    recordChatResult(log, {
      conversationCreated: createdConversation,
      conversationId: effectiveConversationId,
      result,
    })

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
}): CloudflareAiBindingLike {
  return requireAiBinding<CloudflareAiBindingLike>(event, {
    method: 'autorag',
    message: 'Cloudflare AI binding "AI" is not available',
  })
}

function getRequiredWorkersAiBinding(event: {
  context: Record<string, unknown> & { cloudflare?: { env?: Record<string, unknown> } }
}): WorkersAiBindingLike {
  return requireAiBinding<WorkersAiBindingLike>(event, {
    method: 'run',
    message: 'Cloudflare Workers AI binding "AI" is not available',
  })
}

function getRequiredAiSearchIndex(indexName: string): string {
  if (!indexName) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Knowledge AI Search index is not configured',
    })
  }

  return indexName
}

function isHandledError(error: unknown): error is { statusCode: number } {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}

function wantsSseResponse(event: { headers?: Headers }): boolean {
  return event.headers?.get('accept')?.includes('text/event-stream') ?? false
}

function createSseChatResponse(input: {
  conversationCreated: boolean
  conversationId: string
  execute: (stream: {
    onTextDelta?: (delta: string) => Promise<void> | void
    signal?: AbortSignal
  }) => ReturnType<typeof chatWithKnowledge>
  log: ReturnType<typeof useLogger>
}): Response {
  const encoder = new TextEncoder()
  const abortController = new AbortController()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const close = () => {
        if (!closed) {
          controller.close()
          closed = true
        }
      }
      const enqueue = (event: string, data: Record<string, unknown>) => {
        if (closed) {
          return
        }
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        enqueue('ready', {
          conversationCreated: input.conversationCreated,
          conversationId: input.conversationId,
        })

        const result = await input.execute({
          onTextDelta: (delta) => {
            enqueue('delta', { content: delta })
          },
          signal: abortController.signal,
        })

        recordChatResult(input.log, {
          conversationCreated: input.conversationCreated,
          conversationId: input.conversationId,
          result,
        })

        if (result.refused) {
          enqueue('refusal', {
            answer: null,
            citations: [],
            conversationCreated: input.conversationCreated,
            conversationId: input.conversationId,
            refused: true,
          })
        } else {
          enqueue('complete', {
            answer: result.answer,
            citations: result.citations,
            conversationCreated: input.conversationCreated,
            conversationId: input.conversationId,
            refused: false,
          })
        }
      } catch (error) {
        if (!isAbortError(error)) {
          input.log.error(error as Error, { operation: 'web-chat-stream' })
          enqueue('error', { message: '發生錯誤，請稍後再試' })
        }
      } finally {
        close()
      }
    },
    cancel() {
      abortController.abort(createAbortError())
    },
  })

  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': CHAT_STREAM_CONTENT_TYPE,
    },
  })
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

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

function createAbortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}
