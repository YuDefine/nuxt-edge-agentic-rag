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
 * A12: MCP no-internal-diagnostics 契約快照 (TC-20, TC-16/17 延伸).
 *
 * 驗證對外 MCP 工具回應的 JSON schema **不含內部診斷欄位**。被禁用
 * 的欄位清單（與 test/integration/acceptance-tc-20.test.ts 對齊）：
 *   - `decisionPath`
 *   - `retrievalScore`
 *   - `documentVersionId`
 *   - `firstTokenLatencyMs`
 *   - `completionLatencyMs`
 *   - `confidenceScore`
 *   - `debugInfo`
 *   - `_meta`
 *
 * 每個 sample 儲存實際 MCP 工具呼叫的 contract snapshot（pointer），
 * 並列出在 response body 中偵測到的禁用欄位。重用既有
 * `contract-snapshot` payload kind。Drift 定義：`forbiddenKeysFound`
 * 非空 or `contractDrift=true`。
 */

const ACCEPTANCE_ID = 'A12'

export const A12_FORBIDDEN_INTERNAL_KEYS: readonly string[] = [
  'decisionPath',
  'retrievalScore',
  'documentVersionId',
  'firstTokenLatencyMs',
  'completionLatencyMs',
  'confidenceScore',
  'debugInfo',
  '_meta',
]

export type A12McpTool = 'searchKnowledge' | 'askKnowledge' | 'getDocumentChunk' | 'listCategories'

export interface A12ContractSample {
  contractDrift: boolean
  contractSnapshotPointer: string
  forbiddenKeysFound: string[]
  httpStatus: number
  inspectorLogPointer: string
  responseBodySummary: string
  testCaseId: string
  tool: A12McpTool
}

export interface A12ExporterInput extends EvidenceExporterOptions {
  samples?: A12ContractSample[]
}

function buildDefaultSamples(): A12ContractSample[] {
  return [
    {
      contractDrift: false,
      contractSnapshotPointer: 'stub://mcp/contract/tc20-search.json',
      forbiddenKeysFound: [],
      httpStatus: 200,
      inspectorLogPointer: 'stub://mcp/inspector/tc20-search.json',
      responseBodySummary:
        'searchKnowledge.results[] 只含白名單欄位 accessLevel/categorySlug/citationLocator/excerpt/title',
      testCaseId: 'TC-20',
      tool: 'searchKnowledge',
    },
    {
      contractDrift: false,
      contractSnapshotPointer: 'stub://mcp/contract/tc20-list-categories.json',
      forbiddenKeysFound: [],
      httpStatus: 200,
      inspectorLogPointer: 'stub://mcp/inspector/tc20-list-categories.json',
      responseBodySummary: 'listCategories.entries[] 只含 { name, count }',
      testCaseId: 'TC-20',
      tool: 'listCategories',
    },
    {
      contractDrift: false,
      contractSnapshotPointer: 'stub://mcp/contract/tc17-existence-hiding.json',
      forbiddenKeysFound: [],
      httpStatus: 200,
      inspectorLogPointer: 'stub://mcp/inspector/tc17-existence-hiding.json',
      responseBodySummary:
        'askKnowledge refused envelope 不含 answer / citations / decisionPath / retrievalScore',
      testCaseId: 'TC-17',
      tool: 'askKnowledge',
    },
  ]
}

interface ContractComparison {
  contractDriftDetected: boolean
  forbiddenKeysCount: number
  hasForbiddenKeys: boolean
}

function compareContractSample(sample: A12ContractSample): ContractComparison {
  return {
    contractDriftDetected: sample.contractDrift,
    forbiddenKeysCount: sample.forbiddenKeysFound.length,
    hasForbiddenKeys: sample.forbiddenKeysFound.length > 0,
  }
}

export function runA12McpNoInternalDiagnosticsExporter(
  input: A12ExporterInput = {},
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error('A12 exporter requires at least one contract sample to emit a record')
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const registryEntry = getAcceptanceRegistryEntry(sample.testCaseId)

    if (!registryEntry) {
      throw new Error(`Unknown test case registry id for A12: ${sample.testCaseId}`)
    }

    const isStubbed =
      sample.contractSnapshotPointer.startsWith('stub://') ||
      sample.inspectorLogPointer.startsWith('stub://')
    const comparison = compareContractSample(sample)
    const passed = !comparison.hasForbiddenKeys && !comparison.contractDriftDetected
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (comparison.hasForbiddenKeys) {
      notesParts.push(
        `MCP ${sample.tool} response exposes forbidden internal diagnostic keys: ${sample.forbiddenKeysFound.join(', ')}`,
      )
    }

    if (comparison.contractDriftDetected) {
      notesParts.push(`contract snapshot drift detected on tool=${sample.tool}`)
    }

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed contract snapshot + inspector log — rerun MCP Inspector against ${tool} and diff against stored contract to capture real evidence.',
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'mcp',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: 'no-internal-diagnostics',
      environment: context.runtimeConfig.environment,
      evidenceRefs: [
        {
          description: `contract snapshot for ${sample.tool} (forbiddenKeys=${sample.forbiddenKeysFound.length})`,
          kind: 'contract-snapshot' as const,
          pointer: sample.contractSnapshotPointer,
        },
        {
          description: `MCP Inspector log for ${sample.tool} (${sample.testCaseId})`,
          kind: 'mcp-inspector-log' as const,
          pointer: sample.inspectorLogPointer,
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
