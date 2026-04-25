import {
  isMcpSessionFlagEnabled,
  resolveMcpSessionNamespace,
} from '#server/utils/mcp-agents-compat'
import {
  MCP_AUTH_CONTEXT_HEADER,
  resolveMcpAuthSigningKey,
  signAuthContext,
} from '#server/utils/mcp-auth-context-codec'
import { hashMcpToken } from '#server/utils/mcp-auth'

import type { McpTokenRecord } from '#shared/types/knowledge'

/**
 * Streaming response bypass for `/mcp` GET / DELETE on Cloudflare Workers.
 *
 * Background: nitropack's cloudflare-module preset runs the H3 app via
 * `toNodeListener(h3App)` + `fetchNodeRequestHandler` (from `node-mock-http`).
 * That bridge buffers the entire response into `ServerResponse._data` and
 * only resolves once the handler calls `res.end()` — which never happens for
 * a long-lived SSE stream. The Cloudflare Worker fetch handler therefore
 * hangs and the client never receives the response status line.
 *
 * Workaround: intercept GET/DELETE `/mcp` at the Worker fetch entry (before
 * nitroApp.localFetch), verify the bearer token, sign the auth-context
 * envelope, forward the request to the MCP session Durable Object, and
 * return the DO's `Response` (with its streaming body) directly to workerd.
 * POST `/mcp` continues to flow through the normal H3 pipeline — those
 * responses are short-lived JSON and the Node-listener buffer is fine.
 *
 * The handler must be self-contained (no event/context) because it runs at
 * the Cloudflare Worker entry point, where nitroApp is initialized but H3
 * events have not been constructed yet.
 */

interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike
  first: <T = Record<string, unknown>>() => Promise<T | null>
}

interface D1DatabaseLike {
  prepare: (sql: string) => D1PreparedStatementLike
}

interface BypassEnv extends Record<string, unknown> {
  DB?: D1DatabaseLike
  MCP_SESSION?: unknown
  NUXT_KNOWLEDGE_ENVIRONMENT?: string
  NUXT_KNOWLEDGE_FEATURE_MCP_SESSION?: string
  NUXT_MCP_AUTH_SIGNING_KEY?: string
}

interface TokenRow {
  id: string
  scopes_json: string
  environment: string
  status: string
  expires_at: string | null
  revoked_at: string | null
  created_by_user_id: string
}

const STATELESS_METHOD_NOT_ALLOWED_BODY = JSON.stringify({
  jsonrpc: '2.0',
  error: {
    code: -32000,
    message:
      'Method Not Allowed. This MCP server uses stateless POST-only transport per MCP spec 2025-11-25.',
  },
  id: null,
})

const STATELESS_METHOD_NOT_ALLOWED_HEADERS = {
  'Content-Type': 'application/json',
  Allow: 'POST',
} as const

function jsonRpcErrorResponse(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function parseScopes(scopesJson: string): string[] {
  try {
    const parsed = JSON.parse(scopesJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    return []
  }
}

function buildTokenRecord(row: TokenRow): McpTokenRecord {
  // Minimal McpTokenRecord shape sufficient for the DO transport — fields
  // not consumed inside the DO are stubbed. The HMAC-signed envelope
  // protects integrity, so the unsigned shape mismatching production data
  // (e.g. `name`, `tokenHash`) never reaches business logic.
  return {
    createdAt: '',
    createdByUserId: row.created_by_user_id,
    environment: row.environment,
    expiresAt: row.expires_at,
    id: row.id,
    lastUsedAt: null,
    name: '',
    revokedAt: row.revoked_at,
    revokedReason: null,
    scopesJson: row.scopes_json,
    status: row.status,
    tokenHash: '',
  }
}

export async function handleMcpStreamingBypass(
  request: Request,
  env: BypassEnv,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    return jsonRpcErrorResponse(405, -32000, 'Method Not Allowed')
  }

  const flagEnabled = isMcpSessionFlagEnabled(env)
  const namespace = flagEnabled ? resolveMcpSessionNamespace(env) : null
  if (!flagEnabled || !namespace) {
    return new Response(STATELESS_METHOD_NOT_ALLOWED_BODY, {
      status: 405,
      headers: STATELESS_METHOD_NOT_ALLOWED_HEADERS,
    })
  }

  const sessionId = request.headers.get('Mcp-Session-Id')
  if (!sessionId) {
    return jsonRpcErrorResponse(400, -32600, 'Missing Mcp-Session-Id header')
  }

  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) {
    return jsonRpcErrorResponse(401, -32000, 'A valid Bearer token is required')
  }

  if (!env.DB) {
    return jsonRpcErrorResponse(500, -32603, 'D1 binding not configured')
  }

  const environment = env.NUXT_KNOWLEDGE_ENVIRONMENT ?? 'production'
  const tokenHash = hashMcpToken(token)

  const row = await env.DB.prepare(
    `SELECT id, scopes_json, environment, status, expires_at, revoked_at, created_by_user_id
       FROM mcp_tokens
      WHERE token_hash = ? AND environment = ? AND status = 'active'
      LIMIT 1`,
  )
    .bind(tokenHash, environment)
    .first<TokenRow>()

  if (!row || row.revoked_at) {
    return jsonRpcErrorResponse(401, -32000, 'A valid Bearer token is required')
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return jsonRpcErrorResponse(401, -32000, 'A valid Bearer token is required')
  }

  const signingKey = resolveMcpAuthSigningKey(env.NUXT_MCP_AUTH_SIGNING_KEY)
  if (!signingKey) {
    return jsonRpcErrorResponse(500, -32603, 'NUXT_MCP_AUTH_SIGNING_KEY is not configured')
  }

  const envelope = await signAuthContext(
    {
      principal: { authSource: 'legacy_token', userId: row.created_by_user_id },
      scopes: parseScopes(row.scopes_json),
      token: buildTokenRecord(row),
      tokenId: row.id,
    },
    signingKey,
  )

  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.set(MCP_AUTH_CONTEXT_HEADER, envelope)
  const forwarded = new Request(request.url, {
    method: request.method,
    headers: forwardedHeaders,
  })

  const id = namespace.idFromName(sessionId)
  const stub = namespace.get(id)
  const response = await stub.fetch(forwarded)

  // Mirror mcp-agents-compat ensureSessionHeader behavior so the client
  // sees Mcp-Session-Id even if the DO didn't echo it (defensive).
  if (!response.headers.has('Mcp-Session-Id')) {
    const headers = new Headers(response.headers)
    headers.set('Mcp-Session-Id', sessionId)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
  return response
}
