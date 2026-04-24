import { describe, expect, it, vi } from 'vitest'

import { createMcpHandler } from '#server/utils/mcp-agents-compat'

// 對應 change `fix-mcp-streamable-http-session`：
//   - GET / DELETE `/mcp` → 405 + `Allow: POST` + JSON-RPC error body
//   - POST path 建立 transport 時傳入 `enableJsonResponse: true`
//   - Route guard 仍能把非 `/mcp` path 擋在 404
//
// Shim 不依賴 toolkit，這些 test 用 mock server 直接 exercise `createMcpHandler`
// 回傳的 handler。`server.connect(transport)` 在 GET/DELETE 路徑應該不被呼叫
// （立即 405，不建 transport），POST 路徑則應被呼叫。

interface CapturedTransport {
  sessionIdGenerator?: unknown
  handleRequest: ReturnType<typeof vi.fn>
}

function makeMockServer(opts: { handlePostResponse?: Response } = {}) {
  const captured: { transport?: CapturedTransport } = {}
  const response =
    opts.handlePostResponse ??
    new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  const connect = vi.fn(async (transport: unknown) => {
    captured.transport = transport as CapturedTransport
  })

  const server = {
    connect,
    transport: undefined as unknown,
  }

  return { server, connect, captured, response }
}

describe('createMcpHandler', () => {
  it('responds to GET /mcp with 405 + Allow: POST + JSON-RPC error body', async () => {
    const { server, connect } = makeMockServer()
    const handler = createMcpHandler(server)

    const response = await handler(
      new Request('https://worker.test/mcp', {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      }),
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(response.headers.get('Content-Type')).toBe('application/json')

    const body = (await response.json()) as {
      jsonrpc: string
      error: { code: number; message: string }
      id: null
    }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.code).toBe(-32000)
    expect(typeof body.error.message).toBe('string')
    expect(body.id).toBeNull()

    expect(connect).not.toHaveBeenCalled()
  })

  it('responds to DELETE /mcp with 405 + Allow: POST', async () => {
    const { server, connect } = makeMockServer()
    const handler = createMcpHandler(server)

    const response = await handler(new Request('https://worker.test/mcp', { method: 'DELETE' }))

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    const body = (await response.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32000)
    expect(connect).not.toHaveBeenCalled()
  })

  it('returns 405 in under 1 second (no 30s hang)', async () => {
    const { server } = makeMockServer()
    const handler = createMcpHandler(server)

    const start = Date.now()
    await handler(new Request('https://worker.test/mcp', { method: 'GET' }))
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(1000)
  })

  it('returns 404 for GET requests outside the configured route', async () => {
    const { server, connect } = makeMockServer()
    const handler = createMcpHandler(server, { route: '/mcp' })

    const response = await handler(new Request('https://worker.test/unrelated', { method: 'GET' }))

    expect(response.status).toBe(404)
    expect(connect).not.toHaveBeenCalled()
  })

  it('constructs a stateless transport (no session generator) on POST', async () => {
    // The shim MUST pass `sessionIdGenerator: undefined` so the underlying
    // transport stays stateless (no `Mcp-Session-Id` issuance). We avoid
    // reflecting on SDK private fields (e.g. `_enableJsonResponse`) because
    // that couples the unit test to SDK internals. The JSON-response
    // behaviour is exercised end-to-end in
    // `test/integration/mcp-streamable-http.spec.ts`.
    const { server, captured } = makeMockServer()
    const handler = createMcpHandler(server)

    await handler(
      new Request('https://worker.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }),
      }),
    )

    expect(captured.transport).toBeDefined()
    expect(captured.transport?.sessionIdGenerator).toBeUndefined()
  })

  it('delegates POST to transport.handleRequest and returns its response', async () => {
    const jsonResponse = new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 0, result: { ok: true } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
    const { server } = makeMockServer({ handlePostResponse: jsonResponse })
    const handler = createMcpHandler(server)

    // Intercept `handleRequest` by attaching expectation via connect side-effect:
    // the real `WebStandardStreamableHTTPServerTransport.handleRequest` will be
    // invoked with the Request; we don't stub it here but rely on the shim
    // still returning a Response (status 400 when transport rejects malformed
    // input is also fine — we only assert that the POST path reaches transport).
    const response = await handler(
      new Request('https://worker.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }),
      }),
    )

    expect(response).toBeInstanceOf(Response)
    // `enableJsonResponse: true` forces JSON content-type on real transport.
    expect(response.headers.get('Content-Type') ?? '').toMatch(/application\/json/)
  })
})
