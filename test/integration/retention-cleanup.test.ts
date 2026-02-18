import { beforeEach, describe, expect, it } from 'vitest'

import { runRetentionCleanup } from '#server/utils/knowledge-retention'
import {
  computeRetentionCutoff,
  DEFAULT_RETENTION_DAYS,
  RETENTION_POLICY,
} from '#shared/schemas/retention-policy'

/**
 * Minimal in-memory D1-compatible fake for retention cleanup tests.
 *
 * Supports the four statements that `runRetentionCleanup` issues:
 *   1. DELETE FROM citation_records WHERE expires_at <= ?
 *   2. DELETE FROM query_logs WHERE created_at <= ?
 *   3. UPDATE source_chunks SET chunk_text = '' WHERE created_at <= ? AND chunk_text <> ''
 *   4. UPDATE mcp_tokens ... WHERE COALESCE(revoked_at, expires_at, created_at) <= ?
 *        AND (status = 'revoked' OR status = 'expired' OR expires_at IS NOT NULL)
 *        AND token_hash NOT LIKE 'redacted:%'
 */

interface QueryLog {
  id: string
  createdAt: string
}

interface CitationRecord {
  id: string
  queryLogId: string
  expiresAt: string
}

interface SourceChunk {
  id: string
  chunkText: string
  chunkHash: string
  createdAt: string
}

interface McpToken {
  id: string
  tokenHash: string
  name: string
  scopesJson: string
  status: 'active' | 'revoked' | 'expired'
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  revokedReason: string | null
}

interface FakeState {
  queryLogs: QueryLog[]
  citationRecords: CitationRecord[]
  sourceChunks: SourceChunk[]
  mcpTokens: McpToken[]
  callOrder: string[]
  /** When set, the matching statement call will reject with this error. */
  failOn?: Partial<Record<'citationRecords' | 'queryLogs' | 'sourceChunks' | 'mcpTokens', Error>>
}

function iso(date: string | Date): string {
  return (date instanceof Date ? date : new Date(date)).toISOString()
}

function createFakeDatabase(state: FakeState) {
  return {
    prepare(query: string) {
      const normalized = query.replace(/\s+/g, ' ').trim()

      if (normalized.startsWith('DELETE FROM citation_records')) {
        return {
          bind(expiresAtBound: string) {
            return {
              async run() {
                state.callOrder.push('citationRecords')
                if (state.failOn?.citationRecords) {
                  throw state.failOn.citationRecords
                }
                const cutoff = new Date(expiresAtBound).getTime()
                const before = state.citationRecords.length
                state.citationRecords = state.citationRecords.filter(
                  (row) => new Date(row.expiresAt).getTime() > cutoff
                )
                const changes = before - state.citationRecords.length
                return { meta: { changes } }
              },
            }
          },
        }
      }

      if (normalized.startsWith('DELETE FROM query_logs')) {
        return {
          bind(cutoffBound: string) {
            return {
              async run() {
                state.callOrder.push('queryLogs')
                if (state.failOn?.queryLogs) {
                  throw state.failOn.queryLogs
                }
                const cutoff = new Date(cutoffBound).getTime()
                const before = state.queryLogs.length
                // Emulate FK ON DELETE CASCADE: citation_records rows with
                // query_log_id matching a deleted query_log also vanish. The
                // retention cleanup already deleted expired citations in the
                // previous step, so this cascade typically affects nothing.
                const deletedIds = new Set(
                  state.queryLogs
                    .filter((row) => new Date(row.createdAt).getTime() <= cutoff)
                    .map((row) => row.id)
                )
                state.queryLogs = state.queryLogs.filter(
                  (row) => new Date(row.createdAt).getTime() > cutoff
                )
                state.citationRecords = state.citationRecords.filter(
                  (cr) => !deletedIds.has(cr.queryLogId)
                )
                const changes = before - state.queryLogs.length
                return { meta: { changes } }
              },
            }
          },
        }
      }

      if (normalized.startsWith('UPDATE source_chunks')) {
        return {
          bind(cutoffBound: string) {
            return {
              async run() {
                state.callOrder.push('sourceChunks')
                if (state.failOn?.sourceChunks) {
                  throw state.failOn.sourceChunks
                }
                const cutoff = new Date(cutoffBound).getTime()
                let changes = 0
                for (const row of state.sourceChunks) {
                  if (new Date(row.createdAt).getTime() <= cutoff && row.chunkText !== '') {
                    row.chunkText = ''
                    changes++
                  }
                }
                return { meta: { changes } }
              },
            }
          },
        }
      }

      if (normalized.startsWith('UPDATE mcp_tokens')) {
        return {
          bind(cutoffBound: string) {
            return {
              async run() {
                state.callOrder.push('mcpTokens')
                if (state.failOn?.mcpTokens) {
                  throw state.failOn.mcpTokens
                }
                const cutoff = new Date(cutoffBound).getTime()
                let changes = 0
                for (const token of state.mcpTokens) {
                  const governingIso = token.revokedAt ?? token.expiresAt ?? token.createdAt
                  const isNonLive =
                    token.status === 'revoked' ||
                    token.status === 'expired' ||
                    token.expiresAt !== null
                  const notAlreadyRedacted = !token.tokenHash.startsWith('redacted:')
                  if (
                    new Date(governingIso).getTime() <= cutoff &&
                    isNonLive &&
                    notAlreadyRedacted
                  ) {
                    token.tokenHash = `redacted:${token.id}`
                    token.name = '[redacted]'
                    token.scopesJson = '[]'
                    token.revokedReason = token.revokedReason ?? 'retention-expired'
                    changes++
                  }
                }
                return { meta: { changes } }
              },
            }
          },
        }
      }

      throw new Error(`unexpected query in fake D1: ${normalized}`)
    },
  }
}

const NOW = new Date('2026-04-18T12:00:00.000Z')
const INSIDE_WINDOW = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
const OUTSIDE_WINDOW = new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000) // 200 days ago

describe('runRetentionCleanup', () => {
  let state: FakeState

  beforeEach(() => {
    state = {
      queryLogs: [],
      citationRecords: [],
      sourceChunks: [],
      mcpTokens: [],
      callOrder: [],
    }
  })

  it('returns zero deletes when all tables are empty', async () => {
    const result = await runRetentionCleanup({
      database: createFakeDatabase(state),
      now: NOW,
    })

    expect(result.retentionDays).toBe(DEFAULT_RETENTION_DAYS)
    expect(result.deleted).toEqual({
      queryLogs: 0,
      citationRecords: 0,
      sourceChunkText: 0,
      mcpTokenMetadata: 0,
    })
    expect(result.errors).toHaveLength(0)
    expect(result.cutoff).toBe(computeRetentionCutoff({ retentionDays: 180 }, NOW))
  })

  it('deletes expired query_logs but preserves rows within the retention window', async () => {
    state.queryLogs.push(
      { id: 'ql-expired', createdAt: iso(OUTSIDE_WINDOW) },
      { id: 'ql-fresh', createdAt: iso(INSIDE_WINDOW) }
    )

    const result = await runRetentionCleanup({
      database: createFakeDatabase(state),
      now: NOW,
    })

    expect(result.deleted.queryLogs).toBe(1)
    expect(state.queryLogs).toEqual([{ id: 'ql-fresh', createdAt: iso(INSIDE_WINDOW) }])
  })

  it('expires citation_records before deleting query_logs (audit chain order)', async () => {
    state.queryLogs.push({ id: 'ql-expired', createdAt: iso(OUTSIDE_WINDOW) })
    state.citationRecords.push({
      id: 'cr-expired',
      queryLogId: 'ql-expired',
      expiresAt: iso(OUTSIDE_WINDOW),
    })

    const result = await runRetentionCleanup({
      database: createFakeDatabase(state),
      now: NOW,
    })

    expect(state.callOrder).toEqual(['citationRecords', 'queryLogs', 'sourceChunks', 'mcpTokens'])
    expect(state.callOrder.indexOf('citationRecords')).toBeLessThan(
      state.callOrder.indexOf('queryLogs')
    )
    expect(result.deleted.citationRecords).toBe(1)
    expect(result.deleted.queryLogs).toBe(1)
    expect(state.citationRecords).toHaveLength(0)
    expect(state.queryLogs).toHaveLength(0)
  })

  it('scrubs expired source_chunks.chunk_text but keeps the row and metadata intact', async () => {
    state.sourceChunks.push(
      {
        id: 'sc-expired',
        chunkText: 'confidential content',
        chunkHash: 'hash-1',
        createdAt: iso(OUTSIDE_WINDOW),
      },
      {
        id: 'sc-fresh',
        chunkText: 'still needed',
        chunkHash: 'hash-2',
        createdAt: iso(INSIDE_WINDOW),
      }
    )

    const result = await runRetentionCleanup({
      database: createFakeDatabase(state),
      now: NOW,
    })

    expect(result.deleted.sourceChunkText).toBe(1)

    const expired = state.sourceChunks.find((row) => row.id === 'sc-expired')
    const fresh = state.sourceChunks.find((row) => row.id === 'sc-fresh')

    expect(state.sourceChunks).toHaveLength(2)
    expect(expired?.chunkText).toBe('')
    expect(expired?.chunkHash).toBe('hash-1') // metadata preserved
    expect(fresh?.chunkText).toBe('still needed')
  })

  it('is idempotent: running twice on the same clock yields zero additional deletes', async () => {
    state.queryLogs.push({ id: 'ql-expired', createdAt: iso(OUTSIDE_WINDOW) })
    state.citationRecords.push({
      id: 'cr-expired',
      queryLogId: 'ql-expired',
      expiresAt: iso(OUTSIDE_WINDOW),
    })
    state.sourceChunks.push({
      id: 'sc-expired',
      chunkText: 'confidential content',
      chunkHash: 'hash-1',
      createdAt: iso(OUTSIDE_WINDOW),
    })
    state.mcpTokens.push({
      id: 'tok-expired',
      tokenHash: 'hash-secret',
      name: 'staging-bot',
      scopesJson: '["knowledge.search"]',
      status: 'revoked',
      createdAt: iso(OUTSIDE_WINDOW),
      expiresAt: null,
      revokedAt: iso(OUTSIDE_WINDOW),
      revokedReason: null,
    })

    const db = createFakeDatabase(state)
    const first = await runRetentionCleanup({ database: db, now: NOW })
    const second = await runRetentionCleanup({ database: db, now: NOW })

    expect(first.deleted).toEqual({
      queryLogs: 1,
      citationRecords: 1,
      sourceChunkText: 1,
      mcpTokenMetadata: 1,
    })
    expect(second.deleted).toEqual({
      queryLogs: 0,
      citationRecords: 0,
      sourceChunkText: 0,
      mcpTokenMetadata: 0,
    })
    expect(second.errors).toHaveLength(0)
  })

  it('continues subsequent steps when one step fails and records the error', async () => {
    // Seed data so every step would have something to delete/scrub.
    state.queryLogs.push({ id: 'ql-expired', createdAt: iso(OUTSIDE_WINDOW) })
    state.citationRecords.push({
      id: 'cr-expired',
      queryLogId: 'ql-expired',
      expiresAt: iso(OUTSIDE_WINDOW),
    })
    state.sourceChunks.push({
      id: 'sc-expired',
      chunkText: 'confidential content',
      chunkHash: 'hash-1',
      createdAt: iso(OUTSIDE_WINDOW),
    })
    state.mcpTokens.push({
      id: 'tok-expired',
      tokenHash: 'hash-secret',
      name: 'staging-bot',
      scopesJson: '["knowledge.search"]',
      status: 'revoked',
      createdAt: iso(OUTSIDE_WINDOW),
      expiresAt: null,
      revokedAt: iso(OUTSIDE_WINDOW),
      revokedReason: null,
    })

    // Fail the source_chunks step. Subsequent mcp_tokens step must still run.
    state.failOn = { sourceChunks: new Error('simulated D1 outage') }

    const result = await runRetentionCleanup({
      database: createFakeDatabase(state),
      now: NOW,
    })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ step: 'sourceChunkText' })
    expect(result.errors[0]?.message).toContain('simulated D1 outage')

    // Steps before the failure ran and succeeded.
    expect(result.deleted.citationRecords).toBe(1)
    expect(result.deleted.queryLogs).toBe(1)

    // The failing step reports zero.
    expect(result.deleted.sourceChunkText).toBe(0)

    // The step AFTER the failure still ran (fail-safe guarantee).
    expect(result.deleted.mcpTokenMetadata).toBe(1)
    expect(state.callOrder).toContain('mcpTokens')
  })

  it('honors the retentionDays override for staging backdated verification', async () => {
    const staging = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    state.queryLogs.push({ id: 'ql-staged', createdAt: iso(staging) })

    const result = await runRetentionCleanup({
      database: createFakeDatabase(state),
      now: NOW,
      retentionDays: 5, // shortened TTL for staging validation
    })

    expect(result.retentionDays).toBe(5)
    expect(result.deleted.queryLogs).toBe(1)
  })
})

describe('shared retention policy constants', () => {
  it('covers the four entities enumerated by retention-cleanup-governance spec', () => {
    const entities = Object.values(RETENTION_POLICY).map((entry) => entry.entity)
    expect(entities).toEqual(
      expect.arrayContaining([
        'query_logs',
        'citation_records',
        'source_chunks.chunk_text',
        'mcp_tokens',
      ])
    )
  })

  it('uses 180-day retention for every category per governance-and-observability spec', () => {
    for (const entry of Object.values(RETENTION_POLICY)) {
      expect(entry.retentionDays).toBe(180)
    }
  })

  it('computes deterministic cutoff timestamps', () => {
    const cutoff = computeRetentionCutoff(
      { retentionDays: 180 },
      new Date('2026-04-18T00:00:00.000Z')
    )
    expect(cutoff).toBe('2025-10-20T00:00:00.000Z')
  })
})
