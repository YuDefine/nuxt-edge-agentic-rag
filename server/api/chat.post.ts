import { useLogger } from 'evlog'
import { z } from 'zod'

import { createCloudflareAiSearchClient, type CloudflareAiBindingLike } from '../utils/ai-search'
import {
  getCloudflareEnv,
  getRequiredD1Binding,
  getRequiredKvBinding,
} from '../utils/cloudflare-bindings'
import { createKnowledgeAuditStore } from '../utils/knowledge-audit'
import { createKnowledgeEvidenceStore } from '../utils/knowledge-evidence-store'
import { retrieveVerifiedEvidence } from '../utils/knowledge-retrieval'
import { getKnowledgeRuntimeConfig, getRuntimeAdminAccess } from '../utils/knowledge-runtime'
import {
  ChatRateLimitExceededError,
  chatWithKnowledge,
  createChatKvRateLimitStore,
} from '../utils/web-chat'

const chatBodySchema = z
  .object({
    query: z.string().trim().min(1, 'query is required').max(4000, 'query is too long'),
  })
  .strict()

export default defineEventHandler(async function chatHandler(event) {
  const log = useLogger(event)

  try {
    const session = await requireUserSession(event)
    log.set({
      operation: 'web-chat',
      user: {
        id: session.user.id ?? null,
      },
    })

    const body = await readValidatedBody(event, chatBodySchema.parse)
    const runtimeConfig = getKnowledgeRuntimeConfig()
    const database = getRequiredD1Binding(event, runtimeConfig.bindings.d1Database)
    const aiSearchClient = createCloudflareAiSearchClient({
      aiBinding: getRequiredAiBinding(event),
      indexName: getRequiredAiSearchIndex(runtimeConfig.bindings.aiSearchIndex),
    })
    const result = await chatWithKnowledge(
      {
        auth: {
          isAdmin: getRuntimeAdminAccess(session.user.email ?? null),
          userId: session.user.id,
        },
        environment: runtimeConfig.environment,
        query: body.query,
      },
      {
        answer: createFallbackAnswer,
        auditStore: createKnowledgeAuditStore(database),
        judge: createFallbackJudge,
        rateLimitStore: createChatKvRateLimitStore(
          getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)
        ),
        retrieve: (input) =>
          retrieveVerifiedEvidence(input, {
            search: aiSearchClient.search,
            store: createKnowledgeEvidenceStore(database),
          }),
      }
    )

    log.set({
      result: {
        citationCount: result.citations.length,
        refused: result.refused,
      },
    })

    return {
      data: {
        answer: result.answer,
        citations: result.citations,
        refused: result.refused,
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

async function createFallbackAnswer(input: {
  evidence: Array<{
    chunkText: string
    documentTitle: string
  }>
  modelRole: string
  query: string
  retrievalScore: number
}): Promise<string> {
  const uniqueSnippets = [
    ...new Set(input.evidence.map((item) => item.chunkText.trim()).filter(Boolean)),
  ].slice(0, 3)

  if (uniqueSnippets.length === 0) {
    return ''
  }

  if (uniqueSnippets.length === 1) {
    return uniqueSnippets[0] ?? ''
  }

  return uniqueSnippets.join('\n\n')
}

async function createFallbackJudge(input: {
  evidence: Array<unknown>
  query: string
  retrievalScore: number
}): Promise<{
  reformulatedQuery?: string
  shouldAnswer: boolean
}> {
  return {
    shouldAnswer: input.evidence.length > 0 && input.retrievalScore >= 0.55,
  }
}

function getRequiredAiBinding(event: {
  context: Record<string, unknown> & { cloudflare?: { env?: Record<string, unknown> } }
}): CloudflareAiBindingLike {
  const binding = getCloudflareEnv(event).AI

  if (!binding || typeof (binding as { autorag?: unknown }).autorag !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Cloudflare AI binding "AI" is not available',
    })
  }

  return binding as CloudflareAiBindingLike
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
