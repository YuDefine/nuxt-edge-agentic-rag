import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { parseBooleanFlag } from '#shared/schemas/knowledge-runtime'
import { MCP_AUTH_CONTEXT_HEADER } from '#server/utils/mcp-auth-context-codec'

interface McpConnectableServer {
  connect(transport: WebStandardStreamableHTTPServerTransport): Promise<void>
  transport?: unknown
}

interface McpHandlerOptions {
  enableJsonResponse?: boolean
  route?: string
}

interface McpSessionNamespaceLike {
  get(id: { toString?: () => string }): {
    fetch: (request: Request) => Promise<Response>
  }
  idFromName(name: string): { toString?: () => string }
}

type CloudflareEnv = Record<string, unknown>

// JSON-RPC application-defined error code. `-32000` is within the
// reserved `-32000..-32099` "server error" band per JSON-RPC 2.0 spec
// and matches the convention used elsewhere in the MCP ecosystem for
// transport-level "method not allowed" signals.
const JSON_RPC_METHOD_NOT_ALLOWED_CODE = -32000

// Precomputed stateless-mode 405 body — GET/DELETE paths reuse it instead of
// stringifying per request. Safe to share because it contains no per-request
// state.
const METHOD_NOT_ALLOWED_BODY = JSON.stringify({
  jsonrpc: '2.0',
  error: {
    code: JSON_RPC_METHOD_NOT_ALLOWED_CODE,
    message:
      'Method Not Allowed. This MCP server uses stateless POST-only transport per MCP spec 2025-11-25.',
  },
  id: null,
})

const METHOD_NOT_ALLOWED_HEADERS = {
  'Content-Type': 'application/json',
  Allow: 'POST',
} as const

const SAFE_GLOBAL_ENV_KEYS = [
  'DB',
  'KV',
  'AI',
  'BLOB',
  'CLOUDFLARE_ACCOUNT_ID',
  'NUXT_KNOWLEDGE_D1_DATABASE',
  'NUXT_KNOWLEDGE_DOCUMENTS_BUCKET',
  'NUXT_KNOWLEDGE_RATE_LIMIT_KV',
  'NUXT_KNOWLEDGE_AI_SEARCH_INDEX',
  'NUXT_KNOWLEDGE_ENVIRONMENT',
  'NUXT_KNOWLEDGE_FEATURE_PASSKEY',
  'NUXT_MCP_AUTH_SIGNING_KEY',
  'NUXT_PASSKEY_RP_ID',
  'NUXT_PASSKEY_RP_NAME',
  'NUXT_KNOWLEDGE_AI_GATEWAY_ID',
  'NUXT_KNOWLEDGE_AI_GATEWAY_CACHE_ENABLED',
] as const

function installEnumerableSafeEnv(env?: CloudflareEnv) {
  if (!env) {
    return
  }

  const safeEnv: CloudflareEnv = Object.create(null)
  for (const key of SAFE_GLOBAL_ENV_KEYS) {
    try {
      const value = env[key]
      if (value !== undefined) {
        safeEnv[key] = value
      }
    } catch {
      // Cloudflare env bindings are proxies; skip bindings that cannot be read.
    }
  }

  ;(globalThis as typeof globalThis & { __env__?: CloudflareEnv }).__env__ = safeEnv
}

/**
 * Compatibility shim for `agents/mcp`.
 *
 * `@nuxtjs/mcp-toolkit` selects its Cloudflare provider on Worker builds, and
 * that provider imports `createMcpHandler` from `agents/mcp`. The `agents/mcp`
 * Worker transport fails in production during `tools/call` with a Cloudflare
 * proxy `ownKeys` error. Use the MCP SDK's Web Standards transport instead,
 * matching the toolkit node provider's stateless path.
 */
export function createMcpHandler(server: McpConnectableServer, options: McpHandlerOptions = {}) {
  return async (request: Request, env?: CloudflareEnv): Promise<Response> => {
    const route = options.route ?? '/mcp'
    if (route) {
      const url = new URL(request.url)
      if (url.pathname !== route) {
        return new Response('Not Found', { status: 404 })
      }
    }

    // Feature flag branch (Pivot C): when the session DO path is enabled and
    // the MCP_SESSION binding is present, the shim forwards POST requests to
    // a per-session Durable Object addressed by `Mcp-Session-Id`. GET / DELETE
    // with a valid `Mcp-Session-Id` are also forwarded so the DO can serve
    // server-initiated SSE streams (spec 2025-11-25 §Listening for Messages)
    // and client-initiated session termination. The DO is the only layer that
    // persists session state, eliminates Claude.ai's re-initialize loop
    // (TD-030), and bypasses the `Reflect.ownKeys(env)` bug family documented
    // in Phase 1 spike. When the flag is off, the stateless path below remains
    // active as the kill-switch fallback.
    const flagEnabled = isMcpSessionFlagEnabled(env)
    const namespace = flagEnabled ? resolveMcpSessionNamespace(env) : null

    if (
      flagEnabled &&
      namespace &&
      request.method === 'POST' &&
      request.headers.has(MCP_AUTH_CONTEXT_HEADER)
    ) {
      const sessionId = request.headers.get('Mcp-Session-Id') ?? crypto.randomUUID()
      const forwarded = cloneRequestWithSessionHeader(request, sessionId)
      const id = namespace.idFromName(sessionId)
      const stub = namespace.get(id)
      const response = await stub.fetch(forwarded)
      return ensureSessionHeader(response, sessionId)
    }

    if (
      flagEnabled &&
      namespace &&
      (request.method === 'GET' || request.method === 'DELETE') &&
      request.headers.has('Mcp-Session-Id') &&
      request.headers.has(MCP_AUTH_CONTEXT_HEADER)
    ) {
      const sessionId = request.headers.get('Mcp-Session-Id') as string
      const id = namespace.idFromName(sessionId)
      const stub = namespace.get(id)
      const response = await stub.fetch(request)
      return ensureSessionHeader(response, sessionId)
    }

    // MCP Streamable HTTP spec 2025-11-25 permits stateless servers to decline
    // SSE stream establishment on GET by returning 405. The stateless kill-switch
    // path remains that behavior: no `Mcp-Session-Id`, no server-initiated
    // events, so both GET /mcp (SSE stream open) and DELETE /mcp (client-
    // initiated session termination) are rejected immediately. Without this,
    // Cloudflare Workers hang 30s on GET before runtime cancel, triggering
    // Claude re-initialize loops (see fix-mcp-streamable-http-session change).
    if (request.method === 'GET' || request.method === 'DELETE') {
      return new Response(METHOD_NOT_ALLOWED_BODY, {
        status: 405,
        headers: METHOD_NOT_ALLOWED_HEADERS,
      })
    }

    if (server.transport !== undefined) {
      throw new Error('Server is already connected to a transport')
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      // Force JSON response over SSE mini-stream so every POST returns a
      // complete JSON-RPC payload. Without this, Cloudflare Workers can be
      // forced into SSE paths that exceed the 30s CPU budget.
      enableJsonResponse: options.enableJsonResponse ?? true,
      sessionIdGenerator: undefined,
    })

    installEnumerableSafeEnv(env)
    await server.connect(transport)
    return transport.handleRequest(request)
  }
}

export function isMcpSessionFlagEnabled(env?: CloudflareEnv): boolean {
  const raw = env?.NUXT_KNOWLEDGE_FEATURE_MCP_SESSION
  if (typeof raw !== 'boolean' && typeof raw !== 'string') return false
  return parseBooleanFlag(raw)
}

export function resolveMcpSessionNamespace(env?: CloudflareEnv): McpSessionNamespaceLike | null {
  const candidate = env?.MCP_SESSION
  if (!candidate || typeof candidate !== 'object') return null
  const namespace = candidate as McpSessionNamespaceLike
  if (typeof namespace.idFromName !== 'function') return null
  if (typeof namespace.get !== 'function') return null
  return namespace
}

function cloneRequestWithSessionHeader(request: Request, sessionId: string): Request {
  const headers = new Headers(request.headers)
  headers.set('Mcp-Session-Id', sessionId)
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    duplex: 'half',
  } as RequestInit)
}

function ensureSessionHeader(response: Response, sessionId: string): Response {
  if (response.headers.get('Mcp-Session-Id')) {
    return response
  }
  const headers = new Headers(response.headers)
  headers.set('Mcp-Session-Id', sessionId)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
