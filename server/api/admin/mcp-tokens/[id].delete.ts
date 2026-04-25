import { useLogger } from 'evlog'
import { z } from 'zod'

import type { H3Event } from 'h3'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { getCloudflareEnv, getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { resolveMcpAuthSigningKey } from '#server/utils/mcp-auth-context-codec'
import { MCP_INVALIDATE_HEADER, signInvalidateHeader } from '#server/utils/mcp-internal-invalidate'
import { createMcpTokenAdminStore } from '#server/utils/mcp-token-store'
import { clearTokenIndex, readSessionIds } from '#server/utils/mcp-token-session-index'

interface McpSessionDoNamespaceLike {
  get(id: { toString?: () => string }): {
    fetch: (request: Request) => Promise<Response>
  }
  idFromName(name: string): { toString?: () => string }
}

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async function revokeMcpTokenHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, paramsSchema.parse)

  log.set({
    operation: 'admin-mcp-tokens-revoke',
    table: 'mcp_tokens',
    tokenId: params.id,
    user: { id: session.user.id ?? null },
  })

  const store = createMcpTokenAdminStore()

  let result
  try {
    result = await store.revokeTokenById(params.id)
  } catch (error) {
    log.error(error as Error, { step: 'revoke-mcp-token' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法撤銷 MCP token，請稍後再試',
    })
  }

  switch (result.outcome) {
    case 'not-found':
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '找不到此 MCP token',
      })
    case 'revoked':
      await cascadeInvalidateActiveSessions(event, params.id, log)
      return {
        data: {
          alreadyRevoked: false,
          id: result.token.id,
          revokedAt: result.token.revokedAt,
          status: result.token.status,
        },
      }
    case 'already-revoked':
      await cascadeInvalidateActiveSessions(event, params.id, log)
      return {
        data: {
          alreadyRevoked: true,
          id: result.token.id,
          revokedAt: result.token.revokedAt,
          status: result.token.status,
        },
      }
  }
})

interface RevokeLogger {
  warn?: (message: string, fields?: Record<string, unknown>) => void
  error?: (error: Error, fields?: Record<string, unknown>) => void
}

/**
 * Best-effort cascade cleanup: revoke main flow has already succeeded by the
 * time we arrive here, so any KV / DO failure must NOT propagate. The DO TTL
 * alarm (~30 min) is the safety net if the cleanup never runs.
 *
 * **Misconfig vs runtime failure**: `NUXT_MCP_AUTH_SIGNING_KEY` missing or
 * malformed is operator-actionable (every revoke silently degrades),
 * unlike a transient KV miss or DO unreachable. We resolve the signing key
 * up front under a distinct try/catch that logs `error` so monitoring picks
 * it up; in-flight runtime failures stay as `warn`.
 */
async function cascadeInvalidateActiveSessions(
  event: H3Event,
  tokenId: string,
  log: RevokeLogger,
): Promise<void> {
  const env = getCloudflareEnv(event)
  let signingKey: string
  try {
    signingKey = resolveMcpAuthSigningKey(env.NUXT_MCP_AUTH_SIGNING_KEY)
  } catch (error) {
    log.error?.(error instanceof Error ? error : new Error(String(error)), {
      step: 'mcp-token-revoke-cascade-misconfig',
      tokenId,
    })
    return
  }

  try {
    const runtimeConfig = getKnowledgeRuntimeConfig()
    const kv = getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)
    const sessionIds = await readSessionIds(kv, tokenId)

    if (sessionIds.length > 0) {
      const namespace = resolveSessionNamespace(env.MCP_SESSION)
      if (namespace) {
        const now = Date.now()
        await Promise.all(
          sessionIds.map((sessionId) =>
            invalidateSession(namespace, sessionId, signingKey, now, log),
          ),
        )
      } else {
        log.warn?.('mcp-token-revoke-cascade: MCP_SESSION binding unavailable', { tokenId })
      }
    }

    await clearTokenIndex(kv, tokenId)
  } catch (error) {
    log.warn?.('mcp-token-revoke-cascade failed', {
      error: error instanceof Error ? error.message : String(error),
      tokenId,
    })
  }
}

async function invalidateSession(
  namespace: McpSessionDoNamespaceLike,
  sessionId: string,
  signingKey: string,
  now: number,
  log: RevokeLogger,
): Promise<void> {
  try {
    const header = await signInvalidateHeader({ sessionId, secret: signingKey, now })
    const id = namespace.idFromName(sessionId)
    const stub = namespace.get(id)
    const response = await stub.fetch(
      new Request('https://do.invalidate/mcp', {
        method: 'POST',
        headers: {
          [MCP_INVALIDATE_HEADER]: header,
          'Mcp-Session-Id': sessionId,
        },
      }),
    )
    if (!response.ok) {
      log.warn?.('mcp-token-revoke-cascade: DO invalidate non-2xx', {
        sessionId,
        status: response.status,
      })
    }
  } catch (error) {
    log.warn?.('mcp-token-revoke-cascade: DO invalidate threw', {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
    })
  }
}

function resolveSessionNamespace(candidate: unknown): McpSessionDoNamespaceLike | null {
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  const namespace = candidate as McpSessionDoNamespaceLike
  if (typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') {
    return null
  }
  return namespace
}
