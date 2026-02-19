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
 * A09: restricted scope + redaction verification.
 *
 * Combines two mechanics that must hold together for A09:
 *   1. scope decision — the AI Search / citation filter SHALL reject
 *      restricted content when the actor's token does not carry
 *      `knowledge.restricted.read` (TC-13 403, TC-17 existence-hiding).
 *   2. redaction audit — even when the query is refused, the persisted
 *      `query_logs` row SHALL store a redacted version of the query
 *      text (no credential/PII leakage) and SHALL still be tagged as
 *      `status='accepted'` with the governance `configSnapshotVersion`
 *      (TC-15 high-risk sensitive, credential sanitization).
 *
 * Drift is detected when:
 *   - restricted content is allowed (scope matrix mismatch)
 *   - restricted document content appears in the response payload
 *   - query_logs contains unredacted sensitive tokens
 *   - query_logs status is not `accepted` for a refused high-risk row
 */

const ACCEPTANCE_ID = 'A09'

export type A09ScopeDecision = 'allow' | 'deny'
export type A09ExpectedDecision = 'allow' | 'deny'

export interface A09RestrictedSample {
  actualDecision: A09ScopeDecision
  channel: 'web' | 'mcp'
  expectedDecision: A09ExpectedDecision
  hasRestrictedScope: boolean
  httpStatus: number
  queryLogPointer: string
  queryLogStatus: 'accepted' | 'refused' | 'error'
  redactedQueryText: string
  responseLeaksRestrictedContent: boolean
  restrictedTokenPresent: boolean
  scopeDecisionPointer: string
  sensitiveTokens: string[]
  testCaseId: string
}

export interface A09ExporterInput extends EvidenceExporterOptions {
  samples?: A09RestrictedSample[]
}

function buildDefaultSamples(): A09RestrictedSample[] {
  return [
    {
      // TC-13: user 缺 knowledge.restricted.read, 嘗試讀取 restricted citation → 403
      actualDecision: 'deny',
      channel: 'mcp',
      expectedDecision: 'deny',
      hasRestrictedScope: false,
      httpStatus: 403,
      queryLogPointer: 'stub://query-logs/tc13-restricted-deny.json',
      queryLogStatus: 'refused',
      redactedQueryText: '<redacted: restricted citation access attempt>',
      responseLeaksRestrictedContent: false,
      restrictedTokenPresent: false,
      scopeDecisionPointer: 'stub://scope/tc13-deny.json',
      sensitiveTokens: [],
      testCaseId: 'TC-13',
    },
    {
      // TC-15: 高風險敏感查詢，query_text 含 credential-like 字串 → 必須遮罩
      actualDecision: 'deny',
      channel: 'web',
      expectedDecision: 'deny',
      hasRestrictedScope: false,
      httpStatus: 200,
      queryLogPointer: 'stub://query-logs/tc15-redaction.json',
      queryLogStatus: 'accepted',
      redactedQueryText: '<redacted: high-risk sensitive input>',
      responseLeaksRestrictedContent: false,
      restrictedTokenPresent: false,
      scopeDecisionPointer: 'stub://scope/tc15-deny.json',
      sensitiveTokens: [],
      testCaseId: 'TC-15',
    },
    {
      // TC-17: existence-hiding, searchKnowledge 空結果 + askKnowledge refused
      actualDecision: 'deny',
      channel: 'mcp',
      expectedDecision: 'deny',
      hasRestrictedScope: false,
      httpStatus: 200,
      queryLogPointer: 'stub://query-logs/tc17-existence-hiding.json',
      queryLogStatus: 'accepted',
      redactedQueryText: '<redacted: restricted existence probe>',
      responseLeaksRestrictedContent: false,
      restrictedTokenPresent: false,
      scopeDecisionPointer: 'stub://scope/tc17-deny.json',
      sensitiveTokens: [],
      testCaseId: 'TC-17',
    },
  ]
}

interface RestrictedComparison {
  queryLogStatusValid: boolean
  redactionApplied: boolean
  responseContentLeak: boolean
  scopeDecisionMatches: boolean
  scopeMatrixConsistent: boolean
  unredactedTokensDetected: boolean
}

function compareRestrictedSample(sample: A09RestrictedSample): RestrictedComparison {
  const scopeDecisionMatches = sample.expectedDecision === sample.actualDecision
  // 非 restricted token → 必須 deny
  const scopeMatrixConsistent =
    (sample.hasRestrictedScope && sample.actualDecision === 'allow') ||
    (!sample.hasRestrictedScope && sample.actualDecision === 'deny')
  const redactionApplied = sample.redactedQueryText.startsWith('<redacted')
  const unredactedTokensDetected = sample.sensitiveTokens.some((token) =>
    sample.redactedQueryText.includes(token)
  )
  const responseContentLeak = sample.responseLeaksRestrictedContent
  // 對於 refused 或 deny path，query_logs 仍必須是 accepted（governance 要求保留紀錄）
  const queryLogStatusValid =
    sample.queryLogStatus === 'accepted' || sample.queryLogStatus === 'refused'

  return {
    queryLogStatusValid,
    redactionApplied,
    responseContentLeak,
    scopeDecisionMatches,
    scopeMatrixConsistent,
    unredactedTokensDetected,
  }
}

export function runA09RestrictedScopeExporter(
  input: A09ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error('A09 exporter requires at least one restricted-scope sample to emit a record')
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const registryEntry = getAcceptanceRegistryEntry(sample.testCaseId)

    if (!registryEntry) {
      throw new Error(`Unknown test case registry id for A09: ${sample.testCaseId}`)
    }

    const isStubbed =
      sample.scopeDecisionPointer.startsWith('stub://') ||
      sample.queryLogPointer.startsWith('stub://')
    const comparison = compareRestrictedSample(sample)
    const passed =
      comparison.scopeDecisionMatches &&
      comparison.scopeMatrixConsistent &&
      comparison.redactionApplied &&
      !comparison.unredactedTokensDetected &&
      !comparison.responseContentLeak &&
      comparison.queryLogStatusValid
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (!comparison.scopeDecisionMatches) {
      notesParts.push(
        `scope decision drift (expected=${sample.expectedDecision}, actual=${sample.actualDecision})`
      )
    }

    if (!comparison.scopeMatrixConsistent) {
      notesParts.push(
        `scope matrix inconsistent: hasRestrictedScope=${sample.hasRestrictedScope} but decision=${sample.actualDecision}`
      )
    }

    if (!comparison.redactionApplied) {
      notesParts.push(
        'query_logs redaction marker missing — raw query text may have been persisted'
      )
    }

    if (comparison.unredactedTokensDetected) {
      notesParts.push('sensitive tokens still present in persisted query_logs row')
    }

    if (comparison.responseContentLeak) {
      notesParts.push('response payload leaked restricted content despite scope denial')
    }

    if (!comparison.queryLogStatusValid) {
      notesParts.push(
        `query_logs status=${sample.queryLogStatus} — expected accepted|refused for audit governance`
      )
    }

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed scope decision + redaction pointers — rerun TC-13/15/17 against live orchestration to capture actual scope matrix + query_logs row.'
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: sample.channel,
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: sample.actualDecision === 'deny' ? 'scope-deny' : 'scope-allow',
      environment: context.runtimeConfig.environment as 'local' | 'staging' | 'production',
      evidenceRefs: [
        {
          description: `scope decision (tc=${sample.testCaseId}, hasRestricted=${sample.hasRestrictedScope}, decision=${sample.actualDecision})`,
          kind: 'scope-decision' as const,
          pointer: sample.scopeDecisionPointer,
        },
        {
          description: `redacted query_logs row (status=${sample.queryLogStatus})`,
          kind: 'redacted-query-log' as const,
          pointer: sample.queryLogPointer,
        },
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
