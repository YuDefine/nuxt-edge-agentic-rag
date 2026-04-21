import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * passkey-authentication §13.5 — GET /api/admin/members response shape
 * extension.
 *
 * Asserts the new columns the page requires:
 *   - `displayName` (immutable nickname; primary row identifier)
 *   - `credentialTypes: ('google' | 'passkey')[]`
 *   - `registeredAt`
 *   - `lastActivityAt`
 *
 * TD-010 (2026-04-21): after the refactor from raw SQL to the drizzle
 * query builder, the mock fakes the query-builder chain and branches on
 * the projection shape instead of intercepting `db.all()`. Google /
 * passkey / session data now comes from separate per-page batched
 * lookups that the handler assembles in application-layer reduce, so
 * the mock mirrors that: three dedicated id sets + a sessions array.
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
        if (keys.length === 1 && keys.includes('n')) {
          return makeThenable([{ n: mocks.countValue }])
        }
        if (keys.includes('displayName') && keys.includes('role')) {
          if (shape.displayName !== schema.user.display_name) {
            throw new Error('Expected members handler to select schema.user.display_name')
          }
          return makeThenable(mocks.userRows)
        }
        if (keys.includes('userId') && keys.includes('lastUpdatedAt')) {
          return makeThenable(mocks.sessionRows)
        }
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

describe('GET /api/admin/members — passkey column expansion', () => {
  beforeEach(() => {
    mocks.requireRuntimeAdminSession.mockReset()
    mocks.getValidatedQuery.mockReset()
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

  it('returns displayName / credentialTypes / registeredAt / lastActivityAt for passkey-only user', async () => {
    const ts = new Date(1776332449872)
    const activity = new Date(1776332449872 + 60000)
    mocks.countValue = 1
    mocks.userRows = [
      {
        id: 'u-passkey',
        email: null,
        name: null,
        displayName: '小明',
        image: null,
        role: 'guest',
        createdAt: ts,
        updatedAt: ts,
      },
    ]
    mocks.googleUserIds = []
    mocks.passkeyUserIds = ['u-passkey']
    mocks.sessionRows = [{ userId: 'u-passkey', lastUpdatedAt: activity.toISOString() }]

    const { default: handler } = await import('../../server/api/admin/members/index.get')

    const result = (await handler(createRouteEvent())) as {
      data: Array<{
        id: string
        email: string | null
        displayName: string | null
        credentialTypes: string[]
        registeredAt: string | null
        lastActivityAt: string | null
        role: string
      }>
    }

    expect(result.data).toHaveLength(1)
    const row = result.data[0]!
    expect(row.displayName).toBe('小明')
    expect(row.email).toBeNull()
    expect(row.credentialTypes).toEqual(['passkey'])
    expect(row.role).toBe('guest')
    expect(row.registeredAt).toBe(ts.toISOString())
    expect(row.lastActivityAt).toBe(activity.toISOString())
  })

  it('returns ["google", "passkey"] in deterministic order when both are bound', async () => {
    const ts = new Date(1)
    mocks.countValue = 1
    mocks.userRows = [
      {
        id: 'u-both',
        email: 'both@example.com',
        name: 'Both',
        displayName: 'BothUser',
        image: null,
        role: 'member',
        createdAt: ts,
        updatedAt: ts,
      },
    ]
    mocks.googleUserIds = ['u-both']
    mocks.passkeyUserIds = ['u-both']
    mocks.sessionRows = [{ userId: 'u-both', lastUpdatedAt: new Date(3).toISOString() }]

    const { default: handler } = await import('../../server/api/admin/members/index.get')
    const result = (await handler(createRouteEvent())) as {
      data: Array<{ credentialTypes: string[] }>
    }

    expect(result.data[0]!.credentialTypes).toEqual(['google', 'passkey'])
  })

  it('returns empty credentialTypes when neither provider is bound (edge case)', async () => {
    const ts = new Date(0)
    mocks.countValue = 1
    mocks.userRows = [
      {
        id: 'u-bare',
        email: 'bare@example.com',
        name: 'Bare',
        displayName: 'Bare',
        image: null,
        role: 'guest',
        createdAt: ts,
        updatedAt: ts,
      },
    ]
    mocks.googleUserIds = []
    mocks.passkeyUserIds = []
    mocks.sessionRows = []

    const { default: handler } = await import('../../server/api/admin/members/index.get')
    const result = (await handler(createRouteEvent())) as {
      data: Array<{ credentialTypes: string[] }>
    }
    expect(result.data[0]!.credentialTypes).toEqual([])
  })

  it('lastActivityAt falls back to registeredAt when no session row (null last_activity)', async () => {
    const ts = new Date(1776000000000)
    mocks.countValue = 1
    mocks.userRows = [
      {
        id: 'u-fresh',
        email: null,
        name: null,
        displayName: 'Fresh',
        image: null,
        role: 'guest',
        createdAt: ts,
        updatedAt: ts,
      },
    ]
    mocks.googleUserIds = []
    mocks.passkeyUserIds = ['u-fresh']
    mocks.sessionRows = [] // no session rows → fall back to updatedAt (== ts)

    const { default: handler } = await import('../../server/api/admin/members/index.get')
    const result = (await handler(createRouteEvent())) as {
      data: Array<{ registeredAt: string | null; lastActivityAt: string | null }>
    }
    expect(result.data[0]!.lastActivityAt).toBe(result.data[0]!.registeredAt)
  })
})
