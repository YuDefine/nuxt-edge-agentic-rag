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

defineRouteMeta({
  openAPI: {
    tags: ['mcp-oauth'],
    summary: 'MCP OAuth 2.0 授權端點（GET）',
    description:
      'OAuth 2.0 Authorization Code Flow 授權頁。需先登入；驗證 client_id、redirect_uri 與 scope 後產生授權碼。',
    parameters: [
      { in: 'query', name: 'client_id', required: true, schema: { type: 'string' } },
      {
        in: 'query',
        name: 'redirect_uri',
        required: true,
        schema: { type: 'string', format: 'uri' },
      },
      {
        in: 'query',
        name: 'response_type',
        required: true,
        schema: { type: 'string', enum: ['code'] },
      },
      { in: 'query', name: 'state', required: false, schema: { type: 'string' } },
      { in: 'query', name: 'scope', required: false, schema: { type: 'string' } },
      { in: 'query', name: 'code_challenge', required: false, schema: { type: 'string' } },
      {
        in: 'query',
        name: 'code_challenge_method',
        required: false,
        schema: { type: 'string', enum: ['S256'] },
      },
    ],
    responses: {
      '302': { description: '導向 redirect_uri 並附帶 authorization code。' },
      '400': { description: 'client_id / redirect_uri / scope 不合法。' },
      '401': { description: '未登入。' },
      '403': { description: '使用者無 MCP 連線權限（受訪客政策影響）。' },
    },
  },
})

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
