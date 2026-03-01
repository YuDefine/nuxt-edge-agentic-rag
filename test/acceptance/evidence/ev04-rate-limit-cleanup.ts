import type {
  AcceptanceEvidenceExport,
  AcceptanceEvidenceRecord,
} from '#shared/schemas/acceptance-evidence'

import { getAcceptanceRegistryEntry } from '../registry/manifest'
import {
  createEvidenceExport,
  createEvidenceExporterContext,
  type EvidenceExporterOptions,
} from './shared'

/**
 * EV-04: `429` + backdated record + cleanup run evidence chain.
 *
 * Mirrors A13's observation shape so report Chapter 3 can link to both
 * the EV-level chain (this exporter) and the per-acceptance detail
 * (A13) from the same source data. The differences are cosmetic:
 *   - EV-04 is registered under `EV-04` / `A13` acceptance id — the
 *     registry entry is `EV-04`
 *   - records stay untyped to a testCaseId because EV-04 aggregates
 *     ambient rate-limit behaviour, not a single TC
 */

const ACCEPTANCE_ID = 'EV-04'

export interface Ev04RateLimitObservation {
  actualRateLimitedCount: number
  expectedRateLimitedCount: number
  kvStatePointer: string
  rateLimitKeyCount: number
  rateLimitWindowSeconds: number
  sampleRequestCount: number
}

export interface Ev04RetentionObservation {
  backdatedRecordCleaned: boolean
  backdatedRecordCount: number
  cleanupReportPointer: string
  cutoffIsoTimestamp: string
  recordsEligible: number
  recordsRemainingAfterCleanup: number
  recordsRemoved: number
}

export interface Ev04ReplayObservation {
  backdatedRecordId: string
  postCleanupHttpStatus: number
  postCleanupReplayPointer: string
  preCleanupHttpStatus: number
  preCleanupReplayPointer: string
}

export interface Ev04RateLimitCleanupSample {
  rateLimit: Ev04RateLimitObservation
  replay: Ev04ReplayObservation
  retention: Ev04RetentionObservation
}

export interface Ev04ExporterInput extends EvidenceExporterOptions {
  samples?: Ev04RateLimitCleanupSample[]
}

function buildDefaultSamples(): Ev04RateLimitCleanupSample[] {
  return [
    {
      rateLimit: {
        actualRateLimitedCount: 3,
        expectedRateLimitedCount: 3,
        kvStatePointer: 'stub://ev04/rate-limit-kv.json',
        rateLimitKeyCount: 1,
        rateLimitWindowSeconds: 60,
        sampleRequestCount: 10,
      },
      replay: {
        backdatedRecordId: 'citation-backdated-ev04',
        postCleanupHttpStatus: 404,
        postCleanupReplayPointer: 'stub://ev04/replay-post.json',
        preCleanupHttpStatus: 200,
        preCleanupReplayPointer: 'stub://ev04/replay-pre.json',
      },
      retention: {
        backdatedRecordCleaned: true,
        backdatedRecordCount: 1,
        cleanupReportPointer: 'stub://ev04/retention-cleanup.json',
        cutoffIsoTimestamp: '2026-04-04T00:00:00.000Z',
        recordsEligible: 5,
        recordsRemainingAfterCleanup: 0,
        recordsRemoved: 5,
      },
    },
  ]
}

interface Ev04Comparison {
  rateLimitRuleEffective: boolean
  replayChainConsistent: boolean
  retentionCleanupComplete: boolean
}

function compareSample(sample: Ev04RateLimitCleanupSample): Ev04Comparison {
  const rateLimitRuleEffective =
    sample.rateLimit.actualRateLimitedCount === sample.rateLimit.expectedRateLimitedCount &&
    sample.rateLimit.actualRateLimitedCount > 0

  const retentionCleanupComplete =
    sample.retention.recordsRemainingAfterCleanup === 0 &&
    sample.retention.backdatedRecordCleaned &&
    sample.retention.recordsRemoved >= sample.retention.recordsEligible

  const replayChainConsistent =
    sample.replay.preCleanupHttpStatus === 200 &&
    (sample.replay.postCleanupHttpStatus === 404 || sample.replay.postCleanupHttpStatus === 410)

  return {
    rateLimitRuleEffective,
    replayChainConsistent,
    retentionCleanupComplete,
  }
}

export function runEv04RateLimitCleanupExporter(
  input: Ev04ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error(
      'EV-04 exporter requires at least one rate-limit/retention sample to emit a record'
    )
  }

  const registryEntry = getAcceptanceRegistryEntry(ACCEPTANCE_ID)

  if (!registryEntry) {
    throw new Error(`Registry entry not found for ${ACCEPTANCE_ID}`)
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const isStubbed =
      sample.rateLimit.kvStatePointer.startsWith('stub://') ||
      sample.retention.cleanupReportPointer.startsWith('stub://') ||
      sample.replay.preCleanupReplayPointer.startsWith('stub://') ||
      sample.replay.postCleanupReplayPointer.startsWith('stub://')
    const comparison = compareSample(sample)
    const passed =
      comparison.rateLimitRuleEffective &&
      comparison.retentionCleanupComplete &&
      comparison.replayChainConsistent
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (!comparison.rateLimitRuleEffective) {
      notesParts.push(
        `rate-limit rule drift (expected=${sample.rateLimit.expectedRateLimitedCount} 429s, actual=${sample.rateLimit.actualRateLimitedCount})`
      )
    }

    if (!comparison.retentionCleanupComplete) {
      notesParts.push(
        `retention cleanup incomplete (remaining=${sample.retention.recordsRemainingAfterCleanup}, backdatedCleaned=${sample.retention.backdatedRecordCleaned})`
      )
    }

    if (!comparison.replayChainConsistent) {
      notesParts.push(
        `replay chain inconsistent (pre=${sample.replay.preCleanupHttpStatus}, post=${sample.replay.postCleanupHttpStatus}; expected pre=200, post=404|410)`
      )
    }

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed rate-limit + retention + replay pointers — rerun EV-04 with real KV counter, retention cleanup run, and replay probes to capture live evidence.'
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'shared',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: 'rate-limit-retention-replay',
      environment: context.runtimeConfig.environment as 'local' | 'staging' | 'production',
      evidenceRefs: [
        {
          description: `rate-limit KV state (window=${sample.rateLimit.rateLimitWindowSeconds}s, 429count=${sample.rateLimit.actualRateLimitedCount}/${sample.rateLimit.sampleRequestCount})`,
          kind: 'rate-limit-state' as const,
          pointer: sample.rateLimit.kvStatePointer,
        },
        {
          description: `retention cleanup report (cutoff=${sample.retention.cutoffIsoTimestamp}, removed=${sample.retention.recordsRemoved}, remaining=${sample.retention.recordsRemainingAfterCleanup})`,
          kind: 'retention-cleanup-report' as const,
          pointer: sample.retention.cleanupReportPointer,
        },
        {
          description: `replay before cleanup (citation=${sample.replay.backdatedRecordId}, http=${sample.replay.preCleanupHttpStatus})`,
          kind: 'replay-response' as const,
          pointer: sample.replay.preCleanupReplayPointer,
        },
        {
          description: `replay after cleanup (citation=${sample.replay.backdatedRecordId}, http=${sample.replay.postCleanupHttpStatus})`,
          kind: 'replay-response' as const,
          pointer: sample.replay.postCleanupReplayPointer,
        },
      ],
      generatedAt: context.generatedAt,
      httpStatus: sample.replay.preCleanupHttpStatus,
      notes: notesParts.length > 0 ? notesParts.join(' | ') : undefined,
      reportVersion: context.reportVersion,
      status,
      testCaseId: null,
    }
  })

  return createEvidenceExport(ACCEPTANCE_ID, records, context)
}
