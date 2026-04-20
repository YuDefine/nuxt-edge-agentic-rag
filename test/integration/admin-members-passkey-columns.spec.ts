import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * passkey-authentication §13.5 — GET /api/admin/members response shape
 * extension.
 *
 * Adds assertions on the new columns the page requires:
 *   - `displayName` (immutable nickname; primary row identifier)
 *   - `credentialTypes: ('google' | 'passkey')[]`
 *   - `registeredAt`
 *   - `lastActivityAt`
 *
 * The handler now queries via raw SQL (LEFT JOIN-ish aggregation with
 * EXISTS / MAX sub-queries); the mock only needs to satisfy `db.all()`
 * returning pre-shaped rows.
 */

const ADMIN_SESSION = {
  user: { id: 'admin-self', email: 'admin@example.com' },
}

const mocks = vi.hoisted(() => ({
  requireRuntimeAdminSession: vi.fn(),
  getValidatedQuery: vi.fn(),
  allResult: [] as Array<Record<string, unknown>>,
  countResult: 0,
  allCallCount: 0,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ error: vi.fn(), set: vi.fn() }),
}))

vi.mock('hub:db', () => ({
  db: {
    all: vi.fn((query: unknown) => {
      mocks.allCallCount += 1
      // Branch on the SQL payload rather than call order — `paginateList`
      // runs list + count in `Promise.all`, so ordering is not guaranteed.
      const strings = ((query as { __sql?: TemplateStringsArray } | null)?.__sql ?? []) as
        | TemplateStringsArray
        | never[]
      const joined = Array.from(strings).join(' ')
      if (joined.includes('COUNT(*)')) {
        return Promise.resolve([{ n: mocks.countResult }])
      }
      return Promise.resolve(mocks.allResult)
    }),
  },
}))

vi.mock('drizzle-orm', () => ({
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
    mocks.allResult = []
    mocks.countResult = 0
    mocks.allCallCount = 0

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
    const ts = 1776332449872
    mocks.countResult = 1
    mocks.allResult = [
      {
        id: 'u-passkey',
        email: null,
        name: null,
        display_name: '小明',
        image: null,
        role: 'guest',
        created_at: ts,
        updated_at: ts,
        has_google: 0,
        has_passkey: 1,
        last_activity_at: ts + 60000,
      },
    ]

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
    expect(row.registeredAt).toBe(new Date(ts).toISOString())
    expect(row.lastActivityAt).toBe(new Date(ts + 60000).toISOString())
  })

  it('returns ["google", "passkey"] in deterministic order when both are bound', async () => {
    mocks.countResult = 1
    mocks.allResult = [
      {
        id: 'u-both',
        email: 'both@example.com',
        name: 'Both',
        display_name: 'BothUser',
        image: null,
        role: 'member',
        created_at: 1,
        updated_at: 2,
        has_google: 1,
        has_passkey: 1,
        last_activity_at: 3,
      },
    ]

    const { default: handler } = await import('../../server/api/admin/members/index.get')
    const result = (await handler(createRouteEvent())) as {
      data: Array<{ credentialTypes: string[] }>
    }

    expect(result.data[0]!.credentialTypes).toEqual(['google', 'passkey'])
  })

  it('returns empty credentialTypes when neither provider is bound (edge case)', async () => {
    mocks.countResult = 1
    mocks.allResult = [
      {
        id: 'u-bare',
        email: 'bare@example.com',
        name: 'Bare',
        display_name: 'Bare',
        image: null,
        role: 'guest',
        created_at: 0,
        updated_at: 0,
        has_google: 0,
        has_passkey: 0,
        last_activity_at: 0,
      },
    ]

    const { default: handler } = await import('../../server/api/admin/members/index.get')
    const result = (await handler(createRouteEvent())) as {
      data: Array<{ credentialTypes: string[] }>
    }
    expect(result.data[0]!.credentialTypes).toEqual([])
  })

  it('lastActivityAt falls back to registeredAt when no session row (null last_activity)', async () => {
    const ts = 1776000000000
    mocks.countResult = 1
    mocks.allResult = [
      {
        id: 'u-fresh',
        email: null,
        name: null,
        display_name: 'Fresh',
        image: null,
        role: 'guest',
        created_at: ts,
        updated_at: ts,
        has_google: 0,
        has_passkey: 1,
        last_activity_at: null,
      },
    ]

    const { default: handler } = await import('../../server/api/admin/members/index.get')
    const result = (await handler(createRouteEvent())) as {
      data: Array<{ registeredAt: string | null; lastActivityAt: string | null }>
    }
    expect(result.data[0]!.lastActivityAt).toBe(result.data[0]!.registeredAt)
  })
})
