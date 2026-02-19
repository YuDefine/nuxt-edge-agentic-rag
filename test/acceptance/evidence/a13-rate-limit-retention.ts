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
 * A13: rate limit 與保留期限規則可驗證性輸出 (EV-04).
 *
 * 串接三段證據鍊：
 *   1. rate-limit state — KV 紀錄的 counter + 最近 429 回應 snapshot
 *   2. retention cleanup report — cleanup run 執行結果（cut-off、被清理的
 *      record 數、backdated record 是否被正確清除）
 *   3. replay 前後比對 — backdated record 在清理前可 replay、清理後
 *      replay 失敗或 404（stale protection）
 *
 * Drift 定義：
 *   - rate-limit：實際 429 數 !== 預期 429 數（rule 生效異常）
 *   - retention：cut-off 後仍存在應清理的 record
 *   - replay：清理前 replay 應 200、清理後應 404/410，若不符合則 failed
 */

const ACCEPTANCE_ID = 'A13'

export interface A13RateLimitObservation {
  actualRateLimitedCount: number
  expectedRateLimitedCount: number
  kvStatePointer: string
  rateLimitKeyCount: number
  rateLimitWindowSeconds: number
  sampleRequestCount: number
}

export interface A13RetentionObservation {
  backdatedRecordCleaned: boolean
  backdatedRecordCount: number
  cleanupReportPointer: string
  cutoffIsoTimestamp: string
  recordsEligible: number
  recordsRemainingAfterCleanup: number
  recordsRemoved: number
}

export interface A13ReplayObservation {
  backdatedRecordId: string
  postCleanupHttpStatus: number
  postCleanupReplayPointer: string
  preCleanupHttpStatus: number
  preCleanupReplayPointer: string
}

export interface A13RateLimitRetentionSample {
  rateLimit: A13RateLimitObservation
  replay: A13ReplayObservation
  retention: A13RetentionObservation
}

export interface A13ExporterInput extends EvidenceExporterOptions {
  samples?: A13RateLimitRetentionSample[]
}

function buildDefaultSamples(): A13RateLimitRetentionSample[] {
  return [
    {
      rateLimit: {
        actualRateLimitedCount: 3,
        expectedRateLimitedCount: 3,
        kvStatePointer: 'stub://rate-limit/kv-state.json',
        rateLimitKeyCount: 1,
        rateLimitWindowSeconds: 60,
        sampleRequestCount: 10,
      },
      replay: {
        backdatedRecordId: 'citation-backdated-ev04',
        postCleanupHttpStatus: 404,
        postCleanupReplayPointer: 'stub://replay/ev04-post-cleanup.json',
        preCleanupHttpStatus: 200,
        preCleanupReplayPointer: 'stub://replay/ev04-pre-cleanup.json',
      },
      retention: {
        backdatedRecordCleaned: true,
        backdatedRecordCount: 1,
        cleanupReportPointer: 'stub://retention/cleanup-report.json',
        cutoffIsoTimestamp: '2026-04-04T00:00:00.000Z',
        recordsEligible: 5,
        recordsRemainingAfterCleanup: 0,
        recordsRemoved: 5,
      },
    },
  ]
}

interface RateLimitRetentionComparison {
  rateLimitRuleEffective: boolean
  replayChainConsistent: boolean
  retentionCleanupComplete: boolean
}

function compareSample(sample: A13RateLimitRetentionSample): RateLimitRetentionComparison {
  const rateLimitRuleEffective =
    sample.rateLimit.actualRateLimitedCount === sample.rateLimit.expectedRateLimitedCount &&
    sample.rateLimit.actualRateLimitedCount > 0

  const retentionCleanupComplete =
    sample.retention.recordsRemainingAfterCleanup === 0 &&
    sample.retention.backdatedRecordCleaned &&
    sample.retention.recordsRemoved >= sample.retention.recordsEligible

  // pre-cleanup 必須 200（可 replay）、post-cleanup 必須 404 或 410
  const replayChainConsistent =
    sample.replay.preCleanupHttpStatus === 200 &&
    (sample.replay.postCleanupHttpStatus === 404 || sample.replay.postCleanupHttpStatus === 410)

  return {
    rateLimitRuleEffective,
    replayChainConsistent,
    retentionCleanupComplete,
  }
}

export function runA13RateLimitRetentionExporter(
  input: A13ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error(
      'A13 exporter requires at least one rate-limit/retention sample to emit a record'
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
