import { z } from 'zod'

import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import {
  resolveMcpConnectorClient,
  McpConnectorClientConfigError,
} from '#server/utils/mcp-connector-clients'
import { createMcpOauthGrantStore, McpOauthGrantError } from '#server/utils/mcp-oauth-grants'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'

const requestSchema = z
  .object({
    approved: z.boolean(),
    clientId: z.string().trim().min(1),
    redirectUri: z.string().url(),
    scope: z.string().trim().min(1),
    state: z.string().trim().min(1).nullable().optional(),
  })
  .strict()

export default defineEventHandler(async function mcpAuthorizePostHandler(event) {
  const session = await requireUserSession(event)
  const rawBody = (await readBody(event).catch(() => ({}))) ?? {}
  const parsedBody = requestSchema.safeParse(rawBody)

  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid MCP authorization request',
    })
  }

  if (!parsedBody.data.approved) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Authorization was denied by the current user',
    })
  }

  const knowledgeRuntimeConfig = getKnowledgeRuntimeConfig()

  try {
    const client = resolveMcpConnectorClient(
      {
        clientId: parsedBody.data.clientId,
        redirectUri: parsedBody.data.redirectUri,
        requestedScopes: parsedBody.data.scope.split(/\s+/).filter(Boolean),
      },
      knowledgeRuntimeConfig,
    )
    const kv = getRequiredKvBinding(event, knowledgeRuntimeConfig.bindings.rateLimitKv)
    const grants = createMcpOauthGrantStore({
      accessTokenTtlSeconds: knowledgeRuntimeConfig.mcpConnectors.oauth.accessTokenTtlSeconds,
      authorizationCodeTtlSeconds:
        knowledgeRuntimeConfig.mcpConnectors.oauth.authorizationCodeTtlSeconds,
      kv,
    })
    const code = await grants.issueAuthorizationCode({
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      scopes: client.grantedScopes,
      userId: session.user.id,
    })

    return {
      data: {
        clientId: client.clientId,
        code,
        redirectUri: client.redirectUri,
        state: parsedBody.data.state ?? null,
      },
    }
  } catch (error) {
    if (error instanceof McpConnectorClientConfigError || error instanceof McpOauthGrantError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: 'Bad Request',
        message: error.message,
      })
    }

    throw error
  }
})
