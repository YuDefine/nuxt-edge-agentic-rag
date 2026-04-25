import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bridgeLocalKvOnEvent, wrapHubKvAsNamespace } from '#server/utils/local-kv-bridge'

interface MinimalUnstorageLike {
  getItem(key: string): Promise<unknown>
  setItem(key: string, value: unknown, opts?: Record<string, unknown>): Promise<void>
  removeItem?(key: string): Promise<void>
}

function createInMemoryStorage(): MinimalUnstorageLike & {
  store: Map<string, unknown>
} {
  const store = new Map<string, unknown>()

  return {
    store,
    async getItem(key: string) {
      return store.has(key) ? (store.get(key) as unknown) : null
    },
    async setItem(key: string, value: unknown) {
      store.set(key, value)
    },
    async removeItem(key: string) {
      store.delete(key)
    },
  }
}

describe('wrapHubKvAsNamespace', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('round-trips put + get with the original string value', async () => {
    const fakeStorage = createInMemoryStorage()
    const namespace = wrapHubKvAsNamespace(fakeStorage)

    await namespace.put('rate-limit:abc', '{"count":1,"windowStart":1000}')
    const value = await namespace.get('rate-limit:abc')

    expect(value).toBe('{"count":1,"windowStart":1000}')
  })

  it('returns null for missing keys', async () => {
    const fakeStorage = createInMemoryStorage()
    const namespace = wrapHubKvAsNamespace(fakeStorage)

    expect(await namespace.get('missing')).toBeNull()
  })

  it('expires entries after expirationTtl seconds and returns null on get', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T00:00:00Z'))

    const fakeStorage = createInMemoryStorage()
    const namespace = wrapHubKvAsNamespace(fakeStorage)

    await namespace.put('rate-limit:ttl', 'expiring-payload', { expirationTtl: 60 })

    expect(await namespace.get('rate-limit:ttl')).toBe('expiring-payload')

    // Advance just before expiry (59 seconds): still readable.
    vi.setSystemTime(new Date('2026-04-25T00:00:59Z'))
    expect(await namespace.get('rate-limit:ttl')).toBe('expiring-payload')

    // Advance past expiry (61 seconds): must be null.
    vi.setSystemTime(new Date('2026-04-25T00:01:01Z'))
    expect(await namespace.get('rate-limit:ttl')).toBeNull()
  })

  it('treats a put without expirationTtl as non-expiring', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T00:00:00Z'))

    const fakeStorage = createInMemoryStorage()
    const namespace = wrapHubKvAsNamespace(fakeStorage)

    await namespace.put('persistent', 'forever')

    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    expect(await namespace.get('persistent')).toBe('forever')
  })
})

describe('bridgeLocalKvOnEvent', () => {
  it('injects a KV namespace into event.context.cloudflare.env when env is local', () => {
    const event: { context: Record<string, unknown> } = { context: {} }
    const fakeStorage = createInMemoryStorage()

    bridgeLocalKvOnEvent(event, {
      environment: 'local',
      kvFactory: () => fakeStorage,
    })

    const cloudflare = event.context.cloudflare as { env?: Record<string, unknown> } | undefined

    expect(cloudflare).toBeDefined()
    expect(cloudflare?.env).toBeDefined()
    expect(typeof (cloudflare?.env?.KV as { get?: unknown })?.get).toBe('function')
    expect(typeof (cloudflare?.env?.KV as { put?: unknown })?.put).toBe('function')
  })

  it('does not inject anything when environment is not local', () => {
    const event: { context: Record<string, unknown> } = { context: {} }
    const fakeStorage = createInMemoryStorage()

    bridgeLocalKvOnEvent(event, {
      environment: 'production',
      kvFactory: () => fakeStorage,
    })

    expect(event.context.cloudflare).toBeUndefined()
  })

  it('preserves existing KV binding when one is already attached', () => {
    const existingBinding = {
      async get() {
        return 'existing'
      },
      async put() {},
    }
    const event = {
      context: {
        cloudflare: {
          env: {
            KV: existingBinding,
          } as Record<string, unknown>,
        },
      },
    }
    const fakeStorage = createInMemoryStorage()

    bridgeLocalKvOnEvent(event, {
      environment: 'local',
      kvFactory: () => fakeStorage,
    })

    expect(event.context.cloudflare.env.KV).toBe(existingBinding)
  })
})
