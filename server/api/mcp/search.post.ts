import { useLogger } from 'evlog'
import { z } from 'zod'

import { createCloudflareAiSearchClient } from '#server/utils/ai-search'
import { getCloudflareEnv, getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getD1Database } from '#server/utils/database'
import { createKnowledgeEvidenceStore } from '#server/utils/knowledge-evidence-store'
import { retrieveVerifiedEvidence } from '#server/utils/knowledge-retrieval'
import { getAllowedAccessLevels, getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { McpAuthError, requireMcpBearerToken, requireMcpScope } from '#server/utils/mcp-auth'
import {
  consumeMcpToolRateLimit,
  createKvRateLimitStore,
  McpRateLimitExceededError,
} from '#server/utils/mcp-rate-limit'
import { searchKnowledge } from '#server/utils/mcp-search'
import { createMcpTokenStore } from '#server/utils/mcp-token-store'

const searchKnowledgeBodySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'query is required')
    .max(2000, 'query must be 2000 characters or fewer'),
})

export default defineEventHandler(async function searchKnowledgeHandler(event) {
  const log = useLogger(event)

  try {
    const body = await readValidatedBody(event, searchKnowledgeBodySchema.parse)
    const runtimeConfig = getKnowledgeRuntimeConfig()
    const database = await getD1Database()
    const auth = await requireMcpBearerToken(
      {
        headers: getRequestHeaders(event),
      },
      {
        environment: runtimeConfig.environment,
        store: createMcpTokenStore(database),
      }
    )

    requireMcpScope(auth, 'knowledge.search')

    await consumeMcpToolRateLimit({
      environment: runtimeConfig.environment,
      store: createKvRateLimitStore(
        getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)
      ),
      tokenId: auth.tokenId,
      tool: 'searchKnowledge',
    })

    const allowedAccessLevels = getAllowedAccessLevels({
      channel: 'mcp',
      isAuthenticated: true,
      tokenScopes: auth.scopes,
    })

    const aiBinding = getRequiredAiBinding(event)
    const result = await searchKnowledge(
      {
        allowedAccessLevels,
        query: body.query,
      },
      {
        retrieve: (input) =>
          retrieveVerifiedEvidence(input, {
            governance: runtimeConfig.governance,
            search: createCloudflareAiSearchClient({
              aiBinding,
              indexName: runtimeConfig.bindings.aiSearchIndex,
            }).search,
            store: createKnowledgeEvidenceStore(database),
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
        statusMessage: error.name,
        message: error.message,
      })
    }

    if (isHandledError(error)) {
      throw error
    }

    log.error(error as Error, { tool: 'searchKnowledge' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Search failed',
    })
  }
})

function getRequiredAiBinding(event: {
  context: Record<string, unknown> & { cloudflare?: { env?: Record<string, unknown> } }
}): {
  autorag(indexName: string): {
    search(input: {
      filters: Record<string, unknown>
      max_num_results: number
      query: string
      ranking_options: {
        score_threshold: number
      }
      rewrite_query: boolean
    }): Promise<{
      data?: Array<{
        attributes?: {
          file?: Record<string, unknown>
        }
        content?: Array<{
          text?: string
          type?: string
        }>
        filename?: string
        score?: number
      }>
    }>
  }
} {
  const binding = getCloudflareEnv(event).AI

  if (!binding || typeof (binding as { autorag?: unknown }).autorag !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Cloudflare AI binding "AI" is not available',
    })
  }

  return binding as {
    autorag(indexName: string): {
      search(input: {
        filters: Record<string, unknown>
        max_num_results: number
        query: string
        ranking_options: {
          score_threshold: number
        }
        rewrite_query: boolean
      }): Promise<{
        data?: Array<{
          attributes?: {
            file?: Record<string, unknown>
          }
          content?: Array<{
            text?: string
            type?: string
          }>
          filename?: string
          score?: number
        }>
      }>
    }
  }
}

function isHandledError(error: unknown): error is { statusCode: number } {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}

function getRequestHeaders(event: { headers: Headers }): Record<string, string | undefined> {
  return Object.fromEntries(event.headers.entries())
}
