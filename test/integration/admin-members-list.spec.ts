import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * GET /api/admin/members — defensive timestamp handling.
 *
 * After passkey-authentication §13.1 the handler switched to raw SQL
 * (LEFT JOIN-ish aggregation with EXISTS / MAX sub-queries) for passkey
 * + account credential badges and last-activity timestamps. The
 * underlying drizzle timestamp mapper is no longer in the hot path —
 * `db.all()` returns raw rows — but we still need defensive handling
 * for:
 *
 *   - `Date` instances (legacy shape; some driver paths still emit)
 *   - Numeric epoch millis (current cloudflare D1 path)
 *   - ISO strings
 *   - Invalid / null values → null
 *
 * `toIsoOrNull` in the handler handles all four. This spec exercises
 * the golden path + the regression guard.
 */

const ADMIN_SESSION = {
  user: { id: 'admin-self', email: 'admin@example.com' },
}

const mocks = vi.hoisted(() => ({
  requireRuntimeAdminSession: vi.fn(),
  getValidatedQuery: vi.fn(),
  listRows: [] as Array<Record<string, unknown>>,
  countValue: 0,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ error: vi.fn(), set: vi.fn() }),
}))

vi.mock('hub:db', () => ({
  db: {
    all: vi.fn((query: unknown) => {
      const strings = ((query as { __sql?: TemplateStringsArray } | null)?.__sql ?? []) as
        | TemplateStringsArray
        | never[]
      const joined = Array.from(strings).join(' ')
      if (joined.includes('COUNT(*)')) {
        return Promise.resolve([{ n: mocks.countValue }])
      }
      return Promise.resolve(mocks.listRows)
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

describe('GET /api/admin/members — timestamp handling', () => {
  beforeEach(() => {
    mocks.requireRuntimeAdminSession.mockReset()
    mocks.listRows = []
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

  it('emits ISO string for numeric epoch timestamps (golden path)', async () => {
    const epoch = 1776332449872
    mocks.countValue = 1
    mocks.listRows = [
      {
        id: 'u1',
        email: 'u1@example.com',
        name: 'User One',
        display_name: 'UserOne',
        image: null,
        role: 'admin',
        created_at: epoch,
        updated_at: epoch,
        has_google: 1,
        has_passkey: 0,
        last_activity_at: epoch,
      },
    ]

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
    expect(result.data[0]!.createdAt).toBe(new Date(epoch).toISOString())
    expect(result.data[0]!.updatedAt).toBe(new Date(epoch).toISOString())
    expect(result.data[0]!.registeredAt).toBe(new Date(epoch).toISOString())
    expect(result.data[0]!.lastActivityAt).toBe(new Date(epoch).toISOString())
  })

  it('returns null registeredAt / lastActivityAt for unparseable input (regression guard)', async () => {
    // Defensive: if a driver path ever produces an unparseable value,
    // the handler must degrade to null rather than throwing.
    mocks.countValue = 1
    mocks.listRows = [
      {
        id: 'u2',
        email: 'u2@example.com',
        name: 'User Two',
        display_name: 'UserTwo',
        image: null,
        role: 'guest',
        created_at: 'not-a-date',
        updated_at: null,
        has_google: 0,
        has_passkey: 1,
        last_activity_at: null,
      },
    ]

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
    // lastActivityAt falls back to registeredAt when the session sub-query
    // yields null; when both are null the result is null.
    expect(result.data[0]!.lastActivityAt).toBeNull()
    expect(result.data[0]!.updatedAt).toBe('')
  })
})
