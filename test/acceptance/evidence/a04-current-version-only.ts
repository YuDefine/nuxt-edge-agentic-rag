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
 * A04: current-version-only publish cutover verification.
 *
 * Captures the before/after state of a `v1 → v2` version cutover for a
 * document, and confirms that queries asked in the `v2 era` never cite
 * the archived `v1` chunks. Mirrors TC-18 expectations.
 *
 * Each sample describes:
 *   - the query under test
 *   - the answer + citations produced while `v1` was active
 *   - the answer + citations produced after `v2` became current
 *   - the expected outcome (`refused` or `cites_v2_only`)
 *
 * Drift is detected when the `v2 era` citations still reference `v1`
 * chunks or document_version ids. Such rows are marked `failed` and
 * noted so the reporter can attach the diff.
 */

const ACCEPTANCE_ID = 'A04'

export type A04ExpectedOutcome = 'refused' | 'cites_v2_only'

export interface A04VersionEraSnapshot {
  answerSummary: string
  citationIds: string[]
  documentVersionIds: string[]
  orchestrationLogPointer: string
  queryLogPointer: string
  responsePointer: string
}

export interface A04CutoverSample {
  channel: 'web' | 'mcp'
  documentId: string
  expectedOutcome: A04ExpectedOutcome
  httpStatus: number
  query: string
  testCaseId: string
  v1Era: A04VersionEraSnapshot
  v1VersionId: string
  v2Era: A04VersionEraSnapshot
  v2VersionId: string
}

export interface A04ExporterInput extends EvidenceExporterOptions {
  samples?: A04CutoverSample[]
}

function buildDefaultSamples(): A04CutoverSample[] {
  const documentId = 'doc-procurement-sop-tc18'
  const v1VersionId = 'ver-procurement-sop-v1'
  const v2VersionId = 'ver-procurement-sop-v2'

  return [
    {
      channel: 'web',
      documentId,
      expectedOutcome: 'cites_v2_only',
      httpStatus: 200,
      query: '請採購程序最新的簽核層級是幾階？',
      testCaseId: 'TC-18',
      v1Era: {
        answerSummary: '依 v1 採購 SOP：三階簽核（請購人 → 主管 → 採購）',
        citationIds: ['cit-procurement-v1-step-1'],
        documentVersionIds: [v1VersionId],
        orchestrationLogPointer: `stub://orchestration-log/tc18-v1-era.json`,
        queryLogPointer: `stub://query-logs/tc18-v1-era.json`,
        responsePointer: `stub://responses/tc18-v1-era.json`,
      },
      v1VersionId,
      v2Era: {
        answerSummary: '依 v2 採購 SOP：四階簽核（請購人 → 主管 → 採購 → 財務）',
        citationIds: ['cit-procurement-v2-step-1'],
        documentVersionIds: [v2VersionId],
        orchestrationLogPointer: `stub://orchestration-log/tc18-v2-era.json`,
        queryLogPointer: `stub://query-logs/tc18-v2-era.json`,
        responsePointer: `stub://responses/tc18-v2-era.json`,
      },
      v2VersionId,
    },
  ]
}

interface CutoverComparison {
  citesOnlyV2: boolean
  citesV1AfterCutover: boolean
  outcomeMatchesExpected: boolean
}

function compareCutoverSample(sample: A04CutoverSample): CutoverComparison {
  const v2Refs = new Set([...sample.v2Era.citationIds, ...sample.v2Era.documentVersionIds])
  const citesV1AfterCutover =
    v2Refs.has(sample.v1VersionId) ||
    sample.v2Era.documentVersionIds.includes(sample.v1VersionId) ||
    sample.v2Era.citationIds.some((id) => id.includes('v1'))

  const citesOnlyV2 =
    !citesV1AfterCutover && sample.v2Era.documentVersionIds.every((id) => id === sample.v2VersionId)

  const refusedOutcomeValid =
    sample.expectedOutcome === 'refused' &&
    sample.v2Era.citationIds.length === 0 &&
    sample.v2Era.documentVersionIds.length === 0
  const v2OnlyOutcomeValid = sample.expectedOutcome === 'cites_v2_only' && citesOnlyV2

  return {
    citesOnlyV2,
    citesV1AfterCutover,
    outcomeMatchesExpected: refusedOutcomeValid || v2OnlyOutcomeValid,
  }
}

export function runA04CurrentVersionOnlyExporter(
  input: A04ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error('A04 exporter requires at least one cutover sample to emit a record')
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const registryEntry = getAcceptanceRegistryEntry(sample.testCaseId)

    if (!registryEntry) {
      throw new Error(`Unknown test case registry id for A04: ${sample.testCaseId}`)
    }

    const isStubbed =
      sample.v1Era.responsePointer.startsWith('stub://') ||
      sample.v2Era.responsePointer.startsWith('stub://')
    const comparison = compareCutoverSample(sample)
    const passed = comparison.outcomeMatchesExpected && !comparison.citesV1AfterCutover
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (comparison.citesV1AfterCutover) {
      notesParts.push('v2 era response still references archived v1 citations or version ids')
    }

    if (!comparison.outcomeMatchesExpected) {
      notesParts.push(`expected outcome (${sample.expectedOutcome}) did not hold after cutover`)
    }

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed cutover snapshots — rerun TC-18 against live D1 to capture real query payloads.'
      )
    }

    const evidenceRefs = [
      {
        description: `v1 era snapshot (doc=${sample.documentId}, version=${sample.v1VersionId})`,
        kind: 'version-era-snapshot' as const,
        pointer: sample.v1Era.responsePointer,
      },
      {
        description: `v2 era snapshot (doc=${sample.documentId}, version=${sample.v2VersionId})`,
        kind: 'version-era-snapshot' as const,
        pointer: sample.v2Era.responsePointer,
      },
      {
        description: `query_logs row before cutover`,
        kind: 'query-log' as const,
        pointer: sample.v1Era.queryLogPointer,
      },
      {
        description: `query_logs row after cutover`,
        kind: 'query-log' as const,
        pointer: sample.v2Era.queryLogPointer,
      },
      ...sample.v1Era.citationIds.map((citationId) => ({
        description: `v1 citation (archived after cutover): ${citationId}`,
        kind: 'citation-record' as const,
        pointer: `citation_records:${citationId}`,
      })),
      ...sample.v2Era.citationIds.map((citationId) => ({
        description: `v2 citation (active after cutover): ${citationId}`,
        kind: 'citation-record' as const,
        pointer: `citation_records:${citationId}`,
      })),
    ]

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: sample.channel,
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: passed ? 'cutover-current-only' : 'cutover-drift',
      environment: context.runtimeConfig.environment,
      evidenceRefs,
      generatedAt: context.generatedAt,
      httpStatus: sample.httpStatus,
      notes: notesParts.length > 0 ? notesParts.join(' | ') : undefined,
      reportVersion: context.reportVersion,
      status,
      testCaseId: sample.testCaseId,
    }
  })

  return createEvidenceExport(ACCEPTANCE_ID, records, context)
}
