import { z } from 'zod'

import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import {
  buildChatGptClientMetadataUrl,
  isAllowedChatGptConnectorRedirectUri,
  normalizeChatGptRedirectUris,
} from '#server/utils/mcp-chatgpt-registration'
import { MCP_OAUTH_SCOPES } from '#server/utils/mcp-oauth-metadata'
import {
  consumeMcpPublicRateLimit,
  createKvRateLimitStore,
  McpRateLimitExceededError,
} from '#server/utils/mcp-rate-limit'
import { resolveClientIp } from '#server/utils/request-ip'

// RFC 7591 §2: clients may send extra metadata fields; the server only consumes
// the ones it understands, so unknown keys are stripped silently (Zod default).
const requestSchema = z.object({
  client_name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    // Reject C0 / DEL control characters in reflected user input — intentional.
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\x00-\x1f\x7f]*$/, 'client_name must not contain control characters')
    .optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
})

export default defineEventHandler(async function mcpRegisterHandler(event) {
  const knowledgeRuntimeConfig = getKnowledgeRuntimeConfig()
  const kv = getRequiredKvBinding(event, knowledgeRuntimeConfig.bindings.rateLimitKv)

  try {
    await consumeMcpPublicRateLimit({
      environment: knowledgeRuntimeConfig.environment,
      ip: resolveClientIp(event),
      operation: 'registerClient',
      store: createKvRateLimitStore(kv),
    })
  } catch (error) {
    if (error instanceof McpRateLimitExceededError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: 'Too Many Requests',
        message: error.message,
      })
    }

    throw error
  }

  const rawBody = (await readBody(event).catch(() => ({}))) ?? {}
  const parsedBody = requestSchema.safeParse(rawBody)

  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid MCP dynamic client registration request',
    })
  }

  const redirectUris = normalizeChatGptRedirectUris(parsedBody.data.redirect_uris)

  if (!redirectUris.every(isAllowedChatGptConnectorRedirectUri)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'ChatGPT connector redirect URI is not allowed',
    })
  }

  const clientName = parsedBody.data.client_name
  const clientId = buildChatGptClientMetadataUrl(event, {
    clientName,
    redirectUris,
  })

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    grant_types: ['authorization_code'],
    redirect_uris: redirectUris,
    response_types: ['code'],
    scope: MCP_OAUTH_SCOPES.join(' '),
    token_endpoint_auth_method: 'none',
  }
})
