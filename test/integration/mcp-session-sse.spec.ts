/**
 * Task 5.x — SSE channel on MCP Session Durable Object
 *
 * Requirements 對應（spec.md § ADDED Requirements）：
 *   - "MCP Session Durable Object Provides SSE Channel"
 *   - "MCP Session Resumes via Last-Event-Id"
 *   - "MCP Session Cleans Up on DELETE"
 *
 * 走直接 `new MCPSessionDurableObject(state, env, now)` 模式（同
 * `mcp-session-durable-object.spec.ts`），不經 `createMcpHandler` shim。SSE
 * mechanics 在 DO 層測；toolkit logger → notification wire end-to-end 由
 * §7.1 acceptance（curl 4 tool call + SSE-aware mock client）覆蓋。
 *
 * 5.x.1 basic SSE channel：GET /mcp 開 SSE + initial connected frame +
 *        server-initiated push 回流 + frame 格式
 * 5.x.2 Last-Event-Id replay：reconnect 不重複收 + invalid header 回
 *        events_dropped + TTL 過期 silent skip
 * 5.x.3 multi-connection：newer connection 變 active；舊 connection 只收
 *        heartbeat；close active fallback 到 next-newest；eventId 是單一
 *        counter（design.md 的 stream-1:N 編碼未實作）
 * 5.x.4 DELETE /mcp：清 sse-event:* + close streams + cancel alarm + 204
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MCPSessionDurableObject,
  type McpSessionDurableObjectEnv,
  type McpSessionState,
} from '#server/durable-objects/mcp-session'
import {
  encodeEventId,
  enqueueSseEvent,
  SSE_EVENT_KEY_PREFIX,
} from '#server/durable-objects/mcp-event-shim'
import { MCP_AUTH_CONTEXT_HEADER, signAuthContext } from '#server/utils/mcp-auth-context-codec'

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

// ---------- FakeStorage (同 mcp-session-durable-object.spec.ts; 抽 helper 由
// 後續重構處理，本檔暫保 inline 以隔離 §5.x scope) ----------

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
}

function createFakeState(sessionId: string) {
  const storage = new FakeStorage()
  const waitUntilTracker: Promise<unknown>[] = []
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
    // handleGet (mcp-session.ts:521) calls ctx.waitUntil(lifetime) to keep the
    // DO alive while the SSE stream is open. In real CF Workers this just
    // tracks the promise; in the test stub we collect them but never await,
    // so individual tests don't deadlock on the lifetime promise (which only
    // resolves when the writer is removed).
    waitUntil: (promise: Promise<unknown>) => {
      waitUntilTracker.push(promise)
    },
  }
}

const TEST_SIGNING_KEY = '0123456789abcdef0123456789abcdef'
const TEST_USER_ID = 'user-1'

function createEnv(overrides?: Partial<McpSessionDurableObjectEnv>): McpSessionDurableObjectEnv {
  return {
    NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS: '60000',
    NUXT_MCP_AUTH_SIGNING_KEY: TEST_SIGNING_KEY,
    ...overrides,
  }
}

async function makeAuthHeader(now: number, userId = TEST_USER_ID) {
  return signAuthContext(
    {
      principal: { authSource: 'oauth_access_token', userId },
      scopes: [
        'knowledge.ask',
        'knowledge.search',
        'knowledge.category.list',
        'knowledge.citation.read',
      ],
      tokenId: 'oauth:token-1',
    },
    TEST_SIGNING_KEY,
    now,
  )
}

function makeInitializeRequest(sessionId: string, authHeader: string) {
  return new Request(`https://do.test/mcp?session=${sessionId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Mcp-Session-Id': sessionId,
      [MCP_AUTH_CONTEXT_HEADER]: authHeader,
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

function makeGetSseRequest(sessionId: string, authHeader: string, lastEventId?: string) {
  const headers = new Headers({
    'Mcp-Session-Id': sessionId,
    [MCP_AUTH_CONTEXT_HEADER]: authHeader,
    accept: 'text/event-stream',
  })
  if (lastEventId) headers.set('Last-Event-Id', lastEventId)
  return new Request(`https://do.test/mcp?session=${sessionId}`, {
    method: 'GET',
    headers,
  })
}

function makeDeleteRequest(sessionId: string, authHeader: string) {
  return new Request(`https://do.test/mcp?session=${sessionId}`, {
    method: 'DELETE',
    headers: {
      'Mcp-Session-Id': sessionId,
      [MCP_AUTH_CONTEXT_HEADER]: authHeader,
    },
  })
}

// ---------- SSE frame parsing ----------

interface SseFrame {
  id?: string
  event?: string
  data?: unknown
  rawData?: string
  comment?: string
}

function parseSseBlock(block: string): SseFrame {
  const frame: SseFrame = {}
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      const txt = line.slice(1).trim()
      frame.comment = frame.comment ? `${frame.comment} ${txt}` : txt
      continue
    }
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon)
    const value = line.slice(colon + 1).trimStart()
    if (field === 'id') frame.id = value
    else if (field === 'event') frame.event = value
    else if (field === 'data') {
      frame.rawData = value
      try {
        frame.data = JSON.parse(value)
      } catch {
        frame.data = value
      }
    }
  }
  return frame
}

interface SseStream {
  reader: ReadableStreamDefaultReader<Uint8Array>
  buffer: { current: string }
}

function openSseStream(response: Response): SseStream {
  return {
    reader: response.body!.getReader(),
    buffer: { current: '' },
  }
}

async function closeSseStream(stream: SseStream): Promise<void> {
  await stream.reader.cancel().catch(() => {})
}

function drainBufferedFrames(stream: SseStream, frames: SseFrame[], count: number): void {
  let sep = stream.buffer.current.indexOf('\n\n')
  while (sep !== -1 && frames.length < count) {
    const block = stream.buffer.current.slice(0, sep)
    stream.buffer.current = stream.buffer.current.slice(sep + 2)
    if (block.length > 0) frames.push(parseSseBlock(block))
    sep = stream.buffer.current.indexOf('\n\n')
  }
}

/**
 * Read up to `count` SSE frames from the stream within `timeoutMs`. Returns
 * whatever was received (may be fewer than `count`). The reader is kept open
 * so the caller can issue follow-up reads on the same stream; close via
 * `closeSseStream(stream)` when done.
 */
async function readFrames(stream: SseStream, count: number, timeoutMs = 1000): Promise<SseFrame[]> {
  const decoder = new TextDecoder()
  const frames: SseFrame[] = []
  drainBufferedFrames(stream, frames, count)
  if (frames.length >= count) return frames

  const deadline = Date.now() + timeoutMs
  while (frames.length < count && Date.now() < deadline) {
    const remaining = Math.max(deadline - Date.now(), 1)
    let timerId: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      stream.reader.read(),
      new Promise<{ value: undefined; done: true; _timeout: true }>((resolve) => {
        timerId = setTimeout(
          () => resolve({ value: undefined, done: true, _timeout: true }),
          remaining,
        )
      }),
    ])
    if (timerId) clearTimeout(timerId)
    if (result.done) break
    stream.buffer.current += decoder.decode(result.value as Uint8Array, { stream: true })
    drainBufferedFrames(stream, frames, count)
  }
  return frames
}

// 透過 private method 觸發 server-initiated push（端對端 toolkit logger wire
// 由 §7.1 acceptance 覆蓋；這裡只測 SSE channel mechanics）
async function pushNotification(
  durableObject: MCPSessionDurableObject,
  message: JSONRPCMessage,
): Promise<void> {
  await (
    durableObject as unknown as {
      enqueueAndPushServerNotification(m: JSONRPCMessage): Promise<void>
    }
  ).enqueueAndPushServerNotification(message)
}

function makeProgressNotification(step: number): JSONRPCMessage {
  return {
    jsonrpc: '2.0',
    method: 'notifications/progress',
    params: { step },
  }
}

async function initializeSession(
  durableObject: MCPSessionDurableObject,
  sessionId: string,
  authHeader: string,
) {
  const response = await durableObject.fetch(makeInitializeRequest(sessionId, authHeader))
  expect(response.status).toBe(200)
  expect(response.headers.get('Mcp-Session-Id')).toBe(sessionId)
}

afterEach(() => {
  vi.useRealTimers()
})

// ---------- 5.x.1 basic SSE channel ----------

describe('Task 5.x.1 — basic SSE channel on GET /mcp', () => {
  it('GET /mcp returns 200 + Content-Type: text/event-stream + initial connected comment', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-sse-basic'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)

    const sseResp = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))

    expect(sseResp.status).toBe(200)
    expect(sseResp.headers.get('content-type')).toMatch(/text\/event-stream/)
    expect(sseResp.headers.get('Mcp-Session-Id')).toBe(sessionId)

    const stream = openSseStream(sseResp)
    try {
      const [first] = await readFrames(stream, 1)
      expect(first.comment).toContain('connected')
    } finally {
      await closeSseStream(stream)
    }
  })

  it('GET /mcp returns 404 when session not initialized', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-no-init'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    const resp = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    expect(resp.status).toBe(404)
  })

  it('server-initiated push appears as SSE frame with encodeEventId format', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-sse-push'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)

    const sseResp = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    expect(sseResp.status).toBe(200)

    const stream = openSseStream(sseResp)
    try {
      // Drain initial `: connected` comment first
      const [connected] = await readFrames(stream, 1)
      expect(connected.comment).toContain('connected')

      // Push a server-initiated notification
      const notification = makeProgressNotification(42)
      await pushNotification(durableObject, notification)

      // Expect 1 frame containing the notification
      const [pushed] = await readFrames(stream, 1)
      expect(pushed.id).toBe(encodeEventId(1))
      expect(pushed.data).toEqual(notification)
    } finally {
      await closeSseStream(stream)
    }
  })

  it('multiple pushed notifications arrive in encode order with monotonic counter', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-sse-order'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)
    const sseResp = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    const stream = openSseStream(sseResp)
    try {
      await readFrames(stream, 1) // drain `: connected`

      for (let i = 1; i <= 3; i += 1) {
        await pushNotification(durableObject, makeProgressNotification(i))
      }

      const frames = await readFrames(stream, 3)
      expect(frames.map((f) => f.id)).toEqual([
        encodeEventId(1),
        encodeEventId(2),
        encodeEventId(3),
      ])
      expect(frames.map((f) => (f.data as { params: { step: number } }).params.step)).toEqual([
        1, 2, 3,
      ])
    } finally {
      await closeSseStream(stream)
    }
  })
})

// ---------- 5.x.2 Last-Event-Id replay ----------

describe('Task 5.x.2 — Last-Event-Id replay', () => {
  it('reconnect with Last-Event-Id=e-N replays only events > N (no duplicates)', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-replay'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)

    // Open SSE channel A and push 5 events
    const respA = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    const streamA = openSseStream(respA)
    try {
      await readFrames(streamA, 1)
      for (let i = 1; i <= 5; i += 1) {
        await pushNotification(durableObject, makeProgressNotification(i))
      }
      const framesA = await readFrames(streamA, 5)
      expect(framesA.map((f) => f.id)).toEqual([1, 2, 3, 4, 5].map(encodeEventId))
    } finally {
      await closeSseStream(streamA)
    }

    // Reconnect with Last-Event-Id=e-3 → expect connected + replay 4, 5
    const respB = await durableObject.fetch(
      makeGetSseRequest(sessionId, authHeader, encodeEventId(3)),
    )
    expect(respB.status).toBe(200)
    const streamB = openSseStream(respB)
    try {
      const replayFrames = await readFrames(streamB, 3)
      expect(replayFrames[0].comment).toContain('connected')
      expect(replayFrames.slice(1).map((f) => f.id)).toEqual([encodeEventId(4), encodeEventId(5)])
    } finally {
      await closeSseStream(streamB)
    }
  })

  it('invalid Last-Event-Id emits notifications/events_dropped with reason invalid_last_event_id', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-invalid-leid'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)

    const resp = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader, 'garbage'))
    const stream = openSseStream(resp)
    try {
      const frames = await readFrames(stream, 2)
      expect(frames[0].comment).toContain('connected')

      const dropped = frames[1].data as {
        method: string
        params: { reason: string; header: string }
      }
      expect(dropped.method).toBe('notifications/events_dropped')
      expect(dropped.params.reason).toBe('invalid_last_event_id')
      expect(dropped.params.header).toBe('garbage')
    } finally {
      await closeSseStream(stream)
    }
  })

  it('Last-Event-Id pointing to TTL-expired event silently skips replay (no events_dropped)', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-replay-expired'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)

    // Stamp 3 events
    for (let i = 1; i <= 3; i += 1) {
      await enqueueSseEvent(state.storage as never, makeProgressNotification(i), now)
    }
    // Manually clear all sse-event:* rows to simulate TTL eviction
    const eventKeys = [...(await state.storage.list({ prefix: SSE_EVENT_KEY_PREFIX })).keys()]
    await state.storage.delete(eventKeys)

    const resp = await durableObject.fetch(
      makeGetSseRequest(sessionId, authHeader, encodeEventId(1)),
    )
    expect(resp.status).toBe(200)

    // Expect ONLY the connected comment within a short window — no replay frames
    const stream = openSseStream(resp)
    try {
      const frames = await readFrames(stream, 2, 200)
      expect(frames.length).toBeGreaterThanOrEqual(1)
      expect(frames[0].comment).toContain('connected')
      expect(frames.slice(1)).toEqual([])
    } finally {
      await closeSseStream(stream)
    }
  })
})

// ---------- 5.x.3 multi-connection routing ----------

describe('Task 5.x.3 — multi-connection broadcast routing', () => {
  it('server-initiated push broadcasts to every connected SSE writer with identical eventId', async () => {
    // 實作（mcp-session.ts:641-663）broadcast 到 `this.writers.values()`，
    // 非 design.md 早期描述的 newest-active routing。理由（impl comment）：
    // 「clients with multiple streams would silently miss events on the
    // non-newest stream」。client 端 spec MAY 重複收，需自行依 eventId dedupe。
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-multi'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)

    const respA = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    const streamA = openSseStream(respA)
    const respB = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    const streamB = openSseStream(respB)
    try {
      await readFrames(streamA, 1)
      await readFrames(streamB, 1)

      await pushNotification(durableObject, makeProgressNotification(1))

      const [aFrame] = await readFrames(streamA, 1)
      const [bFrame] = await readFrames(streamB, 1)

      expect(aFrame.id).toBe(encodeEventId(1))
      expect(bFrame.id).toBe(encodeEventId(1))
      expect(aFrame.data).toEqual(bFrame.data)
      expect((aFrame.data as { params: { step: number } }).params.step).toBe(1)
    } finally {
      await closeSseStream(streamA)
      await closeSseStream(streamB)
    }
  })

  it('eventId is single session-wide counter (not stream-1:N / stream-2:N notation)', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-counter-shared'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)

    const respA = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    const streamA = openSseStream(respA)
    try {
      await readFrames(streamA, 1)
      await pushNotification(durableObject, makeProgressNotification(1))
      const [a1] = await readFrames(streamA, 1)
      expect(a1.id).toBe(encodeEventId(1))
      expect(a1.id).not.toMatch(/^stream-/)
    } finally {
      await closeSseStream(streamA)
    }

    const respB = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    const streamB = openSseStream(respB)
    try {
      await readFrames(streamB, 1)
      await pushNotification(durableObject, makeProgressNotification(2))
      const [b1] = await readFrames(streamB, 1)
      // Counter is session-wide — second push gets counter=2 even though it's
      // the first event B sees on its stream
      expect(b1.id).toBe(encodeEventId(2))
      expect(b1.id).not.toMatch(/^stream-/)
    } finally {
      await closeSseStream(streamB)
    }
  })
})

// ---------- 5.x.4 DELETE /mcp ----------

describe('Task 5.x.4 — DELETE /mcp clears storage + closes streams + cancels alarm', () => {
  it('DELETE returns 204 and emits notifications/stream_closed with reason=session_deleted', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-delete'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)
    const sseResp = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    const stream = openSseStream(sseResp)
    try {
      await readFrames(stream, 1) // connected
      await pushNotification(durableObject, makeProgressNotification(1))
      await readFrames(stream, 1) // pushed event

      const deleteResp = await durableObject.fetch(makeDeleteRequest(sessionId, authHeader))
      expect(deleteResp.status).toBe(204)

      // SSE channel should receive notifications/stream_closed and end
      const tailFrames = await readFrames(stream, 5)
      const closeFrame = tailFrames.find(
        (f) =>
          (f.data as { method?: string } | undefined)?.method === 'notifications/stream_closed',
      )
      expect(closeFrame).toBeDefined()
      expect((closeFrame!.data as { params: { reason: string } }).params.reason).toBe(
        'session_deleted',
      )
    } finally {
      await closeSseStream(stream)
    }
  })

  it('DELETE clears all sse-event:* storage rows + cancels alarm', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-delete-storage'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)
    expect(await state.storage.getAlarm()).not.toBeNull()

    // Pre-populate event queue
    for (let i = 1; i <= 3; i += 1) {
      await pushNotification(durableObject, makeProgressNotification(i))
    }
    const eventsBefore = await state.storage.list({ prefix: SSE_EVENT_KEY_PREFIX })
    expect(eventsBefore.size).toBe(3)

    const deleteResp = await durableObject.fetch(makeDeleteRequest(sessionId, authHeader))
    expect(deleteResp.status).toBe(204)

    const eventsAfter = await state.storage.list({ prefix: SSE_EVENT_KEY_PREFIX })
    expect(eventsAfter.size).toBe(0)

    expect(await state.storage.getAlarm()).toBeNull()
  })

  it('subsequent GET /mcp on deleted session returns 404', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-delete-then-get'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    await initializeSession(durableObject, sessionId, authHeader)
    const deleteResp = await durableObject.fetch(makeDeleteRequest(sessionId, authHeader))
    expect(deleteResp.status).toBe(204)

    const getResp = await durableObject.fetch(makeGetSseRequest(sessionId, authHeader))
    expect(getResp.status).toBe(404)
  })

  it('DELETE on non-existent session returns 204 (idempotent)', async () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0)
    const sessionId = 'session-delete-empty'
    const env = createEnv()
    const state = createFakeState(sessionId)
    const durableObject = new MCPSessionDurableObject(state as never, env, () => now)
    const authHeader = await makeAuthHeader(now)

    const resp = await durableObject.fetch(makeDeleteRequest(sessionId, authHeader))
    expect(resp.status).toBe(204)
  })
})
