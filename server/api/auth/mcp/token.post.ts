import { z } from 'zod'

import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { createMcpOauthGrantStore, McpOauthGrantError } from '#server/utils/mcp-oauth-grants'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'

const requestSchema = z
  .object({
    code: z.string().trim().min(1),
    codeVerifier: z.string().trim().min(1).optional(),
    grantType: z.literal('authorization_code'),
    clientId: z.string().trim().min(1),
    redirectUri: z.string().url(),
    resource: z.string().url().optional(),
  })
  .passthrough()

defineRouteMeta({
  openAPI: {
    tags: ['mcp-oauth'],
    summary: 'MCP OAuth 2.0 Token 端點',
    description:
      'OAuth 2.0 Authorization Code Flow token 換發端點。以 authorization_code grant 換取 Bearer access_token，後續用於 /mcp streaming endpoint 的 Authorization header。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['code', 'grantType', 'clientId', 'redirectUri'],
            properties: {
              code: { type: 'string', description: 'Authorization code（authorize 端點回傳）。' },
              codeVerifier: { type: 'string', description: 'PKCE verifier；可選。' },
              grantType: { type: 'string', enum: ['authorization_code'] },
              clientId: { type: 'string' },
              redirectUri: { type: 'string', format: 'uri' },
              resource: {
                type: 'string',
                format: 'uri',
                description: 'RFC 8707 resource indicator。',
              },
            },
          } as never,
        },
      },
    },
    responses: {
      '200': { description: '回傳 { access_token, token_type, expires_in, scope }。' },
      '400': { description: 'code 過期、不存在，或 PKCE 驗證失敗。' },
      '401': { description: 'client_id 不存在或 redirect_uri 不匹配。' },
    },
  },
})

export default defineEventHandler(async function mcpTokenHandler(event) {
  const rawBody = (await readBody(event).catch(() => ({}))) ?? {}
  const normalizedBody = {
    code: rawBody.code,
    codeVerifier: rawBody.codeVerifier ?? rawBody.code_verifier,
    grantType: rawBody.grantType ?? rawBody.grant_type,
    clientId: rawBody.clientId ?? rawBody.client_id,
    redirectUri: rawBody.redirectUri ?? rawBody.redirect_uri,
    resource: rawBody.resource,
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
      codeVerifier: parsedBody.data.codeVerifier,
      redirectUri: parsedBody.data.redirectUri,
      resource: parsedBody.data.resource,
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
