/**
 * Tests for governance §2.4 — Backdated cleanup verification path.
 *
 * The verification path extends `/api/admin/retention/prune` so that local /
 * local environments can prove cleanup behaviour without waiting 180 real days:
 *
 *   - Accept optional `retentionDays` body override (e.g. 1 day for local
 *     smoke).
 *   - Reject any override when the runtime environment is `production`.
 *   - Forward the override through to `runRetentionCleanup` and echo the
 *     effective `retentionDays` back on the response so the verification
 *     harness can record which threshold was exercised.
 *
 * The spec requirement states the path must also "seed backdated records"; the
 * seeding utility lives in `server/utils/retention-seed.ts` and is covered by
 * the dedicated cases below.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'
import { createHubDbMock } from './helpers/database'

interface FakePrepared {
  bindings: unknown[]
  sql: string
}

interface PruneCallRecord {
  retentionDays: number | undefined
  now: Date | undefined
}

const pruneMocks = vi.hoisted(() => {
  const calls: PruneCallRecord[] = []
  return {
    calls,
    runRetentionCleanup: vi.fn(async (input: { retentionDays?: number; now?: Date }) => {
      calls.push({ retentionDays: input.retentionDays, now: input.now })
      return {
        retentionDays: input.retentionDays ?? 180,
        cutoff: '2025-10-20T00:00:00.000Z',
        nowIso: '2026-04-18T00:00:00.000Z',
        deleted: {
          queryLogs: 0,
          citationRecords: 0,
          sourceChunkText: 0,
          mcpTokenMetadata: 0,
        },
        errors: [],
      }
    }),
    requireRuntimeAdminSession: vi.fn(),
    getKnowledgeRuntimeConfig: vi.fn(),
  }
})

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('#server/utils/knowledge-retention', () => ({
  runRetentionCleanup: pruneMocks.runRetentionCleanup,
}))

vi.mock('#server/utils/admin-session', () => ({
  requireRuntimeAdminSession: pruneMocks.requireRuntimeAdminSession,
}))

vi.mock('#server/utils/knowledge-runtime', () => ({
  getKnowledgeRuntimeConfig: pruneMocks.getKnowledgeRuntimeConfig,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('POST /api/admin/retention/prune — verification path (governance §2.4)', () => {
  installNuxtRouteTestGlobals()

  beforeEach(() => {
    pruneMocks.calls.length = 0
    pruneMocks.runRetentionCleanup.mockClear()
    pruneMocks.requireRuntimeAdminSession.mockReset()
    pruneMocks.requireRuntimeAdminSession.mockImplementation(async () => ({
      user: { id: 'admin-user' },
    }))
    pruneMocks.getKnowledgeRuntimeConfig.mockReset()
    pruneMocks.getKnowledgeRuntimeConfig.mockReturnValue({ environment: 'local' })
  })

  async function callPrune(body: unknown = {}): Promise<{
    status: number
    result: unknown
  }> {
    const handler = (await import('../../server/api/admin/retention/prune.post')).default as (
      event: unknown
    ) => Promise<unknown>

    // Inject readBody via event shape the handler expects. We stub the global
    // helper so the handler code path for `readBody` and `readValidatedBody`
    // works without Nitro runtime.
    vi.stubGlobal('readBody', async () => body)

    const event = createRouteEvent()
    try {
      const data = await handler(event)
      return { status: 200, result: data }
    } catch (error) {
      const err = error as { statusCode?: number; message?: string }
      return { status: err.statusCode ?? 500, result: err }
    }
  }

  it('passes retentionDays override from body to runRetentionCleanup when not production', async () => {
    const { status, result } = await callPrune({ retentionDays: 1 })

    expect(status).toBe(200)
    expect(pruneMocks.runRetentionCleanup).toHaveBeenCalledTimes(1)
    const call = pruneMocks.runRetentionCleanup.mock.calls[0]?.[0] as {
      retentionDays?: number
    }
    expect(call?.retentionDays).toBe(1)

    // Echo back the retentionDays so the verification harness records which
    // threshold was exercised.
    expect((result as { data: { retentionDays: number } }).data.retentionDays).toBe(1)
  })

  it('does not override retentionDays when body omits the field', async () => {
    await callPrune({})

    const call = pruneMocks.runRetentionCleanup.mock.calls[0]?.[0] as {
      retentionDays?: number
    }
    expect(call?.retentionDays).toBeUndefined()
  })

  it('rejects retentionDays override with 400 when runtime environment is production', async () => {
    pruneMocks.getKnowledgeRuntimeConfig.mockReturnValue({ environment: 'production' })

    const { status } = await callPrune({ retentionDays: 1 })

    expect(status).toBe(400)
    expect(pruneMocks.runRetentionCleanup).not.toHaveBeenCalled()
  })

  it('still allows production prune without any override (default retention applies)', async () => {
    pruneMocks.getKnowledgeRuntimeConfig.mockReturnValue({ environment: 'production' })

    const { status, result } = await callPrune({})

    expect(status).toBe(200)
    expect(pruneMocks.runRetentionCleanup).toHaveBeenCalledTimes(1)
    const call = pruneMocks.runRetentionCleanup.mock.calls[0]?.[0] as {
      retentionDays?: number
    }
    expect(call?.retentionDays).toBeUndefined()
    expect((result as { data: { retentionDays: number } }).data.retentionDays).toBe(180)
  })

  it('rejects non-positive retentionDays with 400', async () => {
    const { status: zero } = await callPrune({ retentionDays: 0 })
    const { status: negative } = await callPrune({ retentionDays: -5 })
    const { status: fractional } = await callPrune({ retentionDays: 1.5 })

    expect(zero).toBe(400)
    expect(negative).toBe(400)
    expect(fractional).toBe(400)
    expect(pruneMocks.runRetentionCleanup).not.toHaveBeenCalled()
  })

  it('rejects retentionDays larger than the default 180-day ceiling', async () => {
    // A shortened-TTL override path should never be used to *extend* retention;
    // the default 180-day policy is the ceiling.
    const { status } = await callPrune({ retentionDays: 365 })

    expect(status).toBe(400)
    expect(pruneMocks.runRetentionCleanup).not.toHaveBeenCalled()
  })
})

describe('seedBackdatedRetentionRecord utility (governance §2.4)', () => {
  it('writes backdated query_log, citation_record and source_chunk rows with deterministic ids', async () => {
    const calls: FakePrepared[] = []
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              async run() {
                calls.push({ sql, bindings })
                return { meta: { changes: 1 } }
              },
            }
          },
        }
      },
    }

    const { seedBackdatedRetentionRecord } = await import('../../server/utils/retention-seed')

    const result = await seedBackdatedRetentionRecord({
      database: db,
      environment: 'local',
      ageDays: 200,
      documentVersionId: 'dv-123',
      sourceChunkId: 'sc-123',
      now: new Date('2026-04-18T12:00:00.000Z'),
    })

    // Returns the ids so the operator / test can clean up afterwards.
    expect(result.queryLogId).toMatch(/^backdated-ql-/)
    expect(result.citationRecordId).toMatch(/^backdated-cr-/)
    // 200 days before 2026-04-18T12:00:00Z = 2025-09-30T12:00:00Z.
    expect(result.createdAt).toBe('2025-09-30T12:00:00.000Z')
    expect(result.expiresAt).toBe('2025-09-30T12:00:00.000Z')

    // At minimum: INSERT into query_logs, INSERT into citation_records.
    const inserts = calls.map((call) => call.sql.split(/\s+/).slice(0, 3).join(' '))
    expect(inserts).toContain('INSERT INTO query_logs')
    expect(inserts).toContain('INSERT INTO citation_records')
  })

  it('refuses to seed backdated rows when environment is production', async () => {
    const { seedBackdatedRetentionRecord } = await import('../../server/utils/retention-seed')

    const db = {
      prepare: vi.fn(),
    }

    await expect(
      seedBackdatedRetentionRecord({
        database: db,
        environment: 'production',
        ageDays: 200,
        documentVersionId: 'dv-123',
        sourceChunkId: 'sc-123',
      })
    ).rejects.toThrow(/production/i)

    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('validates ageDays is a positive integer', async () => {
    const { seedBackdatedRetentionRecord } = await import('../../server/utils/retention-seed')

    const db = { prepare: vi.fn() }

    await expect(
      seedBackdatedRetentionRecord({
        database: db,
        environment: 'local',
        ageDays: 0,
        documentVersionId: 'dv-123',
        sourceChunkId: 'sc-123',
      })
    ).rejects.toThrow(/ageDays/)

    await expect(
      seedBackdatedRetentionRecord({
        database: db,
        environment: 'local',
        ageDays: -1,
        documentVersionId: 'dv-123',
        sourceChunkId: 'sc-123',
      })
    ).rejects.toThrow(/ageDays/)
  })
})
