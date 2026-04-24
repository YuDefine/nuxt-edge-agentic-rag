import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

interface McpConnectableServer {
  connect(transport: WebStandardStreamableHTTPServerTransport): Promise<void>
  transport?: unknown
}

interface McpHandlerOptions {
  enableJsonResponse?: boolean
  route?: string
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

    // MCP Streamable HTTP spec 2025-11-25 permits stateless servers to decline
    // SSE stream establishment on GET by returning 405. This server is
    // stateless (no `Mcp-Session-Id`, no server-initiated events), so both
    // GET /mcp (SSE stream open) and DELETE /mcp (client-initiated session
    // termination) are rejected immediately. Without this, Cloudflare Workers
    // hang 30s on GET before runtime cancel, triggering Claude re-initialize
    // loops (see fix-mcp-streamable-http-session change).
    // === MCP-DIAG-ENTRY @followup[TD-030] (Q6 Phase 1 spike — REMOVE AFTER CAPTURE) ===
    // Logs shim entry BEFORE any early-return / guard so we can verify whether
    // the singleton `server.transport` guard is the true root cause of the
    // 400 seen in production tail.
    // eslint-disable-next-line no-console
    console.log(
      '[MCP-DIAG-ENTRY]',
      JSON.stringify({
        method: request.method,
        path: new URL(request.url).pathname,
        hasExistingTransport: server.transport !== undefined,
        headers: {
          'mcp-session-id': request.headers.get('mcp-session-id'),
          'mcp-protocol-version': request.headers.get('mcp-protocol-version'),
        },
      }),
    )
    // === MCP-DIAG-ENTRY END ===

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

    // === MCP-DIAG START @followup[TD-030] (Q6 Phase 1 spike — REMOVE AFTER CAPTURE) ===
    // Captures the JSON-RPC error body the SDK returns on the second
    // POST /mcp initialize that Claude.ai issues during its re-init loop.
    // Covers both 4xx responses AND thrown paths (try/catch below) so the
    // spike still captures SDK internal assertions. Only logs status >= 400
    // or thrown to keep volume low. Authorization header is deliberately
    // omitted to avoid leaking Bearer tokens.
    const diagMethod = request.method
    const diagPath = new URL(request.url).pathname
    const diagHeaders = {
      'mcp-session-id': request.headers.get('mcp-session-id'),
      'mcp-protocol-version': request.headers.get('mcp-protocol-version'),
      accept: request.headers.get('accept'),
      'content-type': request.headers.get('content-type'),
    }
    let diagReqBody: string | null = null
    try {
      diagReqBody = await request.clone().text()
    } catch {
      diagReqBody = '<unreadable>'
    }

    let diagResponse: Response
    try {
      diagResponse = await transport.handleRequest(request)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      // eslint-disable-next-line no-console
      console.log(
        '[MCP-DIAG]',
        JSON.stringify({
          method: diagMethod,
          path: diagPath,
          status: 'THROWN',
          headers: diagHeaders,
          reqBody: diagReqBody,
          error: errorMessage,
        }),
      )
      throw error
    }

    if (diagResponse.status >= 400) {
      let diagResBody: string
      try {
        diagResBody = await diagResponse.clone().text()
      } catch {
        diagResBody = '<unreadable>'
      }
      // eslint-disable-next-line no-console
      console.log(
        '[MCP-DIAG]',
        JSON.stringify({
          method: diagMethod,
          path: diagPath,
          status: diagResponse.status,
          headers: diagHeaders,
          reqBody: diagReqBody,
          resBody: diagResBody,
        }),
      )
    }

    return diagResponse
    // === MCP-DIAG END @followup[TD-030] ===
  }
}
