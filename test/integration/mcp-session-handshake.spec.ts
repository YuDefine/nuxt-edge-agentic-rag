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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MCPSessionDurableObject } from '#server/durable-objects/mcp-session'
import { createMcpHandler } from '#server/utils/mcp-agents-compat'
import { MCP_AUTH_CONTEXT_HEADER, signAuthContext } from '#server/utils/mcp-auth-context-codec'

import type {
  McpSessionDurableObjectEnv,
  McpSessionState,
} from '#server/durable-objects/mcp-session'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { H3Event } from 'h3'

const pendingMcpEvent = vi.hoisted(() => ({
  current: null as H3Event | null,
}))

vi.mock('nitropack/runtime', () => ({
  useEvent: () => pendingMcpEvent.current,
}))

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

const TOOL_CALL_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'listCategories',
    arguments: {
      includeCounts: true,
    },
  },
}

const TEST_SIGNING_KEY = '0123456789abcdef0123456789abcdef'

const TEST_AUTH = {
  principal: {
    authSource: 'oauth_access_token',
    userId: 'user-1',
  },
  scopes: ['knowledge.category.list'],
  tokenId: 'oauth:token-1',
}

type StorageValue =
  | McpSessionState
  | string
  | number
  | boolean
  | Record<string, unknown>
  | undefined

interface McpToolDefinition {
  _meta?: Record<string, unknown>
  annotations?: Record<string, unknown>
  description?: string
  handler: (...args: never[]) => unknown
  inputExamples?: unknown[]
  inputSchema?: Record<string, unknown>
  name: string
  outputSchema?: Record<string, unknown>
  tags?: string[]
  title?: string
}

interface FakeDoCall {
  sessionId: string
  request: Request
  sessionHeader: string | null
  authContextHeader: string | null
}

class FakeStorage {
  private data = new Map<string, StorageValue>()
  private alarm: number | null = null

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value as StorageValue)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async deleteAll(): Promise<void> {
    this.data.clear()
    this.alarm = null
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm
  }

  async setAlarm(time: number | Date): Promise<void> {
    this.alarm = time instanceof Date ? time.getTime() : time
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null
  }
}

function makeFakeMcpSessionBinding(calls: FakeDoCall[], sessionIdOverride?: string) {
  return {
    idFromName: (sessionId: string) => ({
      toString: () => sessionId,
      fetch: async (incoming: Request) => {
        const stored: FakeDoCall = {
          sessionId,
          request: incoming,
          authContextHeader: incoming.headers.get(MCP_AUTH_CONTEXT_HEADER),
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

function makeRealMcpSessionBinding(env: McpSessionDurableObjectEnv, now: () => number) {
  const instances = new Map<string, MCPSessionDurableObject>()

  return {
    idFromName: (sessionId: string) => ({
      fetch: async (incoming: Request) => {
        let durableObject = instances.get(sessionId)
        if (!durableObject) {
          durableObject = new MCPSessionDurableObject(createFakeState(sessionId) as never, env, now)
          instances.set(sessionId, durableObject)
        }
        return durableObject.fetch(incoming)
      },
      toString: () => sessionId,
    }),
  }
}

function createFakeState(sessionId: string) {
  const storage = new FakeStorage()
  return {
    storage,
    id: {
      equals: () => false,
      name: sessionId,
      toString: () => sessionId,
    },
    acceptWebSocket: () => {
      // no-op
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  }
}

function bindPreparedStatement() {
  return this
}

function createFakeD1() {
  return {
    batch: vi.fn().mockResolvedValue([]),
    prepare: vi.fn(() => ({
      all: vi.fn().mockResolvedValue({
        results: [
          { category_slug: 'governance', document_count: 2 },
          { category_slug: 'launch', document_count: 1 },
        ],
      }),
      bind: bindPreparedStatement,
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    })),
  }
}

function createFakeKv() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  }
}

function createRuntimeEnv(overrides: Partial<McpSessionDurableObjectEnv> = {}) {
  return {
    DB: createFakeD1(),
    KV: createFakeKv(),
    NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true',
    NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS: '60000',
    NUXT_MCP_AUTH_SIGNING_KEY: TEST_SIGNING_KEY,
    ...overrides,
  }
}

function stubToolGlobals() {
  vi.stubGlobal('defineMcpTool', <T>(definition: T) => definition)
  vi.stubGlobal('createError', (input: { message: string; statusCode?: number }) =>
    Object.assign(new Error(input.message), input),
  )
  vi.stubGlobal('useRuntimeConfig', () => ({
    knowledge: {
      bindings: {
        d1Database: 'DB',
        rateLimitKv: 'KV',
      },
      environment: 'local',
      features: {
        mcpSession: true,
      },
    },
  }))
}

function isCallToolResult(value: Record<string, unknown>): boolean {
  return (
    ('content' in value && Array.isArray(value.content)) ||
    'structuredContent' in value ||
    'isError' in value
  )
}

function normalizeToolResult(result: unknown): CallToolResult {
  if (typeof result === 'string') {
    return { content: [{ type: 'text', text: result }] }
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return { content: [{ type: 'text', text: String(result) }] }
  }

  if (typeof result === 'object' && result !== null && !isCallToolResult(result as never)) {
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }

  return result as CallToolResult
}

function registerToolFromDefinition(server: McpServer, tool: McpToolDefinition): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as never,
      outputSchema: tool.outputSchema as never,
      annotations: tool.annotations as never,
      _meta: {
        ...tool._meta,
        ...(tool.inputExamples ? { inputExamples: tool.inputExamples } : {}),
        ...(tool.tags?.length ? { tags: tool.tags } : {}),
      },
    },
    async (...args: never[]) => normalizeToolResult(await tool.handler(...args)),
  )
}

async function buildKnowledgeServer() {
  stubToolGlobals()
  const listCategories = await import('#server/mcp/tools/categories')
  const server = new McpServer({ name: 'nuxt-edge-agentic-rag', version: '0.0.0' })
  registerToolFromDefinition(server, listCategories.default as McpToolDefinition)
  return server.server
}

function makeStatelessToolEvent(env: Record<string, unknown>) {
  return {
    context: {
      cloudflare: { env },
      log: {
        debug: vi.fn(),
        emit: vi.fn(),
        error: vi.fn(),
        getContext: vi.fn(() => ({})),
        info: vi.fn(),
        set: vi.fn(),
        warn: vi.fn(),
      },
      mcpAuth: TEST_AUTH,
      params: {},
    },
    headers: new Headers(),
    method: 'POST',
    node: {
      req: {
        headers: {},
        method: 'POST',
        url: '/mcp',
      },
      res: {},
    },
    path: '/mcp',
    web: {
      request: new Request('https://worker.test/mcp', { method: 'POST' }),
    },
  } as unknown as H3Event
}

function makeJsonRpcRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://worker.test/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function readBody(response: Response) {
  return response.text()
}

afterEach(() => {
  pendingMcpEvent.current = null
  vi.unstubAllGlobals()
})

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
        [MCP_AUTH_CONTEXT_HEADER]: 'signed-auth-context',
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
    expect(calls[0].authContextHeader).toBe('signed-auth-context')
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
          headers: {
            'content-type': 'application/json',
            [MCP_AUTH_CONTEXT_HEADER]: 'signed-auth-context',
          },
          body: JSON.stringify(INITIALIZE_BODY),
        }),
        { NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true', MCP_SESSION: mcpSession } as never,
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('Mcp-Session-Id')).toBe(stubId)
      expect(calls.length).toBe(1)
      expect(calls[0].sessionId).toBe(stubId)
      expect(calls[0].sessionHeader).toBe(stubId)
      expect(calls[0].authContextHeader).toBe('signed-auth-context')
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('flag=true without auth context header falls back to stateless path', async () => {
    const calls: FakeDoCall[] = []
    const mcpSession = makeFakeMcpSessionBinding(calls)
    const handler = createMcpHandler(buildServer() as never, { route: '/mcp' })

    const response = await handler(
      new Request('https://worker.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(INITIALIZE_BODY),
      }),
      { NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true', MCP_SESSION: mcpSession } as never,
    )

    expect(response.status).toBe(200)
    expect(calls.length).toBe(0)
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

  it('flag=true dispatches tools/call through the DO with the same byte-level body as flag=false', async () => {
    const now = Date.UTC(2026, 3, 24, 10, 0, 0)
    const sessionId = 'session-tool-call'
    const env = createRuntimeEnv()
    const authContextHeader = await signAuthContext(TEST_AUTH, TEST_SIGNING_KEY, now)
    const mcpSession = makeRealMcpSessionBinding(env, () => now)

    const doHandler = createMcpHandler(await buildKnowledgeServer(), { route: '/mcp' })
    const initializeResponse = await doHandler(
      makeJsonRpcRequest(INITIALIZE_BODY, {
        [MCP_AUTH_CONTEXT_HEADER]: authContextHeader,
        'Mcp-Session-Id': sessionId,
      }),
      {
        ...env,
        MCP_SESSION: mcpSession,
      } as never,
    )
    expect(initializeResponse.status).toBe(200)

    const doResponse = await doHandler(
      makeJsonRpcRequest(TOOL_CALL_BODY, {
        [MCP_AUTH_CONTEXT_HEADER]: authContextHeader,
        'Mcp-Session-Id': sessionId,
      }),
      {
        ...env,
        MCP_SESSION: mcpSession,
      } as never,
    )
    const doBody = await readBody(doResponse)

    pendingMcpEvent.current = makeStatelessToolEvent(env)
    const statelessHandler = createMcpHandler(await buildKnowledgeServer(), { route: '/mcp' })
    const statelessResponse = await statelessHandler(makeJsonRpcRequest(TOOL_CALL_BODY), {
      ...env,
      NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'false',
    } as never)
    const statelessBody = await readBody(statelessResponse)

    expect(doResponse.status).toBe(200)
    expect(statelessResponse.status).toBe(200)
    expect(doResponse.headers.get('Mcp-Session-Id')).toBe(sessionId)
    expect(doBody).not.toContain('501')
    expect(doBody).not.toContain('TD-041')
    expect(doBody).toContain('governance')
    expect(doBody).toContain('launch')
    expect(doBody).toBe(statelessBody)
  })
})
