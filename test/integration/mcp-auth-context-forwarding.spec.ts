import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MCPSessionDurableObject } from '#server/durable-objects/mcp-session'
import { createMcpHandler } from '#server/utils/mcp-agents-compat'
import { MCP_AUTH_CONTEXT_HEADER } from '#server/utils/mcp-auth-context-codec'
import { rehydrateMcpRequestBody } from '#server/utils/mcp-rehydrate-request-body'
import { runMcpMiddleware } from '#server/utils/mcp-middleware'

import type {
  McpSessionDurableObjectEnv,
  McpSessionState,
} from '#server/durable-objects/mcp-session'
import type { McpTokenRecord } from '#shared/types/knowledge'

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    readBody: async (event: H3Event) => {
      return (event as unknown as { _body?: unknown })._body
    },
  }
})

const authSigningKey = '0123456789abcdef0123456789abcdef'
const sessionId = '00000000-0000-4000-8000-000000000053'

type StorageValue =
  | McpSessionState
  | string
  | number
  | boolean
  | Record<string, unknown>
  | undefined

class FakeStorage {
  private readonly data = new Map<string, StorageValue>()
  private alarm: number | null = null

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value as StorageValue)
  }

  async deleteAll(): Promise<void> {
    this.data.clear()
    this.alarm = null
  }

  async setAlarm(time: number | Date): Promise<void> {
    this.alarm = time instanceof Date ? time.getTime() : time
  }
}

function createFakeState(id: string) {
  return {
    storage: new FakeStorage(),
    id: {
      toString: () => id,
      name: id,
      equals: () => false,
    },
    acceptWebSocket: () => {},
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  }
}

class FakeMcpSessionNamespace {
  readonly idFromName = vi.fn((name: string) => {
    const durableObject = this.getOrCreateDurableObject(name)
    return {
      toString: () => name,
      fetch: (request: Request) => {
        this.forwardedRequests.push(request.clone())
        return durableObject.fetch(request)
      },
    }
  })

  readonly forwardedRequests: Request[] = []
  private readonly instances = new Map<string, MCPSessionDurableObject>()

  constructor(
    private readonly env: McpSessionDurableObjectEnv,
    private readonly now: () => number,
  ) {}

  private getOrCreateDurableObject(name: string): MCPSessionDurableObject {
    const existing = this.instances.get(name)
    if (existing) {
      return existing
    }

    const durableObject = new MCPSessionDurableObject(
      createFakeState(name) as never,
      this.env,
      this.now,
    )
    this.instances.set(name, durableObject)
    return durableObject
  }
}

function createKv() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  }
}

function createTokenRecord(): McpTokenRecord {
  return {
    createdAt: '2026-04-24T00:00:00.000Z',
    createdByUserId: 'admin-1',
    environment: 'local',
    expiresAt: null,
    id: 'token-1',
    lastUsedAt: null,
    name: 'Task 5.3 integration token',
    revokedAt: null,
    revokedReason: null,
    scopesJson: JSON.stringify([
      'knowledge.ask',
      'knowledge.search',
      'knowledge.category.list',
      'knowledge.citation.read',
    ]),
    status: 'active',
    tokenHash: 'hash',
  }
}

function createBody(method: string, id: number | null) {
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      method,
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'task-5-3-test', version: '0.0.0' },
      },
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {},
  }
}

function makeEvent(body: unknown): H3Event {
  const headers = new Headers({
    authorization: 'Bearer valid-token',
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    host: 'worker.test',
    'Mcp-Session-Id': sessionId,
    'x-forwarded-proto': 'https',
  })

  const request = new Request('https://worker.test/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  return {
    _body: body,
    headers,
    context: {
      cloudflare: {
        env: {
          KV: createKv(),
        },
      },
      params: {},
    },
    req: request.clone(),
    web: {
      request,
    },
  } as unknown as H3Event
}

function makeReqOnlyEvent(body: unknown): H3Event {
  const event = makeEvent(body) as unknown as H3Event & {
    req?: { headers: Headers; method: string; url: string }
    web?: { request?: Request }
  }
  event.req = {
    headers: event.headers,
    method: 'POST',
    url: '/mcp',
  }
  delete event.web
  return event
}

function makeEnv(namespace: FakeMcpSessionNamespace) {
  return {
    KV: createKv(),
    MCP_SESSION: namespace,
    NUXT_KNOWLEDGE_FEATURE_MCP_SESSION: 'true',
    NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS: '60000',
    NUXT_MCP_AUTH_SIGNING_KEY: authSigningKey,
  }
}

function makeFallbackServer() {
  return {
    connect: vi.fn(async () => {}),
    transport: undefined as unknown,
  }
}

function makeHandler() {
  const fallbackServer = makeFallbackServer()
  const handler = createMcpHandler(fallbackServer, { route: '/mcp' })
  return { fallbackServer, handler }
}

async function runMiddlewareAndRehydrate(body: unknown, now: number): Promise<H3Event> {
  const event = makeEvent(body)
  await runMcpMiddleware(event as never, {
    authSigningKey,
    environment: 'local',
    extractToolNames: async () => [],
    kvBindingName: 'KV',
    now,
    tokenStore: {
      findUsableTokenByHash: vi.fn().mockResolvedValue(createTokenRecord()),
      touchLastUsedAt: vi.fn().mockResolvedValue(undefined),
    },
    userRoleLookup: {
      lookupRoleByUserId: vi.fn().mockResolvedValue('admin'),
    },
  })

  await rehydrateMcpRequestBody(event)
  return event
}

async function forwardThroughCompat(options: {
  body: unknown
  handler: ReturnType<typeof makeHandler>['handler']
  namespace: FakeMcpSessionNamespace
  now: number
  tamperHeader?: boolean
}) {
  const event = await runMiddlewareAndRehydrate(options.body, options.now)
  const envelope = (event as unknown as { context: { mcpAuthEnvelope?: string } }).context
    .mcpAuthEnvelope
  expect(envelope).toEqual(expect.any(String))

  const request = (event as unknown as { web: { request: Request } }).web.request
  expect(request.headers.get(MCP_AUTH_CONTEXT_HEADER)).toBe(envelope)
  const preferredRequest = (event as unknown as { req?: Request }).req
  expect(preferredRequest?.headers.get(MCP_AUTH_CONTEXT_HEADER)).toBe(envelope)

  const forwardedRequest = options.tamperHeader
    ? cloneRequestWithTamperedAuthHeader(request)
    : request

  return options.handler(forwardedRequest, makeEnv(options.namespace))
}

function cloneRequestWithTamperedAuthHeader(request: Request): Request {
  const headers = new Headers(request.headers)
  const envelope = JSON.parse(
    Buffer.from(headers.get(MCP_AUTH_CONTEXT_HEADER) ?? '', 'base64url').toString('utf8'),
  ) as { payload: string; signature: string }
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')) as {
    auth: { scopes: string[] }
  }
  payload.auth.scopes = [...payload.auth.scopes, 'knowledge.admin']
  headers.set(
    MCP_AUTH_CONTEXT_HEADER,
    Buffer.from(
      JSON.stringify({
        ...envelope,
        payload: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
      }),
      'utf8',
    ).toString('base64url'),
  )

  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    duplex: 'half',
  } as RequestInit)
}

describe('MCP auth context forwarding through middleware, compat shim, and session DO', () => {
  let now: number
  let namespace: FakeMcpSessionNamespace

  beforeEach(() => {
    vi.stubGlobal(
      'createError',
      vi.fn((input: { statusCode: number; message: string }) =>
        Object.assign(new Error(input.message), input),
      ),
    )
    vi.stubGlobal('setResponseHeader', vi.fn())
    vi.stubGlobal('getRequestURL', () => new URL('https://worker.test/mcp'))

    now = Date.UTC(2026, 3, 24, 10, 0, 0)
    namespace = new FakeMcpSessionNamespace(
      {
        NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS: '60000',
        NUXT_MCP_AUTH_SIGNING_KEY: authSigningKey,
      },
      () => now,
    )
  })

  it('forwards the middleware-signed envelope through rehydrate and compat so the DO verifies tools/list', async () => {
    const { fallbackServer, handler } = makeHandler()

    const initializeResponse = await forwardThroughCompat({
      body: createBody('initialize', 0),
      handler,
      namespace,
      now,
    })
    expect(initializeResponse.status).toBe(200)
    expect(initializeResponse.headers.get('Mcp-Session-Id')).toBe(sessionId)

    now += 1_000
    const toolsListResponse = await forwardThroughCompat({
      body: createBody('tools/list', 1),
      handler,
      namespace,
      now,
    })

    expect(toolsListResponse.status).toBe(200)
    expect(toolsListResponse.headers.get('Mcp-Session-Id')).toBe(sessionId)
    expect(fallbackServer.connect).not.toHaveBeenCalled()
    expect(namespace.idFromName).toHaveBeenCalledWith(sessionId)
    expect(namespace.forwardedRequests.at(-1)?.headers.get(MCP_AUTH_CONTEXT_HEADER)).toEqual(
      expect.any(String),
    )

    const body = (await toolsListResponse.json()) as {
      result?: { tools?: Array<{ name: string }> }
    }
    expect(body.result?.tools?.map((tool) => tool.name).toSorted()).toEqual([
      'askKnowledge',
      'getDocumentChunk',
      'listCategories',
      'searchKnowledge',
    ])
  })

  it('rehydrates the preferred request when the Worker event only exposes req', async () => {
    const event = makeReqOnlyEvent(createBody('tools/list', 1))
    await runMcpMiddleware(event as never, {
      authSigningKey,
      environment: 'local',
      extractToolNames: async () => [],
      kvBindingName: 'KV',
      now,
      tokenStore: {
        findUsableTokenByHash: vi.fn().mockResolvedValue(createTokenRecord()),
        touchLastUsedAt: vi.fn().mockResolvedValue(undefined),
      },
      userRoleLookup: {
        lookupRoleByUserId: vi.fn().mockResolvedValue('admin'),
      },
    })

    await rehydrateMcpRequestBody(event)

    const envelope = (event as unknown as { context: { mcpAuthEnvelope?: string } }).context
      .mcpAuthEnvelope
    const request = (event as unknown as { req?: Request }).req
    expect(request?.headers.get(MCP_AUTH_CONTEXT_HEADER)).toBe(envelope)
    expect((event as unknown as { web?: { request?: Request } }).web?.request).toBe(request)
  })

  it('returns 401 from the DO when the forwarded auth context header is tampered', async () => {
    const { handler } = makeHandler()
    await forwardThroughCompat({
      body: createBody('initialize', 0),
      handler,
      namespace,
      now,
    })

    now += 1_000
    const response = await forwardThroughCompat({
      body: createBody('tools/list', 1),
      handler,
      namespace,
      now,
      tamperHeader: true,
    })

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message).toMatch(/invalid_signature/)
  })

  it('falls back to the stateless compat path when the auth context header is absent', async () => {
    const { fallbackServer, handler } = makeHandler()
    const response = await handler(
      new Request('https://worker.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify(createBody('tools/list', 1)),
      }),
      makeEnv(namespace),
    )

    expect(namespace.idFromName).not.toHaveBeenCalled()
    expect(fallbackServer.connect).toHaveBeenCalled()
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('returns 400 from the DO when a live session request has no auth context header', async () => {
    const durableObject = new MCPSessionDurableObject(
      createFakeState(sessionId) as never,
      {
        NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS: '60000',
        NUXT_MCP_AUTH_SIGNING_KEY: authSigningKey,
      },
      () => now,
    )
    await durableObject.fetch(
      new Request('https://do.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify(createBody('initialize', 0)),
      }),
    )

    const response = await durableObject.fetch(
      new Request('https://do.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify(createBody('tools/list', 1)),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message).toMatch(/missing_header/)
  })
})
