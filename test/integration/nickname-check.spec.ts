import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * passkey-authentication — GET /api/auth/nickname/check
 *
 * Exercises the three branches defined in tasks.md §3.4:
 *
 *   (1) Nickname available (case-insensitive no match)
 *   (2) Nickname taken (case-insensitive hit)
 *   (3) Format invalid → 400 (Zod rejects before reaching DB)
 */

const mocks = vi.hoisted(() => ({
  getValidatedQuery: vi.fn(),
  dbAllResult: [] as Array<{ hit: number }>,
  dbAllCalledWith: null as unknown,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ error: vi.fn(), set: vi.fn() }),
}))

vi.mock('hub:db', () => ({
  db: {
    all: vi.fn((query: unknown) => {
      mocks.dbAllCalledWith = query
      return Promise.resolve(mocks.dbAllResult)
    }),
  },
  schema: {},
}))

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: strings,
    __values: values,
  }),
}))

installNuxtRouteTestGlobals()

describe('GET /api/auth/nickname/check', () => {
  beforeEach(() => {
    mocks.dbAllResult = []
    mocks.dbAllCalledWith = null
    vi.stubGlobal('getValidatedQuery', mocks.getValidatedQuery)
  })

  it('returns available=true when no row matches (case-insensitive)', async () => {
    mocks.getValidatedQuery.mockResolvedValue({ nickname: 'Alice' })
    mocks.dbAllResult = []

    const { default: handler } = await import('../../server/api/auth/nickname/check.get')
    const result = (await handler(createRouteEvent())) as {
      data: { available: boolean }
    }

    expect(result.data.available).toBe(true)
    expect(mocks.dbAllCalledWith).not.toBeNull()
  })

  it('returns available=false when a row matches (case-insensitive hit)', async () => {
    mocks.getValidatedQuery.mockResolvedValue({ nickname: 'alice' })
    // Even if the stored value is "ALICE", the SQL `lower()` comparison
    // in the endpoint collapses both sides — we assert the boolean result
    // directly rather than simulating SQL's `lower()` here.
    mocks.dbAllResult = [{ hit: 1 }]

    const { default: handler } = await import('../../server/api/auth/nickname/check.get')
    const result = (await handler(createRouteEvent())) as {
      data: { available: boolean }
    }

    expect(result.data.available).toBe(false)
  })

  it('rejects invalid format at validation layer (Zod throws before DB)', async () => {
    // getValidatedQuery simulates Zod parse failing — it throws a 400
    // createError that the handler does not catch.
    const zodError = Object.assign(new Error('暱稱只能包含中英文字、數字、底線、連字號與空白'), {
      statusCode: 400,
    })
    mocks.getValidatedQuery.mockRejectedValue(zodError)

    const { default: handler } = await import('../../server/api/auth/nickname/check.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})
