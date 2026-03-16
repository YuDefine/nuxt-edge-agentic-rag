import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * GET /api/admin/members — schema-drift tolerance.
 *
 * Production D1 stores `user.createdAt` / `user.updatedAt` as TEXT (drift
 * from the drizzle `integer timestamp_ms` declaration). Values look like
 * `"1776332449872.0"`. The drizzle mapper for `timestamp_ms` produces
 * Invalid Date on such input → `Date.toISOString()` threw `RangeError:
 * Invalid time value` and the endpoint returned 500.
 *
 * The handler must tolerate the drift and emit a valid ISO string (or
 * null if truly unparseable) instead of crashing the whole list request.
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
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const token = { __sql: strings.join('?'), as: (_alias: string) => token }
      return token
    },
    {
      raw: (value: string) => ({ __sqlRaw: value }),
    },
  ),
}))

vi.mock('../../server/utils/admin-session', () => ({
  requireRuntimeAdminSession: mocks.requireRuntimeAdminSession,
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/members — timestamp drift tolerance', () => {
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

  it('parses TEXT "<ms>.0" drift values back to ISO (production case)', async () => {
    // Exactly what production D1 has: column affinity is TEXT, value is
    // a float-like string. The raw driver value flows into the handler
    // because we bypass drizzle's timestamp_ms mapper via `sql<>` alias.
    mocks.countValue = 1
    mocks.selectRows = [
      {
        id: 'u1',
        email: 'u1@example.com',
        name: 'User One',
        image: null,
        role: 'admin',
        createdAtRaw: '1776332449872.0',
        updatedAtRaw: '1776476402391.0',
      },
    ]

    const { default: handler } = await import('../../server/api/admin/members/index.get')

    const result = (await handler(createRouteEvent())) as {
      data: Array<{ id: string; createdAt: string | null; updatedAt: string | null }>
    }

    expect(result.data).toHaveLength(1)
    expect(result.data[0].createdAt).toBe(new Date(1776332449872).toISOString())
    expect(result.data[0].updatedAt).toBe(new Date(1776476402391).toISOString())
  })

  it('still emits valid ISO for numeric epoch-ms rows (no regression)', async () => {
    const epoch = 1776332449872
    mocks.countValue = 1
    mocks.selectRows = [
      {
        id: 'u2',
        email: 'u2@example.com',
        name: 'User Two',
        image: null,
        role: 'member',
        createdAtRaw: epoch,
        updatedAtRaw: epoch,
      },
    ]

    const { default: handler } = await import('../../server/api/admin/members/index.get')

    const result = (await handler(createRouteEvent())) as {
      data: Array<{ createdAt: string | null; updatedAt: string | null }>
    }

    expect(result.data[0].createdAt).toBe(new Date(epoch).toISOString())
    expect(result.data[0].updatedAt).toBe(new Date(epoch).toISOString())
  })

  it('returns null instead of crashing on null / unparseable drift values', async () => {
    // Guarantees the docstring promise "Return null for unparseable rows
    // instead": null, garbage strings, and zero/negative epoch all degrade
    // to null rather than propagating a RangeError.
    mocks.countValue = 1
    mocks.selectRows = [
      {
        id: 'u3',
        email: 'u3@example.com',
        name: 'User Three',
        image: null,
        role: 'guest',
        createdAtRaw: null,
        updatedAtRaw: 'not-a-date',
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
