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

    if (server.transport !== undefined) {
      throw new Error('Server is already connected to a transport')
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: options.enableJsonResponse,
      sessionIdGenerator: undefined,
    })

    installEnumerableSafeEnv(env)
    await server.connect(transport)
    return transport.handleRequest(request)
  }
}
