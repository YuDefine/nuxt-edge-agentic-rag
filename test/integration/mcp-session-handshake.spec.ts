/**
 * Task 5.2 — flag=true / flag=false 分流驗證
 *
 * Requirement: "Feature Flag Controls MCP Session Path"（spec §ADDED）
 *
 * 這裡 stub Durable Object namespace，驗 `createMcpHandler` 兩路徑：
 *   - flag=false → 走 stateless shim，GET 回 405，POST initialize 回 JSON
 *   - flag=true  → request 轉給 DO stub，sessionId 以 header `Mcp-Session-Id`
 *                  傳遞；回應 header 也帶 `Mcp-Session-Id`
 *
 * Tool 執行 end-to-end 在 DO 內（需 bindings 注入），會在 staging 實測；本 spec
 * 聚焦「哪個 path 被觸發 + sessionId 如何流動」。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it, vi } from 'vitest'

import { createMcpHandler } from '#server/utils/mcp-agents-compat'

function buildServer() {
  const server = new McpServer({ name: 'test-mcp', version: '0.0.0' })
  return server.server
}

const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
}

interface FakeDoCall {
  sessionId: string
  request: Request
  sessionHeader: string | null
}

function makeFakeMcpSessionBinding(calls: FakeDoCall[], sessionIdOverride?: string) {
  return {
    idFromName: (sessionId: string) => ({
      toString: () => sessionId,
      fetch: async (incoming: Request) => {
        const stored: FakeDoCall = {
          sessionId,
          request: incoming,
          sessionHeader: incoming.headers.get('Mcp-Session-Id'),
        }
        calls.push(stored)
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { ok: true } }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Mcp-Session-Id': sessionIdOverride ?? sessionId,
          },
        })
      },
    }),
  }
}

describe('createMcpHandler — features.mcpSession flag branching', () => {
  it('flag=false keeps stateless shim path (GET 405, POST JSON)', async () => {
    const handler = createMcpHandler(buildServer() as never, { route: '/mcp' })

    const getResp = await handler(new Request('https://worker.test/mcp', { method: 'GET' }), {
      NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'false',
    } as never)
    expect(getResp.status).toBe(405)

    const postResp = await handler(
      new Request('https://worker.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(INITIALIZE_BODY),
      }),
      { NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'false' } as never,
    )
    expect(postResp.status).toBe(200)
    expect(postResp.headers.get('content-type') ?? '').toMatch(/application\/json/)
  })

  it('flag=true forwards POST to MCP_SESSION DO, preserves Mcp-Session-Id header in response', async () => {
    const calls: FakeDoCall[] = []
    const mcpSession = makeFakeMcpSessionBinding(calls)
    const handler = createMcpHandler(buildServer() as never, { route: '/mcp' })

    const incoming = new Request('https://worker.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Mcp-Session-Id': 'session-abc',
      },
      body: JSON.stringify(INITIALIZE_BODY),
    })

    const response = await handler(incoming, {
      NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true',
      MCP_SESSION: mcpSession,
    } as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('Mcp-Session-Id')).toBe('session-abc')
    expect(calls.length).toBe(1)
    expect(calls[0].sessionId).toBe('session-abc')
    expect(calls[0].sessionHeader).toBe('session-abc')
  })

  it('flag=true without Mcp-Session-Id header generates one via crypto.randomUUID', async () => {
    const calls: FakeDoCall[] = []
    const stubId = 'generated-uuid-1234'
    const randomSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(stubId as `${string}-${string}-${string}-${string}-${string}`)
    const mcpSession = makeFakeMcpSessionBinding(calls)

    try {
      const handler = createMcpHandler(buildServer() as never, { route: '/mcp' })
      const response = await handler(
        new Request('https://worker.test/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(INITIALIZE_BODY),
        }),
        { NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true', MCP_SESSION: mcpSession } as never,
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('Mcp-Session-Id')).toBe(stubId)
      expect(calls.length).toBe(1)
      expect(calls[0].sessionId).toBe(stubId)
      expect(calls[0].sessionHeader).toBe(stubId)
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('flag=true still returns 405 on GET without invoking the DO', async () => {
    const calls: FakeDoCall[] = []
    const mcpSession = makeFakeMcpSessionBinding(calls)
    const handler = createMcpHandler(buildServer() as never, { route: '/mcp' })

    const response = await handler(new Request('https://worker.test/mcp', { method: 'GET' }), {
      NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true',
      MCP_SESSION: mcpSession,
    } as never)
    expect(response.status).toBe(405)
    expect(calls.length).toBe(0)
  })
})
