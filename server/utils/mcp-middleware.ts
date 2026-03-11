import type { H3Event } from 'h3'

import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { McpAuthError, requireMcpBearerToken } from '#server/utils/mcp-auth'
import {
  consumeMcpToolRateLimit,
  createKvRateLimitStore,
  McpRateLimitExceededError,
} from '#server/utils/mcp-rate-limit'
import {
  createDefaultUserRoleLookup,
  gateMcpToolAccess,
  McpRoleGateError,
} from '#server/utils/mcp-role-gate'
import { FIXED_WINDOW_RATE_LIMIT_PRESETS } from '#server/utils/rate-limiter'

import type { McpTokenRecord } from '#shared/types/knowledge'

export interface McpTokenStoreLike {
  findUsableTokenByHash(tokenHash: string, environment: string): Promise<McpTokenRecord | null>
  touchLastUsedAt(tokenId: string, usedAt: string): Promise<void>
}

export interface McpAuthContext {
  scopes: string[]
  token: McpTokenRecord
  tokenId: string
}

export interface UserRoleLookupLike {
  lookupRoleByUserId(userId: string): Promise<'admin' | 'member' | 'guest' | null>
}

export interface RunMcpMiddlewareDeps {
  environment: string
  extractToolNames: (event: H3Event) => Promise<string[]>
  kvBindingName: string
  now?: number
  tokenStore: McpTokenStoreLike
  /**
   * Optional override for B16 §6.2.b role gate lookup. Production defaults to
   * `createDefaultUserRoleLookup()` (JOIN `user.role` via drizzle); tests can
   * stub this without touching better-auth state.
   */
  userRoleLookup?: UserRoleLookupLike
}

type RateLimitPresetName = keyof typeof FIXED_WINDOW_RATE_LIMIT_PRESETS

const TOOL_RATE_LIMIT_MAP: Record<string, RateLimitPresetName> = {
  askKnowledge: 'askKnowledge',
  searchKnowledge: 'searchKnowledge',
  listCategories: 'listCategories',
  getDocumentChunk: 'getDocumentChunk',
}

function resolveRateLimitPreset(toolName: string | undefined): RateLimitPresetName {
  // Unknown / initialization requests (e.g. `tools/list`) still go through the
  // middleware — we apply the most conservative bucket so abusive clients can
  // still be throttled.
  return (toolName ? TOOL_RATE_LIMIT_MAP[toolName] : undefined) ?? 'askKnowledge'
}

interface McpEventLike {
  context: Record<string, unknown> & {
    cloudflare?: { env?: Record<string, unknown> }
    mcpAuth?: McpAuthContext
  }
  headers: Headers
}

function getHeadersRecord(event: McpEventLike): Record<string, string | undefined> {
  return Object.fromEntries(event.headers.entries())
}

/**
 * Execute the MCP middleware pipeline: authenticate the Bearer token, extract
 * the tool being called, enforce the per-token fixed-window rate limit, and
 * populate `event.context.mcpAuth` so tool handlers can enforce scopes.
 *
 * Thrown errors propagate out of the middleware and the toolkit handler relays
 * them to the client. The associated HTTP status codes are preserved so the
 * MCP spec replies (401 / 403 / 429) are delivered correctly.
 */
export async function runMcpMiddleware(
  event: McpEventLike,
  deps: RunMcpMiddlewareDeps
): Promise<void> {
  let auth: McpAuthContext
  try {
    auth = await requireMcpBearerToken(
      { headers: getHeadersRecord(event) },
      { environment: deps.environment, store: deps.tokenStore }
    )
  } catch (error) {
    if (error instanceof McpAuthError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.statusCode === 401 ? 'Unauthorized' : 'Forbidden',
        message: error.message,
      })
    }

    throw error
  }

  event.context.mcpAuth = auth

  const toolNames = await deps.extractToolNames(event as unknown as H3Event)
  const preset = resolveRateLimitPreset(toolNames[0])
  const kv = getRequiredKvBinding(event, deps.kvBindingName)

  try {
    await consumeMcpToolRateLimit({
      environment: deps.environment,
      now: deps.now,
      store: createKvRateLimitStore(kv),
      tokenId: auth.tokenId,
      tool: preset,
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

  // B16 §6.2.b — Role × guest_policy gate. Runs after auth + rate-limit so
  // rate-limit counters still tick for abusive clients even when gated.
  try {
    await gateMcpToolAccess(event as unknown as H3Event, {
      auth,
      toolName: toolNames[0],
      userRoleLookup: deps.userRoleLookup ?? createDefaultUserRoleLookup(),
    })
  } catch (error) {
    if (error instanceof McpRoleGateError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.code,
        message: error.message,
      })
    }

    throw error
  }
}
