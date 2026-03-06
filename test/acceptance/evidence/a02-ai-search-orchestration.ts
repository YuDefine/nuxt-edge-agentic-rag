import type {
  AcceptanceEvidenceExport,
  AcceptanceEvidenceRecord,
} from '#shared/schemas/acceptance-evidence'

import { getAcceptanceRegistryEntry, type AcceptanceCaseRegistryEntry } from '../registry/manifest'
import {
  createEvidenceExport,
  createEvidenceExporterContext,
  type EvidenceExporterOptions,
} from './shared'

/**
 * A02: AI Search + Agent orchestration verification.
 *
 * Collects representative query-log / citation evidence showing the
 * orchestration path for each probed case (direct / judge_pass /
 * self_corrected / refused). Real runs should feed in observations
 * captured during `pnpm test:integration` (via the acceptance-tc-*.test.ts
 * D1 fake); locally we default to a deterministic dataset that mirrors
 * the existing TC-01 / TC-04 / TC-06 / TC-10 fixtures so the exporter
 * stays testable without invoking vitest mocks.
 */

const ACCEPTANCE_ID = 'A02'

const DEFAULT_CASE_IDS = ['TC-01', 'TC-04', 'TC-06', 'TC-10'] as const

export interface A02OrchestrationObservation {
  aiSearchRequestPointer: string
  aiSearchResponsePointer: string
  aiSearchScore: number
  answerSummary: string
  channel: 'web' | 'mcp'
  citationIds: string[]
  decisionPath: 'direct' | 'judge_pass' | 'self_corrected' | 'refused'
  httpStatus: number
  queryLogPointer: string
  sourceChunkIds: string[]
  testCaseId: string
}

export interface A02ExporterInput extends EvidenceExporterOptions {
  observations?: A02OrchestrationObservation[]
}

function buildDefaultObservations(): A02OrchestrationObservation[] {
  return DEFAULT_CASE_IDS.map((testCaseId) => buildStubObservation(testCaseId))
}

function buildStubObservation(testCaseId: string): A02OrchestrationObservation {
  const baseSuffix = testCaseId.toLowerCase()

  switch (testCaseId) {
    case 'TC-01':
      return {
        aiSearchRequestPointer: `stub://ai-search/${baseSuffix}-request.json`,
        aiSearchResponsePointer: `stub://ai-search/${baseSuffix}-response.json`,
        aiSearchScore: 0.91,
        answerSummary: 'PR 為請購需求，PO 為核准後的採購訂單。',
        channel: 'web',
        citationIds: ['cit-procurement-1'],
        decisionPath: 'direct',
        httpStatus: 200,
        queryLogPointer: `stub://query-logs/${baseSuffix}.json`,
        sourceChunkIds: ['chunk-procurement-1'],
        testCaseId,
      }
    case 'TC-04':
      return {
        aiSearchRequestPointer: `stub://ai-search/${baseSuffix}-request.json`,
        aiSearchResponsePointer: `stub://ai-search/${baseSuffix}-response.json`,
        aiSearchScore: 0.72,
        answerSummary: 'Self-Correction 第二輪改問後取得月結報表欄位定義。',
        channel: 'web',
        citationIds: ['cit-reporting-3'],
        decisionPath: 'self_corrected',
        httpStatus: 200,
        queryLogPointer: `stub://query-logs/${baseSuffix}.json`,
        sourceChunkIds: ['chunk-reporting-3'],
        testCaseId,
      }
    case 'TC-06':
      return {
        aiSearchRequestPointer: `stub://ai-search/${baseSuffix}-request.json`,
        aiSearchResponsePointer: `stub://ai-search/${baseSuffix}-response.json`,
        aiSearchScore: 0.68,
        answerSummary: '退貨流程與採購流程差異：退貨由倉管發動，採購由請購發動。',
        channel: 'web',
        citationIds: ['cit-return-2', 'cit-procurement-7'],
        decisionPath: 'judge_pass',
        httpStatus: 200,
        queryLogPointer: `stub://query-logs/${baseSuffix}.json`,
        sourceChunkIds: ['chunk-return-2', 'chunk-procurement-7'],
        testCaseId,
      }
    case 'TC-10':
      return {
        aiSearchRequestPointer: `stub://ai-search/${baseSuffix}-request.json`,
        aiSearchResponsePointer: `stub://ai-search/${baseSuffix}-response.json`,
        aiSearchScore: 0.87,
        answerSummary: '新進人員請假規定：試用期內以特休假為主。',
        channel: 'web',
        citationIds: ['cit-policy-4'],
        decisionPath: 'direct',
        httpStatus: 200,
        queryLogPointer: `stub://query-logs/${baseSuffix}.json`,
        sourceChunkIds: ['chunk-policy-4'],
        testCaseId,
      }
    default:
      return {
        aiSearchRequestPointer: `stub://ai-search/${baseSuffix}-request.json`,
        aiSearchResponsePointer: `stub://ai-search/${baseSuffix}-response.json`,
        aiSearchScore: 0.5,
        answerSummary: `Stub observation for ${testCaseId}`,
        channel: 'web',
        citationIds: [],
        decisionPath: 'direct',
        httpStatus: 200,
        queryLogPointer: `stub://query-logs/${baseSuffix}.json`,
        sourceChunkIds: [],
        testCaseId,
      }
  }
}

export function runA02AiSearchOrchestrationExporter(
  input: A02ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const observations = input.observations ?? buildDefaultObservations()

  if (observations.length === 0) {
    throw new Error('A02 exporter requires at least one observation to emit a record')
  }

  const records: AcceptanceEvidenceRecord[] = observations.map((observation) => {
    const registryEntry = getAcceptanceRegistryEntry(
      observation.testCaseId
    ) as AcceptanceCaseRegistryEntry | null

    if (!registryEntry || registryEntry.kind !== 'test-case') {
      throw new Error(`Unknown test case registry id for A02: ${observation.testCaseId}`)
    }

    const isStubbed =
      observation.aiSearchRequestPointer.startsWith('stub://') ||
      observation.aiSearchResponsePointer.startsWith('stub://')

    const evidenceRefs = [
      {
        description: `AI Search request snapshot (${observation.testCaseId})`,
        kind: 'ai-search-request' as const,
        pointer: observation.aiSearchRequestPointer,
      },
      {
        description: `AI Search response snapshot (${observation.testCaseId}, score=${observation.aiSearchScore})`,
        kind: 'ai-search-response' as const,
        pointer: observation.aiSearchResponsePointer,
      },
      {
        description: `query_logs row (decision=${observation.decisionPath}, http=${observation.httpStatus})`,
        kind: 'query-log' as const,
        pointer: observation.queryLogPointer,
      },
      ...observation.citationIds.map((citationId, index) => ({
        description: `citation_records row → source_chunks.${observation.sourceChunkIds[index] ?? 'unknown'}`,
        kind: 'citation-record' as const,
        pointer: `citation_records:${citationId}`,
      })),
    ]

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: observation.channel,
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: observation.decisionPath,
      environment: context.runtimeConfig.environment,
      evidenceRefs,
      generatedAt: context.generatedAt,
      httpStatus: observation.httpStatus,
      notes: isStubbed
        ? 'Stubbed orchestration observation — replace with live test-run payloads for backfill.'
        : undefined,
      reportVersion: context.reportVersion,
      status: isStubbed ? 'pending-production-run' : 'passed',
      testCaseId: observation.testCaseId,
    }
  })

  return createEvidenceExport(ACCEPTANCE_ID, records, context)
}
