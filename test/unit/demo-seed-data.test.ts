import { describe, expect, it } from 'vitest'

import {
  buildDemoSeed,
  REQUIRED_DEMO_FEATURES,
  summarizeDemoSeed,
} from '../../scripts/demo-seed/demo-seed-data.ts'

describe('production/staging demo seed data', () => {
  it('covers every display surface with rich deterministic mock data', async () => {
    const seed = await buildDemoSeed({
      environment: 'staging',
      now: new Date('2026-05-04T08:00:00.000Z'),
    })
    const summary = summarizeDemoSeed(seed)

    expect(seed.featureCoverage.map((feature) => feature.id)).toEqual(REQUIRED_DEMO_FEATURES)
    expect(summary.documents).toBeGreaterThanOrEqual(12)
    expect(summary.currentDocuments).toBeGreaterThanOrEqual(10)
    expect(summary.archivedDocuments).toBeGreaterThanOrEqual(1)
    expect(summary.documentVersions).toBeGreaterThanOrEqual(14)
    expect(summary.sourceChunks).toBeGreaterThanOrEqual(60)
    expect(summary.r2Objects).toBeGreaterThanOrEqual(70)
    expect(summary.queryLogs).toBeGreaterThanOrEqual(16)
    expect(summary.citationRecords).toBeGreaterThanOrEqual(8)
    expect(summary.conversations).toBeGreaterThanOrEqual(5)
    expect(summary.messages).toBeGreaterThanOrEqual(16)
    expect(summary.users).toBeGreaterThanOrEqual(5)
    expect(summary.mcpTokens).toBeGreaterThanOrEqual(4)
    expect(summary.memberRoleChanges).toBeGreaterThanOrEqual(4)

    expect(seed.documents.some((document) => document.accessLevel === 'restricted')).toBe(true)
    expect(seed.queryLogs.some((log) => log.redactionApplied)).toBe(true)
    expect(seed.queryLogs.some((log) => log.status === 'blocked')).toBe(true)
    expect(seed.queryLogs.some((log) => log.rewriterStatus === 'success')).toBe(true)
    expect(seed.mcpTokens.map((token) => token.status).toSorted()).toEqual([
      'active',
      'active',
      'expired',
      'revoked',
    ])
  })

  it('keeps ids environment-scoped and stable for idempotent re-runs', async () => {
    const now = new Date('2026-05-04T08:00:00.000Z')
    const first = await buildDemoSeed({ environment: 'production', now })
    const second = await buildDemoSeed({ environment: 'production', now })

    expect(first.summary.seedKey).toBe('demo-production-v2026-05-04')
    expect(first.summary).toEqual(second.summary)
    expect(first.documents.map((document) => document.id)).toEqual(
      second.documents.map((document) => document.id),
    )
    expect(first.documentVersions.map((version) => version.id)).toEqual(
      second.documentVersions.map((version) => version.id),
    )
    expect(first.sourceChunks.map((chunk) => chunk.id)).toEqual(
      second.sourceChunks.map((chunk) => chunk.id),
    )
    expect(first.r2Objects.map((object) => [object.key, object.customMetadata])).toEqual(
      second.r2Objects.map((object) => [object.key, object.customMetadata]),
    )
  })
})
