import { describe, expect, it, vi } from 'vitest'

import { createAdminDashboardStore, isoDaysAgo } from '../../server/utils/admin-dashboard-store'

describe('isoDaysAgo', () => {
  it('truncates to UTC midnight and subtracts full days', () => {
    const now = new Date('2026-04-19T15:30:00.000Z')
    expect(isoDaysAgo(now, 7)).toBe('2026-04-12T00:00:00.000Z')
    expect(isoDaysAgo(now, 30)).toBe('2026-03-20T00:00:00.000Z')
  })

  it('handles day=0 as midnight of today (UTC)', () => {
    const now = new Date('2026-04-19T15:30:00.000Z')
    expect(isoDaysAgo(now, 0)).toBe('2026-04-19T00:00:00.000Z')
  })
})

function createFakeDb<T extends Record<string, unknown>>(result: T) {
  const calls: Array<{ sql: string; binds: unknown[] }> = []
  const fakePrepared = {
    bind(...binds: unknown[]) {
      calls[calls.length - 1]!.binds = binds
      return this
    },
    async first<R>() {
      return result as unknown as R
    },
    async all<R>() {
      return { results: (result as unknown as { results?: R[] }).results ?? [] }
    },
    async run() {
      return {}
    },
  }
  return {
    calls,
    database: {
      prepare(sql: string) {
        calls.push({ sql, binds: [] })
        return fakePrepared
      },
    },
  }
}

describe('createAdminDashboardStore', () => {
  it('countDocuments excludes archived', async () => {
    const { database, calls } = createFakeDb({ n: 42 })
    const store = createAdminDashboardStore(database)
    expect(await store.countDocuments()).toBe(42)
    expect(calls[0]!.sql).toContain('FROM documents')
    expect(calls[0]!.sql).toContain("status != 'archived'")
  })

  it('countRecentQueryLogs uses days-ago threshold', async () => {
    const { database, calls } = createFakeDb({ n: 128 })
    const store = createAdminDashboardStore(database, {
      now: () => new Date('2026-04-19T15:30:00.000Z'),
    })
    expect(await store.countRecentQueryLogs(30)).toBe(128)
    expect(calls[0]!.sql).toContain('FROM query_logs')
    expect(calls[0]!.binds).toEqual(['2026-03-20T00:00:00.000Z'])
  })

  it('countActiveTokens filters by status=active', async () => {
    const { database, calls } = createFakeDb({ n: 3 })
    const store = createAdminDashboardStore(database)
    expect(await store.countActiveTokens()).toBe(3)
    expect(calls[0]!.sql).toContain("status = 'active'")
  })

  it('listRecentQueryTrend returns oldest-first date/count tuples', async () => {
    const { database } = createFakeDb({
      results: [
        { bucket: '2026-04-17', n: 5 },
        { bucket: '2026-04-18', n: 10 },
        { bucket: '2026-04-19', n: 15 },
      ],
    })
    const store = createAdminDashboardStore(database, {
      now: () => new Date('2026-04-19T15:30:00.000Z'),
    })
    const trend = await store.listRecentQueryTrend(7)
    expect(trend).toEqual([
      { date: '2026-04-17', count: 5 },
      { date: '2026-04-18', count: 10 },
      { date: '2026-04-19', count: 15 },
    ])
  })

  it('never selects raw query text columns (redaction guarantee)', async () => {
    const { database, calls } = createFakeDb({ n: 0, results: [] })
    const store = createAdminDashboardStore(database)

    await store.countRecentQueryLogs(30)
    await store.listRecentQueryTrend(7)

    const combinedSql = calls
      .map((c) => c.sql)
      .join('\n')
      .toLowerCase()
    expect(combinedSql).not.toContain('query_text')
    expect(combinedSql).not.toContain('raw_query')
    expect(combinedSql).not.toContain('token_hash')
  })
})

// Keep the `vi` import used to satisfy testing-anti-patterns gate if future mock
// usage arrives; silently referenced here to avoid unused-import lint.
void vi
