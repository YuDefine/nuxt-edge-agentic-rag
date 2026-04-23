interface McpConnectableServer {
  connect(transport: McpStatelessTransport): Promise<void>
  transport?: unknown
}

interface McpHandlerOptions {
  enableJsonResponse?: boolean
  route?: string
}

type JsonRpcMessage = Record<string, unknown> & {
  id?: number | string | null
  jsonrpc?: string
}

type TransportExtra = {
  requestInfo: {
    headers: Record<string, string>
    url: URL
  }
}

class McpStatelessTransport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JsonRpcMessage, extra?: TransportExtra) => void

  private encoder = new TextEncoder()
  private pendingResponseIds = new Set<number | string>()
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null

  async start(): Promise<void> {}

  async close(): Promise<void> {
    await this.closeStream()
    this.onclose?.()
  }

  async send(message: JsonRpcMessage): Promise<void> {
    const writer = this.writer
    if (!writer) {
      return
    }

    await writer.write(this.encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`))

    if (typeof message.id === 'string' || typeof message.id === 'number') {
      this.pendingResponseIds.delete(message.id)
      if (this.pendingResponseIds.size === 0) {
        await this.closeStream()
      }
    }
  }

  async handleRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return createJsonRpcHttpError(405, -32000, 'Method not allowed. Use POST for MCP requests.')
    }

    const accept = request.headers.get('accept') ?? ''
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      return createJsonRpcHttpError(
        406,
        -32000,
        'Not Acceptable: Client must accept both application/json and text/event-stream',
      )
    }

    if (!request.headers.get('content-type')?.includes('application/json')) {
      return createJsonRpcHttpError(
        415,
        -32000,
        'Unsupported Media Type: Content-Type must be application/json',
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return createJsonRpcHttpError(400, -32700, 'Parse error: Invalid JSON')
    }

    const messages = (Array.isArray(body) ? body : [body]).filter(isJsonRpcMessage)
    if (messages.length === 0) {
      return createJsonRpcHttpError(400, -32700, 'Parse error: Invalid JSON-RPC message')
    }

    for (const message of messages) {
      if (typeof message.id === 'string' || typeof message.id === 'number') {
        this.pendingResponseIds.add(message.id)
      }
    }

    const requestInfo = {
      headers: Object.fromEntries(request.headers.entries()),
      url: new URL(request.url),
    }

    if (this.pendingResponseIds.size === 0) {
      for (const message of messages) {
        this.onmessage?.(message, { requestInfo })
      }
      return new Response(null, { status: 202, headers: createCorsHeaders() })
    }

    const stream = new TransformStream<Uint8Array, Uint8Array>()
    this.writer = stream.writable.getWriter()

    for (const message of messages) {
      this.onmessage?.(message, { requestInfo })
    }

    return new Response(stream.readable, {
      headers: {
        ...createCorsHeaders(),
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream',
      },
    })
  }

  private async closeStream(): Promise<void> {
    const writer = this.writer
    if (!writer) {
      return
    }

    this.writer = null
    try {
      await writer.close()
    } catch {}
  }
}

/**
 * Compatibility shim for `agents/mcp`.
 *
 * `@nuxtjs/mcp-toolkit` selects its Cloudflare provider on Worker builds, and
 * that provider imports `createMcpHandler` from `agents/mcp`. In production the
 * `agents/mcp` Worker transport currently fails during `tools/call` with a
 * Cloudflare proxy `ownKeys` error before our tool handler can return.
 *
 * The MCP SDK's Web Standards transport runs on Workers without that provider
 * layer. This shim keeps the `agents/mcp` API surface used by the toolkit while
 * routing requests through the SDK transport.
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

    const transport = new McpStatelessTransport()

    await server.connect(transport)
    return transport.handleRequest(request)
  }
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'mcp-session-id',
  }
}

function createJsonRpcHttpError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: { code, message },
      id: null,
      jsonrpc: '2.0',
    }),
    {
      headers: {
        ...createCorsHeaders(),
        'Content-Type': 'application/json',
      },
      status,
    },
  )
}
