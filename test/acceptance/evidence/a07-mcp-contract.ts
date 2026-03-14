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
 * A07: MCP 4-tools contract verification.
 *
 * Aggregates representative Inspector / contract snapshots for each of
 * the four public MCP tools:
 *   - `searchKnowledge`  (TC-16 no-hit contract)
 *   - `askKnowledge`     (TC-12 answer→replay chain)
 *   - `getDocumentChunk` (TC-12 replay link)
 *   - `listCategories`   (TC-19 active+current counting)
 *
 * Each sample stores pointers to:
 *   - Inspector log (raw tool call + response)
 *   - Contract snapshot (JSON schema of the response shape)
 *
 * Drift detection is intentionally structural — production runs should
 * feed in a diff result against the previous snapshot. Locally we only
 * exercise the wiring (stub pointers emit `pending-production-run`).
 */

const ACCEPTANCE_ID = 'A07'

export type A07McpToolName =
  | 'searchKnowledge'
  | 'askKnowledge'
  | 'getDocumentChunk'
  | 'listCategories'

export interface A07McpToolSample {
  contractDrift: boolean
  contractSnapshotPointer: string
  expectedDecisionPath: string
  httpStatus: number
  inspectorLogPointer: string
  responseSummary: string
  testCaseId: string
  tool: A07McpToolName
}

export interface A07ExporterInput extends EvidenceExporterOptions {
  samples?: A07McpToolSample[]
}

function buildDefaultSamples(): A07McpToolSample[] {
  return [
    {
      contractDrift: false,
      contractSnapshotPointer: 'stub://mcp/contract/search-knowledge.json',
      expectedDecisionPath: '200_empty',
      httpStatus: 200,
      inspectorLogPointer: 'stub://mcp/inspector/search-knowledge-tc16.json',
      responseSummary: 'searchKnowledge no-hit: 200 + results: []',
      testCaseId: 'TC-16',
      tool: 'searchKnowledge',
    },
    {
      contractDrift: false,
      contractSnapshotPointer: 'stub://mcp/contract/ask-knowledge.json',
      expectedDecisionPath: 'direct',
      httpStatus: 200,
      inspectorLogPointer: 'stub://mcp/inspector/ask-knowledge-tc12.json',
      responseSummary: 'askKnowledge returns answer + citations referencing getDocumentChunk',
      testCaseId: 'TC-12',
      tool: 'askKnowledge',
    },
    {
      contractDrift: false,
      contractSnapshotPointer: 'stub://mcp/contract/get-document-chunk.json',
      expectedDecisionPath: 'direct',
      httpStatus: 200,
      inspectorLogPointer: 'stub://mcp/inspector/get-document-chunk-tc12.json',
      responseSummary: 'getDocumentChunk returns chunk text matching citation snapshot',
      testCaseId: 'TC-12',
      tool: 'getDocumentChunk',
    },
    {
      contractDrift: false,
      contractSnapshotPointer: 'stub://mcp/contract/list-categories.json',
      expectedDecisionPath: 'direct',
      httpStatus: 200,
      inspectorLogPointer: 'stub://mcp/inspector/list-categories-tc19.json',
      responseSummary: 'listCategories returns active + current counts per category',
      testCaseId: 'TC-19',
      tool: 'listCategories',
    },
  ]
}

export function runA07McpContractExporter(input: A07ExporterInput = {}): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error('A07 exporter requires at least one MCP tool sample to emit a record')
  }

  const seenTools = new Set<A07McpToolName>()

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const registryEntry = getAcceptanceRegistryEntry(sample.testCaseId)

    if (!registryEntry) {
      throw new Error(`Unknown test case registry id for A07: ${sample.testCaseId}`)
    }

    seenTools.add(sample.tool)

    const isStubbed =
      sample.inspectorLogPointer.startsWith('stub://') ||
      sample.contractSnapshotPointer.startsWith('stub://')
    const passed = !sample.contractDrift
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (sample.contractDrift) {
      notesParts.push(`contract snapshot drift detected on tool=${sample.tool}`)
    }

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed inspector/contract snapshot — rerun MCP Inspector and diff against stored contract for real evidence.',
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'mcp',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: sample.expectedDecisionPath,
      environment: context.runtimeConfig.environment,
      evidenceRefs: [
        {
          description: `MCP Inspector log for ${sample.tool} (${sample.testCaseId})`,
          kind: 'mcp-inspector-log' as const,
          pointer: sample.inspectorLogPointer,
        },
        {
          description: `Contract snapshot for ${sample.tool} response shape`,
          kind: 'contract-snapshot' as const,
          pointer: sample.contractSnapshotPointer,
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

export const A07_REQUIRED_TOOLS: readonly A07McpToolName[] = [
  'searchKnowledge',
  'askKnowledge',
  'getDocumentChunk',
  'listCategories',
] as const

export function listMissingMcpTools(samples: A07McpToolSample[]): A07McpToolName[] {
  const seen = new Set(samples.map((sample) => sample.tool))

  return A07_REQUIRED_TOOLS.filter((tool) => !seen.has(tool))
}
