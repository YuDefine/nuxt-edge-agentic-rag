import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * GET /api/admin/members — defensive timestamp handling.
 *
 * After migration 0007 (Option V cascade rebuild, 2026-04-20) the
 * production D1 `user.createdAt` / `user.updatedAt` columns hold INTEGER
 * values and drizzle's `timestamp_ms` mapper returns valid Date instances
 * on every row. The handler now reads `createdAt` / `updatedAt` directly
 * (no `sql<>` raw alias) and converts via the simplified `toIsoOrNull`
 * helper that accepts a Date instance and returns its ISO form, or null
 * if the input is unparseable.
 *
 * The drift regression test is retained — it now exercises the helper
 * with `Invalid Date` (the only shape that could re-emerge if a future
 * driver / column-type drift sneaks back in) and asserts the handler
 * degrades to null rather than throwing RangeError.
 */

const ADMIN_SESSION = {
  user: { id: 'admin-self', email: 'admin@example.com' },
}

const mocks = vi.hoisted(() => ({
  requireRuntimeAdminSession: vi.fn(),
  getValidatedQuery: vi.fn(),
  selectRows: [] as Array<Record<string, unknown>>,
  countValue: 0,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ error: vi.fn(), set: vi.fn() }),
}))

const schemaFake = {
  user: {
    id: { __col: 'id' },
    email: { __col: 'email' },
    name: { __col: 'name' },
    image: { __col: 'image' },
    role: { __col: 'role' },
    createdAt: { __col: 'createdAt' },
    updatedAt: { __col: 'updatedAt' },
  },
}

function buildHubDb() {
  const listChain = {
    from: () => listChain,
    where: () => listChain,
    orderBy: () => listChain,
    limit: () => listChain,
    offset: () => Promise.resolve(mocks.selectRows),
  }
  const countChain = {
    from: () => countChain,
    where: () => Promise.resolve([{ n: mocks.countValue }]),
    then: (resolve: (rows: Array<{ n: number }>) => unknown) => resolve([{ n: mocks.countValue }]),
  }
  return {
    db: {
      select: (shape?: Record<string, unknown>) => {
        const isCount = shape ? Object.prototype.hasOwnProperty.call(shape, 'n') : false
        return isCount ? countChain : listChain
      },
    },
    schema: schemaFake,
  }
}

vi.mock('hub:db', () => buildHubDb())

vi.mock('drizzle-orm', () => ({
  asc: (col: unknown) => ({ __op: 'asc', col }),
  desc: (col: unknown) => ({ __op: 'desc', col }),
  eq: (col: unknown, value: unknown) => ({ __op: 'eq', col, value }),
  count: () => ({ __fn: 'count' }),
}))

vi.mock('../../server/utils/admin-session', () => ({
  requireRuntimeAdminSession: mocks.requireRuntimeAdminSession,
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/members — timestamp handling', () => {
  beforeEach(() => {
    mocks.requireRuntimeAdminSession.mockReset()
    mocks.selectRows = []
    mocks.countValue = 0

    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    vi.stubGlobal('getValidatedQuery', mocks.getValidatedQuery)
    mocks.getValidatedQuery.mockResolvedValue({
      page: 1,
      pageSize: 20,
      sort: 'created_desc',
    })
    mocks.requireRuntimeAdminSession.mockResolvedValue(ADMIN_SESSION)
  })

  it('emits ISO string for valid Date instance from drizzle mapper (golden path)', async () => {
    const epoch = 1776332449872
    mocks.countValue = 1
    mocks.selectRows = [
      {
        id: 'u1',
        email: 'u1@example.com',
        name: 'User One',
        image: null,
        role: 'admin',
        createdAt: new Date(epoch),
        updatedAt: new Date(epoch),
      },
    ]

    const { default: handler } = await import('../../server/api/admin/members/index.get')

    const result = (await handler(createRouteEvent())) as {
      data: Array<{ id: string; createdAt: string | null; updatedAt: string | null }>
    }

    expect(result.data).toHaveLength(1)
    expect(result.data[0].createdAt).toBe(new Date(epoch).toISOString())
    expect(result.data[0].updatedAt).toBe(new Date(epoch).toISOString())
  })

  it('returns null instead of crashing on Invalid Date (regression guard)', async () => {
    // If a future driver upgrade or column-type drift produces Invalid Date,
    // the helper must degrade to null rather than letting toISOString() throw
    // RangeError and 500 the entire list response.
    mocks.countValue = 1
    mocks.selectRows = [
      {
        id: 'u2',
        email: 'u2@example.com',
        name: 'User Two',
        image: null,
        role: 'guest',
        createdAt: new Date('not-a-date'),
        updatedAt: null,
      },
    ]

    const { default: handler } = await import('../../server/api/admin/members/index.get')

    const result = (await handler(createRouteEvent())) as {
      data: Array<{ createdAt: string | null; updatedAt: string | null }>
    }

    expect(result.data).toHaveLength(1)
    expect(result.data[0].createdAt).toBeNull()
    expect(result.data[0].updatedAt).toBeNull()
  })
})
