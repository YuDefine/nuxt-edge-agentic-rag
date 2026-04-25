import { describe, expect, it } from 'vitest'

function makeMessage(n: number) {
  return {
    jsonrpc: '2.0',
    method: 'notifications/progress',
    params: { step: n },
  } as const
}

import {
  cleanupExpiredEvents,
  decodeEventId,
  encodeEventId,
  enforceEventQuota,
  enqueueSseEvent,
  listEventsAfter,
  SSE_EVENT_KEY_PREFIX,
  SSE_MAX_EVENTS_PER_SESSION,
} from '#server/durable-objects/mcp-event-shim'

import type { SseEventRow } from '#server/durable-objects/mcp-event-shim'

type StorageMap = Map<string, unknown>

// Local minimal storage surface, matching `SessionStorage` inside the shim.
interface StorageStub {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(key: string, value: T) => Promise<void>
  delete: (key: string | string[]) => Promise<boolean | number>
  list: <T>(options?: {
    prefix?: string
    start?: string
    end?: string
    limit?: number
  }) => Promise<Map<string, T>>
}

function createStorageStub(): StorageStub {
  const map: StorageMap = new Map()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      map.set(key, value)
    },
    async delete(key: string | string[]): Promise<boolean | number> {
      if (Array.isArray(key)) {
        let deleted = 0
        for (const k of key) {
          if (map.delete(k)) deleted += 1
        }
        return deleted
      }
      return map.delete(key)
    },
    async list<T>(options?: {
      prefix?: string
      start?: string
      end?: string
      limit?: number
    }): Promise<Map<string, T>> {
      const result = new Map<string, T>()
      const sortedKeys = [...map.keys()].toSorted()
      for (const key of sortedKeys) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue
        if (options?.start && key <= options.start) continue
        if (options?.end && key >= options.end) continue
        result.set(key, map.get(key) as T)
        if (options?.limit && result.size >= options.limit) break
      }
      return result
    },
  }
}

describe('encodeEventId / decodeEventId', () => {
  it('encodes counter to zero-padded event id', () => {
    expect(encodeEventId(1)).toBe('e-0000000000000001')
    expect(encodeEventId(99999)).toBe('e-0000000000099999')
  })

  it('decodes valid event id to counter', () => {
    expect(decodeEventId('e-0000000000000001')).toBe(1)
    expect(decodeEventId('e-0000000000099999')).toBe(99999)
  })

  it('returns null for malformed event id', () => {
    expect(decodeEventId('')).toBeNull()
    expect(decodeEventId('invalid')).toBeNull()
    expect(decodeEventId('e-')).toBeNull()
    expect(decodeEventId('e-abc')).toBeNull()
    expect(decodeEventId('x-0000000000000001')).toBeNull()
  })

  it('round-trips monotonic counters', () => {
    for (const n of [1, 42, 100, 9999]) {
      expect(decodeEventId(encodeEventId(n))).toBe(n)
    }
  })
})

describe('enqueueSseEvent', () => {
  it('stores event with counter + returns event id', async () => {
    const storage = createStorageStub()
    const message = {
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { data: 'hello' },
    } as const

    const result = await enqueueSseEvent(storage, message, 1_700_000_000_000)

    expect(result.counter).toBe(1)
    expect(result.eventId).toBe('e-0000000000000001')

    const row = await storage.get<SseEventRow>(`${SSE_EVENT_KEY_PREFIX}0000000000000001`)
    expect(row).toEqual({
      counter: 1,
      message,
      timestamp: 1_700_000_000_000,
    })
  })

  it('increments counter across calls', async () => {
    const storage = createStorageStub()
    const msg = { jsonrpc: '2.0', method: 'notifications/log', params: {} } as const

    const a = await enqueueSseEvent(storage, msg, 1)
    const b = await enqueueSseEvent(storage, msg, 2)
    const c = await enqueueSseEvent(storage, msg, 3)

    expect(a.counter).toBe(1)
    expect(b.counter).toBe(2)
    expect(c.counter).toBe(3)
  })
})

describe('listEventsAfter', () => {
  it('returns events with counter > lastCounter in order', async () => {
    const storage = createStorageStub()

    for (let i = 1; i <= 5; i += 1) {
      await enqueueSseEvent(storage, makeMessage(i), i)
    }

    const missed = await listEventsAfter(storage, 2)
    expect(missed.map((e) => e.counter)).toEqual([3, 4, 5])
  })

  it('returns empty array when no events after lastCounter', async () => {
    const storage = createStorageStub()
    await enqueueSseEvent(storage, { jsonrpc: '2.0', method: 'notifications/log', params: {} }, 1)
    expect(await listEventsAfter(storage, 10)).toEqual([])
  })

  it('returns all events when lastCounter is 0', async () => {
    const storage = createStorageStub()
    for (let i = 1; i <= 3; i += 1) {
      await enqueueSseEvent(
        storage,
        { jsonrpc: '2.0', method: 'notifications/log', params: { n: i } },
        i,
      )
    }

    const all = await listEventsAfter(storage, 0)
    expect(all.map((e) => e.counter)).toEqual([1, 2, 3])
  })
})

describe('enforceEventQuota', () => {
  it('deletes oldest events when exceeding max', async () => {
    const storage = createStorageStub()
    for (let i = 1; i <= SSE_MAX_EVENTS_PER_SESSION + 10; i += 1) {
      await enqueueSseEvent(storage, { jsonrpc: '2.0', method: 'notifications/log', params: {} }, i)
    }

    await enforceEventQuota(storage)

    const remaining = await listEventsAfter(storage, 0)
    expect(remaining.length).toBe(SSE_MAX_EVENTS_PER_SESSION)
    // Oldest 10 deleted (counters 1-10), newest 100 kept (counters 11-110)
    expect(remaining[0].counter).toBe(11)
    expect(remaining[remaining.length - 1].counter).toBe(SSE_MAX_EVENTS_PER_SESSION + 10)
  })

  it('no-op when count <= max', async () => {
    const storage = createStorageStub()
    for (let i = 1; i <= 5; i += 1) {
      await enqueueSseEvent(storage, { jsonrpc: '2.0', method: 'notifications/log', params: {} }, i)
    }

    await enforceEventQuota(storage)

    const remaining = await listEventsAfter(storage, 0)
    expect(remaining.length).toBe(5)
  })
})

describe('cleanupExpiredEvents', () => {
  it('deletes events older than maxAgeMs', async () => {
    const storage = createStorageStub()
    const now = 1_700_000_000_000
    const fiveMinMs = 5 * 60 * 1000

    // 3 old events (6 min ago)
    for (let i = 1; i <= 3; i += 1) {
      await enqueueSseEvent(
        storage,
        { jsonrpc: '2.0', method: 'notifications/log', params: {} },
        now - 6 * 60 * 1000,
      )
    }
    // 2 recent events (2 min ago)
    for (let i = 4; i <= 5; i += 1) {
      await enqueueSseEvent(
        storage,
        { jsonrpc: '2.0', method: 'notifications/log', params: {} },
        now - 2 * 60 * 1000,
      )
    }

    await cleanupExpiredEvents(storage, fiveMinMs, now)

    const remaining = await listEventsAfter(storage, 0)
    expect(remaining.length).toBe(2)
    expect(remaining.map((e) => e.counter)).toEqual([4, 5])
  })

  it('no-op when all events within maxAgeMs', async () => {
    const storage = createStorageStub()
    const now = 1_700_000_000_000
    await enqueueSseEvent(
      storage,
      { jsonrpc: '2.0', method: 'notifications/log', params: {} },
      now - 1000,
    )

    await cleanupExpiredEvents(storage, 5 * 60 * 1000, now)

    const remaining = await listEventsAfter(storage, 0)
    expect(remaining.length).toBe(1)
  })
})
