import { useLogger } from 'evlog'
import { z } from 'zod'

import { getRequiredKvBinding } from '../../../utils/cloudflare-bindings'
import { getD1Database } from '../../../utils/database'
import { getKnowledgeRuntimeConfig } from '../../../utils/knowledge-runtime'
import { McpAuthError, requireMcpBearerToken, requireMcpScope } from '../../../utils/mcp-auth'
import {
  consumeMcpToolRateLimit,
  createKvRateLimitStore,
  McpRateLimitExceededError,
} from '../../../utils/mcp-rate-limit'
import { createMcpReplayStore, getDocumentChunk, McpReplayError } from '../../../utils/mcp-replay'
import { createMcpTokenStore } from '../../../utils/mcp-token-store'

const citationParamsSchema = z.object({
  citationId: z.string().trim().min(1, 'citationId is required'),
})

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  assertStatelessMcpRequest(event)

  try {
    const runtimeConfig = getKnowledgeRuntimeConfig()
    const database = await getD1Database()
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

    requireMcpScope(auth, 'knowledge.citation.read')

    await consumeMcpToolRateLimit({
      environment: runtimeConfig.environment,
      store: createKvRateLimitStore(
        getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)
      ),
      tokenId: auth.tokenId,
      tool: 'getDocumentChunk',
    })

    const params = parseCitationParams(event.context.params ?? {})
    const result = await getDocumentChunk(
      {
        auth,
        citationId: params.citationId,
      },
      {
        replayStore: createMcpReplayStore(database),
      }
    )

    return {
      data: result,
    }
  } catch (error) {
    if (
      error instanceof McpAuthError ||
      error instanceof McpReplayError ||
      error instanceof McpRateLimitExceededError
    ) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
        message: error.message,
      })
    }

    if (isHttpError(error)) {
      throw error
    }

    log.error(error as Error, { operation: 'mcp-replay' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'getDocumentChunk failed',
    })
  }
})

function parseCitationParams(input: Record<string, unknown>) {
  const result = citationParamsSchema.safeParse(input)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: result.error.issues[0]?.message ?? 'citationId is required',
    })
  }

  return result.data
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
