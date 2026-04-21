import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * GET /api/admin/members — defensive timestamp handling.
 *
 * TD-010 (2026-04-21): the handler was refactored from raw SQL
 * (`db.all(sql\`...\`)`) to the drizzle query builder so the endpoint
 * works on both production D1 and local-dev libsql. The mock in this
 * spec now fakes the query-builder chain (`select().from()...`) and
 * branches on the projection shape rather than intercepting `db.all()`
 * and inspecting the SQL template.
 *
 * The two scenarios still target the defensive `toIsoOrNull` guard:
 *   - Date timestamps (drizzle golden path)
 *   - unparseable / null input  → null response
 */

const ADMIN_SESSION = {
  user: { id: 'admin-self', email: 'admin@example.com' },
}

interface UserRow {
  id: string
  email: string | null
  name: string | null
  displayName: string | null
  image: string | null
  role: string | null
  createdAt: Date | string | number | null
  updatedAt: Date | string | number | null
}

const mocks = vi.hoisted(() => ({
  requireRuntimeAdminSession: vi.fn(),
  getValidatedQuery: vi.fn(),
  userRows: [] as Array<UserRow>,
  countValue: 0,
  googleUserIds: [] as string[],
  passkeyUserIds: [] as string[],
  sessionRows: [] as Array<{ userId: string; lastUpdatedAt: string | null }>,
  userIdCall: 0,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ error: vi.fn(), set: vi.fn() }),
}))

// Drizzle query-builder chain mock. Branches on the shape passed to
// `select()` to decide which data set to return. Every stage of the
// chain (`from` / `where` / `orderBy` / `limit` / `offset` / `groupBy`)
// returns a thenable so `await` resolves to the configured rows.
function makeThenable<T>(rows: T) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    groupBy: () => chain,
    then: (resolve: (value: T) => void) => resolve(rows),
  }
  return chain
}

function buildHubDb() {
  const schema = {
    user: {
      id: { __col: 'id' },
      email: { __col: 'email' },
      name: { __col: 'name' },
      display_name: { __col: 'display_name' },
      image: { __col: 'image' },
      role: { __col: 'role' },
      createdAt: { __col: 'createdAt' },
      updatedAt: { __col: 'updatedAt' },
    },
    account: {
      userId: { __col: 'userId' },
      providerId: { __col: 'providerId' },
    },
    passkey: {
      userId: { __col: 'userId' },
    },
    session: {
      userId: { __col: 'userId' },
      updatedAt: { __col: 'updatedAt' },
    },
  }

  return {
    db: {
      select: (shape: Record<string, unknown>) => {
        const keys = Object.keys(shape ?? {})
        // Count: { n: count() }
        if (keys.length === 1 && keys.includes('n')) {
          return makeThenable([{ n: mocks.countValue }])
        }
        // User list: has `displayName` + `id` + `role`
        if (keys.includes('displayName') && keys.includes('role')) {
          if (shape.displayName !== schema.user.display_name) {
            throw new Error('Expected members handler to select schema.user.display_name')
          }
          return makeThenable(mocks.userRows)
        }
        // Session aggregate: { userId, lastUpdatedAt }
        if (keys.includes('userId') && keys.includes('lastUpdatedAt')) {
          return makeThenable(mocks.sessionRows)
        }
        // Google / passkey batch: { userId } alone. The handler wires
        // the same shape for both queries under Promise.all; we
        // dispatch by call order (google first, passkey second) to
        // mirror the production code.
        if (keys.length === 1 && keys.includes('userId')) {
          mocks.userIdCall += 1
          if (mocks.userIdCall === 1) {
            return makeThenable(mocks.googleUserIds.map((userId) => ({ userId })))
          }
          return makeThenable(mocks.passkeyUserIds.map((userId) => ({ userId })))
        }
        throw new Error(`Unexpected select shape: ${keys.join(',')}`)
      },
    },
    schema,
  }
}

vi.mock('hub:db', () => buildHubDb())

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, _value: unknown) => ({ __op: 'eq' }),
  and: (...conds: unknown[]) => ({ __op: 'and', conds }),
  asc: (_col: unknown) => ({ __op: 'asc' }),
  desc: (_col: unknown) => ({ __op: 'desc' }),
  count: () => ({ __op: 'count' }),
  max: (_col: unknown) => ({ __op: 'max' }),
  inArray: (_col: unknown, _values: unknown[]) => ({ __op: 'inArray' }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: strings,
    __values: values,
  }),
}))

vi.mock('../../server/utils/admin-session', () => ({
  requireRuntimeAdminSession: mocks.requireRuntimeAdminSession,
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/members — timestamp handling', () => {
  beforeEach(() => {
    mocks.requireRuntimeAdminSession.mockReset()
    mocks.userRows = []
    mocks.countValue = 0
    mocks.googleUserIds = []
    mocks.passkeyUserIds = []
    mocks.sessionRows = []
    mocks.userIdCall = 0

    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    vi.stubGlobal('getValidatedQuery', mocks.getValidatedQuery)
    mocks.getValidatedQuery.mockResolvedValue({
      page: 1,
      pageSize: 20,
      sort: 'created_desc',
    })
    mocks.requireRuntimeAdminSession.mockResolvedValue(ADMIN_SESSION)
  })

  it('emits ISO string for Date timestamps (drizzle golden path)', async () => {
    const epoch = 1776332449872
    const ts = new Date(epoch)
    mocks.countValue = 1
    mocks.userRows = [
      {
        id: 'u1',
        email: 'u1@example.com',
        name: 'User One',
        displayName: 'UserOne',
        image: null,
        role: 'admin',
        createdAt: ts,
        updatedAt: ts,
      },
    ]
    mocks.googleUserIds = ['u1']
    mocks.passkeyUserIds = []
    mocks.sessionRows = [{ userId: 'u1', lastUpdatedAt: ts.toISOString() }]

    const { default: handler } = await import('../../server/api/admin/members/index.get')

    const result = (await handler(createRouteEvent())) as {
      data: Array<{
        id: string
        createdAt: string | null
        updatedAt: string | null
        registeredAt: string | null
        lastActivityAt: string | null
      }>
    }

    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.createdAt).toBe(ts.toISOString())
    expect(result.data[0]!.updatedAt).toBe(ts.toISOString())
    expect(result.data[0]!.registeredAt).toBe(ts.toISOString())
    expect(result.data[0]!.lastActivityAt).toBe(ts.toISOString())
  })

  it('returns null registeredAt / lastActivityAt for unparseable input (regression guard)', async () => {
    // Defensive: if a driver path ever produces an unparseable value,
    // the handler must degrade to null rather than throwing.
    mocks.countValue = 1
    mocks.userRows = [
      {
        id: 'u2',
        email: 'u2@example.com',
        name: 'User Two',
        displayName: 'UserTwo',
        image: null,
        role: 'guest',
        createdAt: 'not-a-date',
        updatedAt: null,
      },
    ]
    mocks.googleUserIds = []
    mocks.passkeyUserIds = ['u2']
    mocks.sessionRows = []

    const { default: handler } = await import('../../server/api/admin/members/index.get')

    const result = (await handler(createRouteEvent())) as {
      data: Array<{
        registeredAt: string | null
        lastActivityAt: string | null
        updatedAt: string | null
      }>
    }

    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.registeredAt).toBeNull()
    // lastActivityAt falls back to updatedAt (null) then to registeredAt (null) → null
    expect(result.data[0]!.lastActivityAt).toBeNull()
    expect(result.data[0]!.updatedAt).toBe('')
  })
})
