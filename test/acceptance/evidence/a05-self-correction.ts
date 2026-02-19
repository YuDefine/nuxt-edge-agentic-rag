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
 * A05: Self-Correction improvement verification.
 *
 * Captures, per sample, the two-round orchestration of a query that
 * originally failed confidence checks but became answerable after
 * reformulation. Mirrors TC-04 expectations.
 *
 * Each sample records:
 *   - first-round (`initial`) retrieval result that triggered the
 *     self-correction path (low score / no citation / judge fail)
 *   - the reformulated query plus second-round (`retry`) result
 *   - the final decision path (should transition from `direct` to
 *     `self_corrected` — drift otherwise)
 *
 * Failure conditions:
 *   - the retry did not improve over the initial attempt
 *   - the final decision path is not `self_corrected`
 */

const ACCEPTANCE_ID = 'A05'

export interface A05SelfCorrectionRound {
  aiSearchRequestPointer: string
  aiSearchResponsePointer: string
  aiSearchScore: number
  answerSummary: string | null
  citationIds: string[]
  orchestrationLogPointer: string
  queryText: string
}

export interface A05SelfCorrectionSample {
  channel: 'web' | 'mcp'
  finalDecisionPath: 'direct' | 'judge_pass' | 'self_corrected' | 'refused'
  httpStatus: number
  initial: A05SelfCorrectionRound
  retry: A05SelfCorrectionRound
  testCaseId: string
}

export interface A05ExporterInput extends EvidenceExporterOptions {
  samples?: A05SelfCorrectionSample[]
}

function buildDefaultSamples(): A05SelfCorrectionSample[] {
  return [
    {
      channel: 'web',
      finalDecisionPath: 'self_corrected',
      httpStatus: 200,
      initial: {
        aiSearchRequestPointer: 'stub://ai-search/tc04-round1-request.json',
        aiSearchResponsePointer: 'stub://ai-search/tc04-round1-response.json',
        aiSearchScore: 0.38,
        answerSummary: null,
        citationIds: [],
        orchestrationLogPointer: 'stub://orchestration-log/tc04-round1.json',
        queryText: '那個月結報表欄位是什麼',
      },
      retry: {
        aiSearchRequestPointer: 'stub://ai-search/tc04-round2-request.json',
        aiSearchResponsePointer: 'stub://ai-search/tc04-round2-response.json',
        aiSearchScore: 0.81,
        answerSummary: '月結報表包含：對帳金額、折讓、應收餘額與帳齡分析。',
        citationIds: ['cit-reporting-3'],
        orchestrationLogPointer: 'stub://orchestration-log/tc04-round2.json',
        queryText: '月結報表裡有哪些欄位定義？',
      },
      testCaseId: 'TC-04',
    },
  ]
}

interface SelfCorrectionComparison {
  decisionPathMatches: boolean
  retryImprovedOverInitial: boolean
  retryProducedCitation: boolean
}

function compareSelfCorrection(sample: A05SelfCorrectionSample): SelfCorrectionComparison {
  const retryImprovedOverInitial = sample.retry.aiSearchScore > sample.initial.aiSearchScore
  const retryProducedCitation = sample.retry.citationIds.length > 0
  const decisionPathMatches = sample.finalDecisionPath === 'self_corrected'

  return {
    decisionPathMatches,
    retryImprovedOverInitial,
    retryProducedCitation,
  }
}

export function runA05SelfCorrectionExporter(
  input: A05ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error('A05 exporter requires at least one self-correction sample to emit a record')
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const registryEntry = getAcceptanceRegistryEntry(sample.testCaseId)

    if (!registryEntry) {
      throw new Error(`Unknown test case registry id for A05: ${sample.testCaseId}`)
    }

    const isStubbed =
      sample.initial.aiSearchRequestPointer.startsWith('stub://') ||
      sample.retry.aiSearchRequestPointer.startsWith('stub://')
    const comparison = compareSelfCorrection(sample)
    const passed =
      comparison.decisionPathMatches &&
      comparison.retryImprovedOverInitial &&
      comparison.retryProducedCitation
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (!comparison.decisionPathMatches) {
      notesParts.push(
        `decision path did not transition to self_corrected (observed=${sample.finalDecisionPath})`
      )
    }

    if (!comparison.retryImprovedOverInitial) {
      notesParts.push(
        `retry score (${sample.retry.aiSearchScore}) did not improve over initial (${sample.initial.aiSearchScore})`
      )
    }

    if (!comparison.retryProducedCitation) {
      notesParts.push('retry produced zero citations — self-correction considered ineffective')
    }

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed self-correction payloads — rerun TC-04 against live orchestration to capture real AI Search rounds.'
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: sample.channel,
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: sample.finalDecisionPath,
      environment: context.runtimeConfig.environment as 'local' | 'staging' | 'production',
      evidenceRefs: [
        {
          description: `Round 1 AI Search request (query="${sample.initial.queryText}")`,
          kind: 'ai-search-request' as const,
          pointer: sample.initial.aiSearchRequestPointer,
        },
        {
          description: `Round 1 AI Search response (score=${sample.initial.aiSearchScore})`,
          kind: 'ai-search-response' as const,
          pointer: sample.initial.aiSearchResponsePointer,
        },
        {
          description: `Round 1 orchestration log (self-correction triggered)`,
          kind: 'orchestration-log' as const,
          pointer: sample.initial.orchestrationLogPointer,
        },
        {
          description: `Round 2 AI Search request (reformulated query="${sample.retry.queryText}")`,
          kind: 'ai-search-request' as const,
          pointer: sample.retry.aiSearchRequestPointer,
        },
        {
          description: `Round 2 AI Search response (score=${sample.retry.aiSearchScore})`,
          kind: 'ai-search-response' as const,
          pointer: sample.retry.aiSearchResponsePointer,
        },
        {
          description: `Round 2 orchestration log (decision=${sample.finalDecisionPath})`,
          kind: 'orchestration-log-correction' as const,
          pointer: sample.retry.orchestrationLogPointer,
        },
        ...sample.retry.citationIds.map((citationId) => ({
          description: `Round 2 citation: ${citationId}`,
          kind: 'citation-record' as const,
          pointer: `citation_records:${citationId}`,
        })),
      ],
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
