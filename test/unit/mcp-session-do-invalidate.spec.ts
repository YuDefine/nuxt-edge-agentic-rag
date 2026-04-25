/**
 * DO `__invalidate` bypass — token revoke cascade cleanup hits the DO with
 * an HMAC-signed `X-Mcp-Internal-Invalidate` header (no forwarded
 * auth-context envelope; admin/system flow has no user session).
 *
 * Spec: `oauth-remote-mcp-auth` requirement "Token revocation SHALL
 * cascade-invalidate active session Durable Object storage within bounded
 * time" (added by this change).
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { MCPSessionDurableObject } from '#server/durable-objects/mcp-session'
import { signInvalidateHeader } from '#server/utils/mcp-internal-invalidate'

import type {
  McpSessionDurableObjectEnv,
  McpSessionState,
} from '#server/durable-objects/mcp-session'
import { MCP_AUTH_CONTEXT_HEADER, signAuthContext } from '#server/utils/mcp-auth-context-codec'

const SIGNING_KEY = '0123456789abcdef0123456789abcdef'
const SESSION_ID = '00000000-0000-4000-8000-000000000099'

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

  async list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const key of [...this.data.keys()].toSorted()) {
      if (options?.prefix && !key.startsWith(options.prefix)) continue
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

  size(): number {
    return this.data.size
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
    acceptWebSocket: () => {},
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    waitUntil: () => {},
  }
}

function createEnv(): McpSessionDurableObjectEnv {
  return {
    NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS: '60000',
    NUXT_MCP_AUTH_SIGNING_KEY: SIGNING_KEY,
  }
}

async function makeAuthContextHeader(now: number) {
  return signAuthContext(
    {
      principal: { authSource: 'oauth_access_token', userId: 'user-1' },
      scopes: ['knowledge.ask'],
      tokenId: 'token-99',
    },
    SIGNING_KEY,
    now,
  )
}

function makeInitializeRequest(authContextHeader: string) {
  return new Request('https://do.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Mcp-Session-Id': SESSION_ID,
      [MCP_AUTH_CONTEXT_HEADER]: authContextHeader,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
    }),
  })
}

function makeInvalidateRequest(headerValue: string) {
  return new Request('https://do.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Mcp-Session-Id': SESSION_ID,
      'X-Mcp-Internal-Invalidate': headerValue,
    },
  })
}

describe('MCPSessionDurableObject — internal invalidate bypass', () => {
  let state: ReturnType<typeof createFakeState>
  let env: McpSessionDurableObjectEnv
  let now: number

  beforeEach(() => {
    state = createFakeState(SESSION_ID)
    env = createEnv()
    now = Date.UTC(2026, 3, 26, 10, 0, 0)
  })

  it('valid invalidate header → 200 + clears storage + clears alarm', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)

    // Bootstrap a real session so we can prove cleanup wipes it
    await durableObject.fetch(makeInitializeRequest(await makeAuthContextHeader(now)))
    expect(await state.storage.get<McpSessionState>('session')).toBeDefined()
    expect(await state.storage.getAlarm()).not.toBeNull()

    const header = await signInvalidateHeader({
      sessionId: SESSION_ID,
      secret: SIGNING_KEY,
      now,
    })
    const response = await durableObject.fetch(makeInvalidateRequest(header))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok?: boolean }
    expect(body.ok).toBe(true)

    expect(await state.storage.get<McpSessionState>('session')).toBeUndefined()
    expect(await state.storage.getAlarm()).toBeNull()
    expect(state.storage.size()).toBe(0)
  })

  it('valid invalidate against empty DO → 200 (no-op cleanup)', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)

    const header = await signInvalidateHeader({
      sessionId: SESSION_ID,
      secret: SIGNING_KEY,
      now,
    })
    const response = await durableObject.fetch(makeInvalidateRequest(header))

    expect(response.status).toBe(200)
    expect(state.storage.size()).toBe(0)
  })

  it('tampered signature → 403 + storage preserved', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)

    await durableObject.fetch(makeInitializeRequest(await makeAuthContextHeader(now)))
    const sessionBefore = await state.storage.get<McpSessionState>('session')
    expect(sessionBefore).toBeDefined()

    const validHeader = await signInvalidateHeader({
      sessionId: SESSION_ID,
      secret: SIGNING_KEY,
      now,
    })
    const parts = validHeader.split('.')
    const sigBytes = parts[3]!.split('')
    sigBytes[0] = sigBytes[0] === '0' ? '1' : '0'
    parts[3] = sigBytes.join('')
    const tampered = parts.join('.')

    const response = await durableObject.fetch(makeInvalidateRequest(tampered))

    expect(response.status).toBe(403)
    expect(await state.storage.get<McpSessionState>('session')).toEqual(sessionBefore)
  })

  it('signed for a different sessionId → 403', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)

    await durableObject.fetch(makeInitializeRequest(await makeAuthContextHeader(now)))

    const header = await signInvalidateHeader({
      sessionId: 'sess-different',
      secret: SIGNING_KEY,
      now,
    })
    const response = await durableObject.fetch(makeInvalidateRequest(header))

    expect(response.status).toBe(403)
    expect(await state.storage.get<McpSessionState>('session')).toBeDefined()
  })

  it('signed with a different secret → 403', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)

    await durableObject.fetch(makeInitializeRequest(await makeAuthContextHeader(now)))

    const header = await signInvalidateHeader({
      sessionId: SESSION_ID,
      secret: 'a-different-secret-of-32-bytes!!',
      now,
    })
    const response = await durableObject.fetch(makeInvalidateRequest(header))

    expect(response.status).toBe(403)
    expect(await state.storage.get<McpSessionState>('session')).toBeDefined()
  })

  it('header older than 60s skew → 403', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)

    await durableObject.fetch(makeInitializeRequest(await makeAuthContextHeader(now)))

    const header = await signInvalidateHeader({
      sessionId: SESSION_ID,
      secret: SIGNING_KEY,
      now: now - 60_001,
    })
    const response = await durableObject.fetch(makeInvalidateRequest(header))

    expect(response.status).toBe(403)
    expect(await state.storage.get<McpSessionState>('session')).toBeDefined()
  })

  it('no invalidate header → existing POST routing remains intact (initialize still works)', async () => {
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)

    const response = await durableObject.fetch(
      makeInitializeRequest(await makeAuthContextHeader(now)),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Mcp-Session-Id')).toBe(SESSION_ID)
    expect(await state.storage.get<McpSessionState>('session')).toBeDefined()
  })
})
