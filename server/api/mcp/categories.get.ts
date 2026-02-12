import { useLogger } from 'evlog'
import { z } from 'zod'

import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getD1Database } from '#server/utils/database'
import { getAllowedAccessLevels, getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { createMcpCategoryStore, listCategories } from '#server/utils/mcp-categories'
import { McpAuthError, requireMcpBearerToken, requireMcpScope } from '#server/utils/mcp-auth'
import {
  consumeMcpToolRateLimit,
  createKvRateLimitStore,
  McpRateLimitExceededError,
} from '#server/utils/mcp-rate-limit'
import { createMcpTokenStore } from '#server/utils/mcp-token-store'

const listCategoriesQuerySchema = z.object({
  includeCounts: z.preprocess((value) => {
    const normalizedValue = Array.isArray(value) ? value[0] : value

    return normalizedValue === true || normalizedValue === 'true'
  }, z.boolean()),
})

export default defineEventHandler(async function listCategoriesHandler(event) {
  const log = useLogger(event)

  try {
    const query = await getValidatedQuery(event, listCategoriesQuerySchema.parse)
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

    requireMcpScope(auth, 'knowledge.category.list')

    await consumeMcpToolRateLimit({
      environment: runtimeConfig.environment,
      store: createKvRateLimitStore(
        getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)
      ),
      tokenId: auth.tokenId,
      tool: 'listCategories',
    })

    const allowedAccessLevels = getAllowedAccessLevels({
      channel: 'mcp',
      isAuthenticated: true,
      tokenScopes: auth.scopes,
    })

    return {
      data: await listCategories(
        {
          allowedAccessLevels,
          includeCounts: query.includeCounts,
        },
        {
          store: createMcpCategoryStore(database),
        }
      ),
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

    log.error(error as Error, { tool: 'listCategories' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Category lookup failed',
    })
  }
})

function isHandledError(error: unknown): error is { statusCode: number } {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}

function getRequestHeaders(event: { headers: Headers }): Record<string, string | undefined> {
  return Object.fromEntries(event.headers.entries())
}
