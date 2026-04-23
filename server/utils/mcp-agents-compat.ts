import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

interface McpConnectableServer {
  connect(transport: WebStandardStreamableHTTPServerTransport): Promise<void>
  transport?: unknown
}

interface McpHandlerOptions {
  enableJsonResponse?: boolean
  route?: string
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
  return async (request: Request): Promise<Response> => {
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

    await server.connect(transport)
    return transport.handleRequest(request)
  }
}
