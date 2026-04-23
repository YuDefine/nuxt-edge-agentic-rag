import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import {
  isAllowedChatGptConnectorRedirectUri,
  normalizeChatGptRedirectUris,
} from '#server/utils/mcp-chatgpt-registration'
import {
  consumeMcpPublicRateLimit,
  createKvRateLimitStore,
  McpRateLimitExceededError,
} from '#server/utils/mcp-rate-limit'
import { resolveClientIp } from '#server/utils/request-ip'

const CLIENT_NAME_MAX_LENGTH = 120
// Reject C0 / DEL control characters in reflected user input — intentional.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/

function readQueryValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }

  return typeof value === 'string' ? [value] : []
}

function sanitizeClientName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }

  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > CLIENT_NAME_MAX_LENGTH || CONTROL_CHAR_PATTERN.test(trimmed)) {
    return undefined
  }

  return trimmed
}

export default defineEventHandler(async function chatGptClientMetadataHandler(event) {
  const knowledgeRuntimeConfig = getKnowledgeRuntimeConfig()
  const kv = getRequiredKvBinding(event, knowledgeRuntimeConfig.bindings.rateLimitKv)

  try {
    await consumeMcpPublicRateLimit({
      environment: knowledgeRuntimeConfig.environment,
      ip: resolveClientIp(event),
      operation: 'chatGptMetadata',
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

  const query = getQuery(event)
  const redirectUris = normalizeChatGptRedirectUris(readQueryValues(query.redirect_uri))

  if (redirectUris.length === 0 || !redirectUris.every(isAllowedChatGptConnectorRedirectUri)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'ChatGPT connector redirect URI is not allowed',
    })
  }

  const clientName = sanitizeClientName(query.client_name)
  const canonicalUrl = new URL('/api/auth/mcp/chatgpt-client-metadata', getRequestURL(event).origin)
  for (const uri of redirectUris) {
    canonicalUrl.searchParams.append('redirect_uri', uri)
  }
  if (clientName) {
    canonicalUrl.searchParams.set('client_name', clientName)
  }

  return {
    client_id: canonicalUrl.toString(),
    client_name: clientName ?? 'ChatGPT Connector',
    redirect_uris: redirectUris,
  }
})
