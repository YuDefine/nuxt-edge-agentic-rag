import { z } from 'zod'

import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { createMcpOauthGrantStore, McpOauthGrantError } from '#server/utils/mcp-oauth-grants'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'

const requestSchema = z
  .object({
    code: z.string().trim().min(1),
    grantType: z.literal('authorization_code'),
    clientId: z.string().trim().min(1),
    redirectUri: z.string().url(),
  })
  .strict()

export default defineEventHandler(async function mcpTokenHandler(event) {
  const rawBody = (await readBody(event).catch(() => ({}))) ?? {}
  const normalizedBody = {
    code: rawBody.code,
    grantType: rawBody.grantType ?? rawBody.grant_type,
    clientId: rawBody.clientId ?? rawBody.client_id,
    redirectUri: rawBody.redirectUri ?? rawBody.redirect_uri,
  }
  const parsedBody = requestSchema.safeParse(normalizedBody)

  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid MCP token request',
    })
  }

  const knowledgeRuntimeConfig = getKnowledgeRuntimeConfig()
  const kv = getRequiredKvBinding(event, knowledgeRuntimeConfig.bindings.rateLimitKv)
  const grants = createMcpOauthGrantStore({
    accessTokenTtlSeconds: knowledgeRuntimeConfig.mcpConnectors.oauth.accessTokenTtlSeconds,
    authorizationCodeTtlSeconds:
      knowledgeRuntimeConfig.mcpConnectors.oauth.authorizationCodeTtlSeconds,
    kv,
  })

  try {
    const token = await grants.exchangeAuthorizationCode({
      clientId: parsedBody.data.clientId,
      code: parsedBody.data.code,
      redirectUri: parsedBody.data.redirectUri,
    })

    return {
      access_token: token.accessToken,
      token_type: token.tokenType,
      expires_in: token.expiresIn,
      scope: token.scope,
    }
  } catch (error) {
    if (error instanceof McpOauthGrantError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: 'Bad Request',
        message: error.message,
      })
    }

    throw error
  }
})
