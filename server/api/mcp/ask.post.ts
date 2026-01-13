import { useLogger } from 'evlog'
import { z } from 'zod'

import { createCloudflareAiSearchClient, type CloudflareAiBindingLike } from '../../utils/ai-search'
import { createKnowledgeAuditStore } from '../../utils/knowledge-audit'
import { createCitationStore } from '../../utils/citation-store'
import {
  getCloudflareEnv,
  getRequiredD1Binding,
  getRequiredKvBinding,
} from '../../utils/cloudflare-bindings'
import { createKnowledgeEvidenceStore } from '../../utils/knowledge-evidence-store'
import { retrieveVerifiedEvidence } from '../../utils/knowledge-retrieval'
import { getKnowledgeRuntimeConfig } from '../../utils/knowledge-runtime'
import { askKnowledge, createMcpQueryLogStore } from '../../utils/mcp-ask'
import { McpAuthError, requireMcpBearerToken, requireMcpScope } from '../../utils/mcp-auth'
import {
  consumeMcpToolRateLimit,
  createKvRateLimitStore,
  McpRateLimitExceededError,
} from '../../utils/mcp-rate-limit'
import { createMcpTokenStore } from '../../utils/mcp-token-store'
import { readZodBody } from '../../utils/read-zod-body'

const askKnowledgeSchema = z
  .object({
    query: z.string().trim().min(1, 'query is required').max(4000, 'query is too long'),
  })
  .strict()

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  assertStatelessMcpRequest(event)

  try {
    const runtimeConfig = getKnowledgeRuntimeConfig()
    const database = getRequiredD1Binding(event, runtimeConfig.bindings.d1Database)
    const tokenStore = createMcpTokenStore(database)
    const auth = await requireMcpBearerToken(
      {
        headers: getRequestHeaders(event),
      },
      {
        environment: runtimeConfig.environment,
        store: tokenStore,
      }
    )

    requireMcpScope(auth, 'knowledge.ask')

    await consumeMcpToolRateLimit({
      environment: runtimeConfig.environment,
      store: createKvRateLimitStore(
        getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)
      ),
      tokenId: auth.tokenId,
      tool: 'askKnowledge',
    })

    const body = await readZodBody(event, askKnowledgeSchema)
    const aiSearchClient = createCloudflareAiSearchClient({
      aiBinding: getRequiredAiBinding(event),
      indexName: getRequiredAiSearchIndex(runtimeConfig.bindings.aiSearchIndex),
    })
    const evidenceStore = createKnowledgeEvidenceStore(database)
    const result = await askKnowledge(
      {
        auth,
        environment: runtimeConfig.environment,
        query: body.query,
      },
      {
        answer: createFallbackAnswer,
        auditStore: createKnowledgeAuditStore(database),
        citationStore: createCitationStore(database),
        judge: createFallbackJudge,
        queryLogStore: createMcpQueryLogStore(database),
        retrieve: (input) =>
          retrieveVerifiedEvidence(input, {
            search: aiSearchClient.search,
            store: evidenceStore,
          }),
      }
    )

    return {
      data: result,
    }
  } catch (error) {
    if (error instanceof McpAuthError || error instanceof McpRateLimitExceededError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
        message: error.message,
      })
    }

    if (isHttpError(error)) {
      throw error
    }

    log.error(error as Error, { operation: 'mcp-ask' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'askKnowledge failed',
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

function assertStatelessMcpRequest(event: { headers: Headers }) {
  const sessionHeader = event.headers.get('mcp-session-id') ?? event.headers.get('MCP-Session-Id')

  if (sessionHeader) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'MCP session state is not supported in v1.0.0',
    })
  }
}

function getRequestHeaders(event: { headers: Headers }): Record<string, string | undefined> {
  return Object.fromEntries(event.headers.entries())
}

function isHttpError(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}
