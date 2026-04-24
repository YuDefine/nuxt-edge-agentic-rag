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
 *
 * Tool handler 的 integration 留在 staging 實測（見 tasks.md §6）——本 spec 不
 * 驗 `tools/call` end-to-end，只驗 transport / session 層行為。
 */

import { describe, expect, it, beforeEach } from 'vitest'

import { MCPSessionDurableObject } from '#server/durable-objects/mcp-session'

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
    ...overrides,
  }
}

function makeInitializeRequest(sessionId: string) {
  return new Request(`https://do.test/mcp?session=${sessionId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Mcp-Session-Id': sessionId,
    },
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

function makeToolsListRequest(sessionId: string) {
  return new Request('https://do.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Mcp-Session-Id': sessionId,
    },
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
    const response = await durableObject.fetch(makeInitializeRequest(sessionId))

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
    await durableObject.fetch(makeInitializeRequest(sessionId))
    const alarmAfterInit = await state.storage.getAlarm()
    expect(alarmAfterInit).toBe(now + 60_000)

    now += 10_000
    await durableObject.fetch(makeToolsListRequest(sessionId))

    const storedSession = await state.storage.get<McpSessionState>('session')
    expect(storedSession?.lastSeenAt).toBe(now)
    expect(await state.storage.getAlarm()).toBe(now + 60_000)
  })

  it('alarm() clears session storage so later requests receive 404', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    await durableObject.fetch(makeInitializeRequest(sessionId))

    await durableObject.alarm()

    expect(await state.storage.get<McpSessionState>('session')).toBeUndefined()

    now += 120_000
    const response = await durableObject.fetch(makeToolsListRequest(sessionId))
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: { message?: string } }
    expect(body.error?.message ?? '').toMatch(/re-?initialize/i)
  })

  it('non-initialize request without prior session returns 404', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const response = await durableObject.fetch(makeToolsListRequest(sessionId))
    expect(response.status).toBe(404)
  })

  it('GET/DELETE return 405 inside DO path (matches stateless shim behaviour)', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)

    const getResp = await durableObject.fetch(new Request('https://do.test/mcp', { method: 'GET' }))
    expect(getResp.status).toBe(405)
    expect(getResp.headers.get('Allow')).toBe('POST')

    const deleteResp = await durableObject.fetch(
      new Request('https://do.test/mcp', { method: 'DELETE' }),
    )
    expect(deleteResp.status).toBe(405)
  })
})
