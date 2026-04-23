import {
  resolveMcpConnectorClientAsync,
  McpConnectorClientConfigError,
} from '#server/utils/mcp-connector-clients'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'

function requireQueryValue(value: unknown, fieldName: string): string {
  const normalized = Array.isArray(value) ? value[0] : value

  if (typeof normalized !== 'string' || normalized.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `Missing required query parameter: ${fieldName}`,
    })
  }

  return normalized.trim()
}

export default defineEventHandler(async function mcpAuthorizeHandler(event) {
  const session = await requireUserSession(event)
  if (!session.user.id) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'MCP authorization requires a local account',
    })
  }
  const query = getQuery(event)
  const knowledgeRuntimeConfig = getKnowledgeRuntimeConfig()

  try {
    const client = await resolveMcpConnectorClientAsync(
      {
        clientId: requireQueryValue(query.client_id, 'client_id'),
        redirectUri: requireQueryValue(query.redirect_uri, 'redirect_uri'),
        requestedScopes: requireQueryValue(query.scope, 'scope').split(/\s+/).filter(Boolean),
      },
      knowledgeRuntimeConfig,
    )

    return {
      data: {
        clientId: client.clientId,
        clientName: client.name,
        grantedScopes: client.grantedScopes,
        redirectUri: client.redirectUri,
        state: typeof query.state === 'string' ? query.state : null,
        userId: session.user.id,
      },
    }
  } catch (error) {
    if (error instanceof McpConnectorClientConfigError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: 'Bad Request',
        message: error.message,
      })
    }

    throw error
  }
})
