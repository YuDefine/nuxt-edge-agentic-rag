/**
 * Task 5.1 — DO session lifecycle coverage
 *
 * Requirement: "MCP Session Has Idle TTL With Request-Triggered Renewal"
 * + "MCP Session Durable Object Binding" (spec.md § ADDED Requirements).
 *
 * 這支 spec 把 DurableObject 的 `ctx` / `env` stub 掉，聚焦 verification：
 *   1. 首次 `initialize` → 建立 session，回 `Mcp-Session-Id` header
 *   2. 後續 request → `lastSeenAt` 續命、alarm 重新排程至 `lastSeenAt + TTL`
 *   3. Alarm 觸發 → 清空 storage；後續帶同 session id 的 request → 404
 *   4. Non-initialize request 但 session missing → 404（re-init guidance）
 *   5. GET / DELETE 在 DO 仍回 405（stateless shim 的 spec 2025-11-25 合規）
 *   6. Non-initialize request 對有 session 的 DO → 501 + JSON-RPC -32601
 *      指向 TD-041（tool dispatch 待 wire-do-tool-dispatch change 接手）
 *
 * Tool dispatch end-to-end（McpServer + DoJsonRpcTransport + tool handler）
 * 由後續 change `wire-do-tool-dispatch` 覆蓋，不在本 spec 範圍。
 */

import { describe, expect, it, beforeEach } from 'vitest'

import { MCPSessionDurableObject } from '#server/durable-objects/mcp-session'
import { MCP_AUTH_CONTEXT_HEADER, signAuthContext } from '#server/utils/mcp-auth-context-codec'

import type {
  McpSessionDurableObjectEnv,
  McpSessionState,
} from '#server/durable-objects/mcp-session'

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

  async delete(key: string | string[]): Promise<boolean | number> {
    if (Array.isArray(key)) {
      let deleted = 0
      for (const k of key) {
        if (this.data.delete(k)) deleted += 1
      }
      return deleted
    }
    return this.data.delete(key)
  }

  async list<T>(options?: {
    prefix?: string
    start?: string
    end?: string
    limit?: number
  }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    const sortedKeys = [...this.data.keys()].toSorted()
    for (const key of sortedKeys) {
      if (options?.prefix && !key.startsWith(options.prefix)) continue
      if (options?.start && key <= options.start) continue
      if (options?.end && key >= options.end) continue
      result.set(key, this.data.get(key) as T)
      if (options?.limit && result.size >= options.limit) break
    }
    return result
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

  _snapshot() {
    return { data: new Map(this.data), alarm: this.alarm }
  }
}

function createFakeState(sessionId: string) {
  const storage = new FakeStorage()
  return {
    storage,
    id: {
      toString: () => sessionId,
      name: sessionId,
      equals: () => false,
    },
    acceptWebSocket: () => {
      // no-op
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  }
}

function createEnv(overrides?: Partial<McpSessionDurableObjectEnv>): McpSessionDurableObjectEnv {
  return {
    NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS: '60000',
    NUXT_MCP_AUTH_SIGNING_KEY: '0123456789abcdef0123456789abcdef',
    ...overrides,
  }
}

function makeInitializeRequest(sessionId: string, authContextHeader?: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    'Mcp-Session-Id': sessionId,
  })
  if (authContextHeader) {
    headers.set(MCP_AUTH_CONTEXT_HEADER, authContextHeader)
  }
  return new Request(`https://do.test/mcp?session=${sessionId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    }),
  })
}

async function makeAuthContextHeader(now: number) {
  return signAuthContext(
    {
      principal: {
        authSource: 'oauth_access_token',
        userId: 'user-1',
      },
      scopes: [
        'knowledge.ask',
        'knowledge.search',
        'knowledge.category.list',
        'knowledge.citation.read',
      ],
      tokenId: 'oauth:token-1',
    },
    '0123456789abcdef0123456789abcdef',
    now,
  )
}

async function makeInvalidSignatureAuthContextHeader(now: number) {
  const header = await makeAuthContextHeader(now)
  const envelope = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
    payload: string
    signature: string
  }
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')) as {
    auth: { scopes: string[] }
  }
  payload.auth.scopes = ['knowledge.ask', 'knowledge.search', 'knowledge.admin']

  return Buffer.from(
    JSON.stringify({
      ...envelope,
      payload: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    }),
    'utf8',
  ).toString('base64url')
}

function makeToolsListRequest(sessionId: string, authContextHeader?: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    'Mcp-Session-Id': sessionId,
  })
  if (authContextHeader) {
    headers.set(MCP_AUTH_CONTEXT_HEADER, authContextHeader)
  }

  return new Request('https://do.test/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  })
}

describe('MCPSessionDurableObject — session lifecycle', () => {
  const sessionId = '00000000-0000-4000-8000-000000000001'
  let state: ReturnType<typeof createFakeState>
  let env: McpSessionDurableObjectEnv
  let now: number

  beforeEach(() => {
    state = createFakeState(sessionId)
    env = createEnv()
    now = Date.UTC(2026, 3, 24, 10, 0, 0)
  })

  it('first initialize creates persistent session state with Mcp-Session-Id header', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const response = await durableObject.fetch(
      makeInitializeRequest(sessionId, await makeAuthContextHeader(now)),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Mcp-Session-Id')).toBe(sessionId)

    const storedSession = await state.storage.get<McpSessionState>('session')
    expect(storedSession).toMatchObject({
      sessionId,
      createdAt: now,
      lastSeenAt: now,
      initializedServer: true,
    })
  })

  it('subsequent request renews lastSeenAt and reschedules alarm at lastSeenAt + TTL', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    // Bootstrap session
    await durableObject.fetch(makeInitializeRequest(sessionId, await makeAuthContextHeader(now)))
    const alarmAfterInit = await state.storage.getAlarm()
    expect(alarmAfterInit).toBe(now + 60_000)

    now += 10_000
    const renewResponse = await durableObject.fetch(
      makeToolsListRequest(sessionId, await makeAuthContextHeader(now)),
    )
    expect(renewResponse.status).toBe(200)

    const storedSession = await state.storage.get<McpSessionState>('session')
    expect(storedSession?.lastSeenAt).toBe(now)
    expect(await state.storage.getAlarm()).toBe(now + 60_000)
  })

  it('non-initialize on live session dispatches tools/list through McpServer', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    await durableObject.fetch(makeInitializeRequest(sessionId, await makeAuthContextHeader(now)))

    const response = await durableObject.fetch(
      makeToolsListRequest(sessionId, await makeAuthContextHeader(now)),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Mcp-Session-Id')).toBe(sessionId)

    const body = (await response.json()) as {
      jsonrpc: string
      id: number | string | null
      result?: { tools?: Array<{ name: string }> }
    }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(body.result?.tools?.map((tool) => tool.name).toSorted()).toEqual([
      'askKnowledge',
      'getDocumentChunk',
      'listCategories',
      'searchKnowledge',
    ])
  })

  it('invalid auth context signature returns 401 without renewing lastSeenAt', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    await durableObject.fetch(makeInitializeRequest(sessionId, await makeAuthContextHeader(now)))
    const storedBefore = await state.storage.get<McpSessionState>('session')

    now += 10_000
    const response = await durableObject.fetch(
      makeToolsListRequest(sessionId, await makeInvalidSignatureAuthContextHeader(now)),
    )

    expect(response.status).toBe(401)
    const storedAfter = await state.storage.get<McpSessionState>('session')
    expect(storedAfter?.lastSeenAt).toBe(storedBefore?.lastSeenAt)
  })

  it('expired auth context header returns 401 with expiry diagnostics', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    await durableObject.fetch(makeInitializeRequest(sessionId, await makeAuthContextHeader(now)))
    const storedBefore = await state.storage.get<McpSessionState>('session')

    const staleHeader = await makeAuthContextHeader(now)
    now += 60_001
    const response = await durableObject.fetch(makeToolsListRequest(sessionId, staleHeader))

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message).toMatch(/expired/i)
    const storedAfter = await state.storage.get<McpSessionState>('session')
    expect(storedAfter?.lastSeenAt).toBe(storedBefore?.lastSeenAt)
  })

  it('missing auth context header returns 400 without renewing lastSeenAt', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    await durableObject.fetch(makeInitializeRequest(sessionId, await makeAuthContextHeader(now)))
    const storedBefore = await state.storage.get<McpSessionState>('session')

    now += 10_000
    const response = await durableObject.fetch(makeToolsListRequest(sessionId))

    expect(response.status).toBe(400)
    const storedAfter = await state.storage.get<McpSessionState>('session')
    expect(storedAfter?.lastSeenAt).toBe(storedBefore?.lastSeenAt)
  })

  it('alarm() clears session storage so later requests receive 404', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    await durableObject.fetch(makeInitializeRequest(sessionId, await makeAuthContextHeader(now)))

    now += 60_001
    await durableObject.alarm()

    expect(await state.storage.get<McpSessionState>('session')).toBeUndefined()

    now += 120_000
    const response = await durableObject.fetch(makeToolsListRequest(sessionId))
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: { message?: string } }
    expect(body.error?.message ?? '').toMatch(/re-?initialize/i)
  })

  it('alarm() keeps a session that was renewed before the current TTL expires', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    await durableObject.fetch(makeInitializeRequest(sessionId, await makeAuthContextHeader(now)))

    now += 10_000
    await durableObject.fetch(makeToolsListRequest(sessionId, await makeAuthContextHeader(now)))
    const renewedAt = now

    now = renewedAt + 55_000
    await durableObject.alarm()

    const storedSession = await state.storage.get<McpSessionState>('session')
    expect(storedSession?.lastSeenAt).toBe(renewedAt)
    expect(await state.storage.getAlarm()).toBe(renewedAt + 60_000)
  })

  it('non-initialize request without prior session returns 404', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const response = await durableObject.fetch(makeToolsListRequest(sessionId))
    expect(response.status).toBe(404)
  })

  it('GET / DELETE without prior session — GET returns 404, DELETE returns 204', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)

    const getResp = await durableObject.fetch(new Request('https://do.test/mcp', { method: 'GET' }))
    expect(getResp.status).toBe(404)

    const deleteResp = await durableObject.fetch(
      new Request('https://do.test/mcp', { method: 'DELETE' }),
    )
    expect(deleteResp.status).toBe(204)
  })

  it('initialize without auth context header returns 400 (DO independently validates)', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const response = await durableObject.fetch(makeInitializeRequest(sessionId))
    expect(response.status).toBe(400)
    expect(await state.storage.get<McpSessionState>('session')).toBeUndefined()
  })

  it('non-initialize request from a different principal returns 403 ownership mismatch', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    await durableObject.fetch(makeInitializeRequest(sessionId, await makeAuthContextHeader(now)))

    now += 1_000
    const otherUserHeader = await signAuthContext(
      {
        principal: { authSource: 'oauth_access_token', userId: 'attacker-user' },
        scopes: ['knowledge.ask'],
        tokenId: 'oauth:attacker-token',
      },
      '0123456789abcdef0123456789abcdef',
      now,
    )
    const response = await durableObject.fetch(makeToolsListRequest(sessionId, otherUserHeader))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message ?? '').toMatch(/ownership mismatch/i)
  })

  it('re-initialize attempted by a different principal returns 403 ownership mismatch', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    await durableObject.fetch(makeInitializeRequest(sessionId, await makeAuthContextHeader(now)))

    now += 1_000
    const otherUserHeader = await signAuthContext(
      {
        principal: { authSource: 'oauth_access_token', userId: 'attacker-user' },
        scopes: ['knowledge.ask'],
        tokenId: 'oauth:attacker-token',
      },
      '0123456789abcdef0123456789abcdef',
      now,
    )
    const response = await durableObject.fetch(makeInitializeRequest(sessionId, otherUserHeader))
    expect(response.status).toBe(403)
  })
})
