import { describe, expect, it } from 'vitest'

import {
  consumeFixedWindowRateLimit,
  FIXED_WINDOW_RATE_LIMIT_PRESETS,
  type FixedWindowRateLimitRecord,
  type FixedWindowRateLimitStore,
} from '#server/utils/rate-limiter'

class FakeRateLimitStore implements FixedWindowRateLimitStore {
  private readonly records = new Map<string, FixedWindowRateLimitRecord>()

  async get(key: string): Promise<FixedWindowRateLimitRecord | null> {
    return this.records.get(key) ?? null
  }

  async set(key: string, value: FixedWindowRateLimitRecord): Promise<void> {
    this.records.set(key, value)
  }
}

describe('rate limiter', () => {
  it('exposes the v1 fixed-window presets', () => {
    expect(FIXED_WINDOW_RATE_LIMIT_PRESETS).toEqual({
      askKnowledge: {
        limit: 30,
        windowMs: 5 * 60 * 1000,
      },
      chat: {
        limit: 30,
        windowMs: 5 * 60 * 1000,
      },
      getDocumentChunk: {
        limit: 120,
        windowMs: 5 * 60 * 1000,
      },
      listCategories: {
        limit: 120,
        windowMs: 5 * 60 * 1000,
      },
      searchKnowledge: {
        limit: 60,
        windowMs: 5 * 60 * 1000,
      },
    })
  })

  it('increments within a window and rejects requests over the limit', async () => {
    const store = new FakeRateLimitStore()
    const preset = { limit: 2, windowMs: 1_000 }

    const firstResult = await consumeFixedWindowRateLimit({
      key: 'chat:user-1',
      now: 0,
      preset,
      store,
    })

    const secondResult = await consumeFixedWindowRateLimit({
      key: 'chat:user-1',
      now: 500,
      preset,
      store,
    })

    const thirdResult = await consumeFixedWindowRateLimit({
      key: 'chat:user-1',
      now: 999,
      preset,
      store,
    })

    expect(firstResult).toMatchObject({
      allowed: true,
      count: 1,
      limit: 2,
      remaining: 1,
      resetAt: 1_000,
    })

    expect(secondResult).toMatchObject({
      allowed: true,
      count: 2,
      limit: 2,
      remaining: 0,
      resetAt: 1_000,
    })

    expect(thirdResult).toMatchObject({
      allowed: false,
      count: 2,
      limit: 2,
      remaining: 0,
      resetAt: 1_000,
      retryAfterMs: 1,
    })
  })

  it('resets the counter after the window rolls over', async () => {
    const store = new FakeRateLimitStore()
    const preset = { limit: 2, windowMs: 1_000 }

    await consumeFixedWindowRateLimit({
      key: 'ask:token-1',
      now: 10,
      preset,
      store,
    })

    await consumeFixedWindowRateLimit({
      key: 'ask:token-1',
      now: 900,
      preset,
      store,
    })

    const rolledOverResult = await consumeFixedWindowRateLimit({
      key: 'ask:token-1',
      now: 1_000,
      preset,
      store,
    })

    expect(rolledOverResult).toMatchObject({
      allowed: true,
      count: 1,
      limit: 2,
      remaining: 1,
      resetAt: 2_000,
      retryAfterMs: 0,
    })
  })
})
