import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MCPSessionDurableObject } from '#server/durable-objects/mcp-session'
import { createMcpHandler } from '#server/utils/mcp-agents-compat'
import { MCP_AUTH_CONTEXT_HEADER, signAuthContext } from '#server/utils/mcp-auth-context-codec'

import type {
  McpSessionDurableObjectEnv,
  McpSessionState,
} from '#server/durable-objects/mcp-session'

const pendingEvent = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('nitropack/runtime', () => ({
  useEvent: () => {
    if (!pendingEvent.current) {
      throw new Error('Missing pending MCP event')
    }
    return pendingEvent.current
  },
}))

type StorageValue =
  | McpSessionState
  | string
  | number
  | boolean
  | Record<string, unknown>
  | undefined

class FakeStorage {
  private data = new Map<string, StorageValue>()
  private alarm: number | null = null

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value as StorageValue)
  }

  async delete(): Promise<boolean> {
    return false
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

class FakeD1PreparedStatement {
  private values: unknown[] = []

  constructor(
    private readonly query: string,
    private readonly records: Array<{ query: string; values: unknown[] }>,
  ) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    this.values = values
    return this
  }

  async run(): Promise<{ success: true }> {
    this.records.push({ query: this.query, values: this.values })
    return { success: true }
  }

  async first<T>(): Promise<T | null> {
    return {
      access_level: 'internal',
      category_slug: 'governance',
      chunk_text: 'Task 5.1 dispatches askKnowledge through the session Durable Object path.',
      citation_locator: 'doc://dispatch#chunk-1',
      document_id: 'doc-dispatch',
      document_title: 'MCP Dispatch Plan',
      document_version_id: 'version-dispatch',
      source_chunk_id: 'chunk-dispatch',
    } as T
  }
}

class FakeD1Database {
  readonly records: Array<{ query: string; values: unknown[] }> = []

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(query, this.records)
  }
}

function createFakeAiBinding() {
  return {
    autorag: () => ({
      search: async () => ({
        data: [
          {
            attributes: {
              file: {
                access_level: 'internal',
                citation_locator: 'doc://dispatch#chunk-1',
                document_version_id: 'version-dispatch',
              },
            },
            content: [
              {
                text: 'Task 5.1 dispatches askKnowledge through the session Durable Object path.',
                type: 'text',
              },
            ],
            score: 0.95,
          },
        ],
      }),
    }),
    run: async () => ({
      response: 'askKnowledge answered from the fake retrieval backend with Durable Object parity.',
      usage: {
        completion_tokens: 12,
        prompt_tokens: 24,
        total_tokens: 36,
      },
    }),
  }
}

function createFakeKvBinding() {
  const data = new Map<string, string>()

  return {
    get: async (key: string) => data.get(key) ?? null,
    put: async (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

function createRuntimeKnowledgeConfig() {
  return {
    bindings: {
      aiSearchIndex: 'fake-index',
      d1Database: 'DB',
      documentsBucket: 'BLOB',
      rateLimitKv: 'KV',
    },
    environment: 'local',
    governance: {
      retrieval: {
        maxResults: 3,
        minScore: 0.1,
      },
      thresholds: {
        answerMin: 55 / 100,
        directAnswerMin: 7 / 10,
        judgeMin: 45 / 100,
      },
    },
  }
}

function createTestEnv(
  overrides: Partial<McpSessionDurableObjectEnv> = {},
): McpSessionDurableObjectEnv {
  return {
    AI: createFakeAiBinding(),
    DB: new FakeD1Database(),
    KV: createFakeKvBinding(),
    NUXT_KNOWLEDGE_AI_SEARCH_INDEX: 'fake-index',
    NUXT_KNOWLEDGE_D1_DATABASE: 'DB',
    NUXT_KNOWLEDGE_ENVIRONMENT: 'local',
    NUXT_KNOWLEDGE_RATE_LIMIT_KV: 'KV',
    NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS: '60000',
    NUXT_MCP_AUTH_SIGNING_KEY: AUTH_SIGNING_KEY,
    ...overrides,
  }
}

function createFakeState(sessionId: string) {
  return {
    storage: new FakeStorage(),
    id: {
      equals: () => false,
      name: sessionId,
      toString: () => sessionId,
    },
    acceptWebSocket: () => undefined,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  }
}

function createFakeMcpSessionBinding(env: McpSessionDurableObjectEnv, now: () => number) {
  const objects = new Map<string, MCPSessionDurableObject>()

  return {
    idFromName: (sessionId: string) => {
      if (!objects.has(sessionId)) {
        objects.set(
          sessionId,
          new MCPSessionDurableObject(createFakeState(sessionId) as never, env, now),
        )
      }

      return {
        toString: () => sessionId,
        fetch: (request: Request) => objects.get(sessionId)!.fetch(request),
      }
    },
  }
}

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

function isCallToolResult(value: Record<string, unknown>): boolean {
  return (
    ('content' in value && Array.isArray(value.content)) ||
    'structuredContent' in value ||
    'isError' in value
  )
}

function normalizeToolResult(result: unknown) {
  if (typeof result === 'string') {
    return { content: [{ type: 'text' as const, text: result }] }
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return { content: [{ type: 'text' as const, text: String(result) }] }
  }

  if (typeof result === 'object' && result !== null && !isCallToolResult(result as never)) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }

  return result
}

async function loadKnowledgeTools(): Promise<McpToolDefinition[]> {
  const [askKnowledge, searchKnowledge, getDocumentChunk, listCategories] = await Promise.all([
    import('#server/mcp/tools/ask'),
    import('#server/mcp/tools/search'),
    import('#server/mcp/tools/get-document-chunk'),
    import('#server/mcp/tools/categories'),
  ])

  return [
    askKnowledge.default,
    searchKnowledge.default,
    getDocumentChunk.default,
    listCategories.default,
  ] as McpToolDefinition[]
}

async function buildKnowledgeServer() {
  const server = new McpServer({ name: 'dispatch-test-server', version: '0.0.0' })

  for (const tool of await loadKnowledgeTools()) {
    server.registerTool(
      tool.name,
      {
        _meta: {
          ...tool._meta,
          ...(tool.inputExamples ? { inputExamples: tool.inputExamples } : {}),
          ...(tool.tags?.length ? { tags: tool.tags } : {}),
        },
        annotations: tool.annotations as never,
        description: tool.description,
        inputSchema: tool.inputSchema as never,
        outputSchema: tool.outputSchema as never,
        title: tool.title,
      },
      async (...args: never[]) => normalizeToolResult(await tool.handler(...args)) as never,
    )
  }

  return server.server
}

async function makeStatelessHandler() {
  return createMcpHandler((await buildKnowledgeServer()) as never, { route: '/mcp' })
}

function createMcpEvent(env: Record<string, unknown>, request: Request) {
  return {
    context: {
      cloudflare: { env },
      log: {
        error: () => undefined,
        info: () => undefined,
        set: () => undefined,
        warn: () => undefined,
      },
      mcpAuth: AUTH_CONTEXT,
      params: {},
    },
    headers: request.headers,
    method: request.method,
    path: new URL(request.url).pathname,
    web: { request },
  }
}

function makeInitializeRequest(sessionId: string, authContextHeader?: string) {
  return new Request('https://worker.test/mcp', {
    method: 'POST',
    headers: createJsonHeaders(sessionId, authContextHeader),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'dispatch-test-client', version: '0.0.0' },
        protocolVersion: '2025-06-18',
      },
    }),
  })
}

function makeToolsListRequest(sessionId: string, authContextHeader: string) {
  return new Request('https://worker.test/mcp', {
    method: 'POST',
    headers: createJsonHeaders(sessionId, authContextHeader),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  })
}

function makeAskKnowledgeRequest(id: number, sessionId?: string, authContextHeader?: string) {
  return new Request('https://worker.test/mcp', {
    method: 'POST',
    headers: createJsonHeaders(sessionId, authContextHeader),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        arguments: {
          query: 'How does Task 5.1 dispatch askKnowledge?',
        },
        name: 'askKnowledge',
      },
    }),
  })
}

function createJsonHeaders(sessionId?: string, authContextHeader?: string) {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  })

  if (sessionId) {
    headers.set('Mcp-Session-Id', sessionId)
  }

  if (authContextHeader) {
    headers.set(MCP_AUTH_CONTEXT_HEADER, authContextHeader)
  }

  return headers
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  expect(text.startsWith('event:')).toBe(false)
  return JSON.parse(text) as T
}

async function callStatelessAsk(env: Record<string, unknown>) {
  const handler = await makeStatelessHandler()
  const request = makeAskKnowledgeRequest(2)
  pendingEvent.current = createMcpEvent(env, request)

  try {
    return await handler(request, env)
  } finally {
    pendingEvent.current = null
  }
}

async function callDurableObjectAsk(input: {
  authContextHeader: string
  env: McpSessionDurableObjectEnv
  handler: ReturnType<typeof createMcpHandler>
  mcpSession: ReturnType<typeof createFakeMcpSessionBinding>
  sessionId: string
}) {
  return input.handler(makeAskKnowledgeRequest(2, input.sessionId, input.authContextHeader), {
    ...input.env,
    MCP_SESSION: input.mcpSession,
    NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true',
  })
}

async function measureResponseLatency(callback: () => Promise<Response>) {
  const startedAt = performance.now()
  const response = await callback()
  await response.text()
  return performance.now() - startedAt
}

function averageLatency(samples: number[]) {
  return samples.reduce((total, sample) => total + sample, 0) / samples.length
}

const NOW = Date.UTC(2026, 3, 24, 10, 0, 0)
const AUTH_SIGNING_KEY = '0123456789abcdef0123456789abcdef'
const AUTH_CONTEXT = {
  principal: {
    authSource: 'oauth_access_token' as const,
    userId: 'user-dispatch',
  },
  scopes: [
    'knowledge.ask',
    'knowledge.search',
    'knowledge.category.list',
    'knowledge.citation.read',
  ],
  tokenId: 'oauth:dispatch-token',
}

function stubDeterministicUuid() {
  const randomUuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    return '00000000-0000-4000-8000-000000000001'
  })

  return {
    restore: () => randomUuid.mockRestore(),
  }
}

async function makeAuthContextHeader() {
  return signAuthContext(AUTH_CONTEXT, AUTH_SIGNING_KEY, NOW)
}

describe('MCP session DO tool dispatch', () => {
  beforeEach(() => {
    vi.stubGlobal('createError', (input: { message: string }) =>
      Object.assign(new Error(input.message), input),
    )
    vi.stubGlobal('defineMcpTool', <T>(definition: T) => definition)
    vi.stubGlobal('useRuntimeConfig', () => ({
      knowledge: createRuntimeKnowledgeConfig(),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    pendingEvent.current = null
  })

  it('routes tools/list to a real MCP server with four knowledge tool metadata entries', async () => {
    const sessionId = 'session-tools-list'
    const env = createTestEnv()
    const authContextHeader = await makeAuthContextHeader()
    const handler = createMcpHandler((await buildKnowledgeServer()) as never, { route: '/mcp' })
    const mcpSession = createFakeMcpSessionBinding(env, () => NOW)
    const handlerEnv = {
      ...env,
      MCP_SESSION: mcpSession,
      NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true',
    }

    const initializeResponse = await handler(
      makeInitializeRequest(sessionId, authContextHeader),
      handlerEnv,
    )
    expect(initializeResponse.status).toBe(200)

    const response = await handler(makeToolsListRequest(sessionId, authContextHeader), handlerEnv)

    expect(response.status).toBe(200)
    expect(response.headers.get('Mcp-Session-Id')).toBe(sessionId)

    const body = await readJson<{
      result: {
        tools: Array<{
          _meta?: Record<string, unknown>
          annotations?: Record<string, unknown>
          description?: string
          inputSchema?: Record<string, unknown>
          name: string
          title?: string
        }>
      }
    }>(response)
    const toolsByName = new Map(body.result.tools.map((tool) => [tool.name, tool]))

    expect([...toolsByName.keys()].toSorted()).toEqual([
      'askKnowledge',
      'getDocumentChunk',
      'listCategories',
      'searchKnowledge',
    ])

    for (const toolName of [
      'askKnowledge',
      'searchKnowledge',
      'getDocumentChunk',
      'listCategories',
    ]) {
      const tool = toolsByName.get(toolName)
      expect(tool?.title, `${toolName}.title`).toEqual(expect.any(String))
      expect(tool?.description, `${toolName}.description`).toEqual(expect.any(String))
      expect(tool?.inputSchema, `${toolName}.inputSchema`).toEqual(expect.any(Object))
      expect(tool?.annotations, `${toolName}.annotations`).toMatchObject({
        readOnlyHint: true,
      })
    }
  })

  it('routes tools/call askKnowledge through the DO path with stateless-equivalent response', async () => {
    const sessionId = 'session-ask-knowledge'
    const env = createTestEnv()
    const authContextHeader = await makeAuthContextHeader()
    const doHandler = createMcpHandler((await buildKnowledgeServer()) as never, { route: '/mcp' })
    const mcpSession = createFakeMcpSessionBinding(env, () => NOW)
    const doHandlerEnv = {
      ...env,
      MCP_SESSION: mcpSession,
      NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true',
    }

    const initializeResponse = await doHandler(
      makeInitializeRequest(sessionId, authContextHeader),
      doHandlerEnv,
    )
    expect(initializeResponse.status).toBe(200)

    const uuid = stubDeterministicUuid()
    const doResponse = await callDurableObjectAsk({
      authContextHeader,
      env,
      handler: doHandler,
      mcpSession,
      sessionId,
    })
    const statelessResponse = await callStatelessAsk(env)
    uuid.restore()

    expect(doResponse.status).toBe(200)
    expect(statelessResponse.status).toBe(200)
    expect(doResponse.headers.get('Mcp-Session-Id')).toBe(sessionId)

    const doBody = await readJson<unknown>(doResponse)
    const statelessBody = await readJson<unknown>(statelessResponse)

    expect(doBody).toEqual(statelessBody)
  })

  it('keeps DO path tool-call latency within 100ms of the stateless path', async () => {
    const sessionId = 'session-ask-knowledge-benchmark'
    const env = createTestEnv()
    const authContextHeader = await makeAuthContextHeader()
    const doHandler = createMcpHandler((await buildKnowledgeServer()) as never, { route: '/mcp' })
    const mcpSession = createFakeMcpSessionBinding(env, () => NOW)
    const doHandlerEnv = {
      ...env,
      MCP_SESSION: mcpSession,
      NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true',
    }

    const initializeResponse = await doHandler(
      makeInitializeRequest(sessionId, authContextHeader),
      doHandlerEnv,
    )
    expect(initializeResponse.status).toBe(200)

    const doSamples: number[] = []
    const statelessSamples: number[] = []
    for (let index = 0; index < 5; index += 1) {
      doSamples.push(
        await measureResponseLatency(() =>
          callDurableObjectAsk({
            authContextHeader,
            env,
            handler: doHandler,
            mcpSession,
            sessionId,
          }),
        ),
      )
      statelessSamples.push(await measureResponseLatency(() => callStatelessAsk(env)))
    }

    const deltaMs = averageLatency(doSamples) - averageLatency(statelessSamples)

    expect(deltaMs).toBeLessThanOrEqual(100)
  })
})
