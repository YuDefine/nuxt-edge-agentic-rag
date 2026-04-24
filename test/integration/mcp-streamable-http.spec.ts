import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createMcpHandler } from '#server/utils/mcp-agents-compat'

// 對應 change `fix-mcp-streamable-http-session`：驗證 shim 在完整 MCP
// Streamable HTTP handshake 流程下回 JSON response、GET/DELETE 立即回 405。
// 與 unit test 不同，這裡用真 `McpServer` + 真 `WebStandardStreamableHTTPServerTransport`
// 走完 initialize → notifications/initialized → tools/list → tools/call。

const INITIALIZE_BODY = {
  jsonrpc: '2.0' as const,
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
}

interface CategoriesResult {
  categories: Array<{ id: string; name: string }>
}

function buildServer() {
  const server = new McpServer({ name: 'test-mcp', version: '0.0.0' })

  server.registerTool(
    'ListCategories',
    {
      description: 'Return a static list of categories (integration test fake).',
      inputSchema: {},
    },
    async () => {
      const payload: CategoriesResult = {
        categories: [
          { id: 'cat-1', name: 'Foundations' },
          { id: 'cat-2', name: 'Operations' },
        ],
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      }
    },
  )

  server.registerTool(
    'Echo',
    {
      description: 'Echo a string back (used to verify repeated tool calls).',
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: 'text' as const, text: `echo:${message}` }],
    }),
  )

  return server.server
}

function makeHandler() {
  const underlyingServer = buildServer()
  // `createMcpHandler` consumes the transport via `server.connect(transport)`.
  // The `McpConnectableServer` shape is satisfied by the MCP SDK `Server`.
  return createMcpHandler(underlyingServer as unknown as Parameters<typeof createMcpHandler>[0], {
    route: '/mcp',
  })
}

function postJsonRpc(handler: ReturnType<typeof makeHandler>, body: unknown) {
  return handler(
    new Request('https://worker.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }),
  )
}

async function readJson<T = unknown>(response: Response): Promise<T> {
  const text = await response.text()
  // `enableJsonResponse: true` should yield a plain JSON body, not SSE.
  expect(text.startsWith('event:')).toBe(false)
  return JSON.parse(text) as T
}

describe('MCP Streamable HTTP handshake (stateless, JSON response)', () => {
  it('GET /mcp returns 405 immediately (no 30s hang)', async () => {
    const handler = makeHandler()
    const start = Date.now()
    const response = await handler(
      new Request('https://worker.test/mcp', {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      }),
    )
    const elapsed = Date.now() - start

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(elapsed).toBeLessThan(1000)
  })

  it('POST initialize returns JSON response with 200', async () => {
    const handler = makeHandler()
    const response = await postJsonRpc(handler, INITIALIZE_BODY)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type') ?? '').toMatch(/application\/json/)

    const body = await readJson<{ jsonrpc: string; id: number; result: unknown }>(response)
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(0)
    expect(body.result).toBeDefined()
  })

  it('completes full handshake and tools/list over successive POSTs', async () => {
    // Each request builds its own handler because the shim expects a fresh
    // transport per invocation (see `server.transport !== undefined` guard in
    // `createMcpHandler`). Stateless mode keeps the server identity across
    // requests; the key invariant is that no `Mcp-Session-Id` is expected.

    const initResponse = await postJsonRpc(makeHandler(), INITIALIZE_BODY)
    expect(initResponse.status).toBe(200)

    const notifyResponse = await postJsonRpc(makeHandler(), {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    // MCP spec: server accepts notifications with 202 (no body) when JSON-RPC
    // response is not required.
    expect([200, 202]).toContain(notifyResponse.status)

    const toolsListResponse = await postJsonRpc(makeHandler(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    })
    expect(toolsListResponse.status).toBe(200)
    const toolsList = await readJson<{
      result: { tools: Array<{ name: string }> }
    }>(toolsListResponse)
    const toolNames = toolsList.result.tools.map((tool) => tool.name)
    expect(toolNames).toContain('ListCategories')
    expect(toolNames).toContain('Echo')
  })

  it('POST tools/call ListCategories returns JSON result with categories', async () => {
    const handler = makeHandler()
    const response = await postJsonRpc(handler, {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: { name: 'ListCategories', arguments: {} },
    })

    expect(response.status).toBe(200)
    const body = await readJson<{
      id: number
      result: { content: Array<{ type: string; text: string }> }
    }>(response)
    expect(body.id).toBe(42)
    const textContent = body.result.content.find((part) => part.type === 'text')
    expect(textContent).toBeDefined()
    const parsed = JSON.parse(textContent?.text ?? '{}') as CategoriesResult
    expect(parsed.categories.length).toBeGreaterThan(0)
    expect(parsed.categories[0]).toHaveProperty('id')
    expect(parsed.categories[0]).toHaveProperty('name')
  })

  it('handles 3 consecutive tool calls without re-initialize error', async () => {
    const responses: Response[] = []
    for (let i = 0; i < 3; i += 1) {
      const response = await postJsonRpc(makeHandler(), {
        jsonrpc: '2.0',
        id: 100 + i,
        method: 'tools/call',
        params: { name: 'Echo', arguments: { message: `ping-${i}` } },
      })
      responses.push(response)
    }

    for (const [i, response] of responses.entries()) {
      expect(response.status).toBe(200)
      const body = await readJson<{
        id: number
        result: { content: Array<{ type: string; text: string }> }
      }>(response)
      expect(body.id).toBe(100 + i)
      const text = body.result.content.find((part) => part.type === 'text')?.text
      expect(text).toBe(`echo:ping-${i}`)
    }
  })

  it('DELETE /mcp returns 405', async () => {
    const handler = makeHandler()
    const response = await handler(new Request('https://worker.test/mcp', { method: 'DELETE' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })
})
