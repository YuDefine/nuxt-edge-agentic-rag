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
 * A03: Citation replay verification.
 *
 * For each sampled citation, compares three surfaces:
 *   1. source_chunks.chunk_text  (canonical)
 *   2. citation_records.chunk_text_snapshot (captured at answer time)
 *   3. getDocumentChunk replay response (served by MCP replay chain)
 *
 * The exporter records:
 *   - consistency result per sample
 *   - citationId / documentVersionId / sourceChunkId pointers
 *   - config_snapshot_version tying the evidence to the governance surface
 *
 * Real runs should inject samples pulled from the D1 `citation_records`
 * table and cross-check against the actual `/api/mcp/chunks/[citationId]`
 * response. The stub default mirrors the TC-12 replay scenario so the
 * schema and wiring are exercised without requiring vitest mocks.
 */

const ACCEPTANCE_ID = 'A03'

export interface A03CitationReplaySample {
  citationId: string
  citationSnapshotText: string
  documentVersionId: string
  httpStatus: number
  replayResponseText: string
  replaySourcePointer: string
  sourceChunkId: string
  sourceChunkText: string
  testCaseId: string
}

export interface A03ExporterInput extends EvidenceExporterOptions {
  samples?: A03CitationReplaySample[]
}

function buildDefaultSamples(): A03CitationReplaySample[] {
  const snapshot = 'PR 是請購需求，PO 是核准後建立的採購訂單，兩者於流程中職責不同。'

  return [
    {
      citationId: 'cit-procurement-tc12',
      citationSnapshotText: snapshot,
      documentVersionId: 'ver-procurement-current-tc12',
      httpStatus: 200,
      replayResponseText: snapshot,
      replaySourcePointer: 'stub://mcp/chunks/cit-procurement-tc12.json',
      sourceChunkId: 'chunk-procurement-tc12',
      sourceChunkText: snapshot,
      testCaseId: 'TC-12',
    },
  ]
}

interface ReplayComparison {
  chunkSnapshotMatches: boolean
  consistent: boolean
  replayMatchesSnapshot: boolean
}

function compareReplaySample(sample: A03CitationReplaySample): ReplayComparison {
  const chunkSnapshotMatches = sample.sourceChunkText === sample.citationSnapshotText
  const replayMatchesSnapshot = sample.citationSnapshotText === sample.replayResponseText

  return {
    chunkSnapshotMatches,
    consistent: chunkSnapshotMatches && replayMatchesSnapshot,
    replayMatchesSnapshot,
  }
}

export function runA03CitationReplayExporter(
  input: A03ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error('A03 exporter requires at least one citation sample to emit a record')
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const registryEntry = getAcceptanceRegistryEntry(sample.testCaseId)

    if (!registryEntry) {
      throw new Error(`Unknown test case registry id for A03: ${sample.testCaseId}`)
    }

    const isStubbed = sample.replaySourcePointer.startsWith('stub://')
    const comparison = compareReplaySample(sample)
    const status: AcceptanceEvidenceRecord['status'] = comparison.consistent
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (!comparison.chunkSnapshotMatches) {
      notesParts.push('source_chunks.chunk_text and citation_records.chunk_text_snapshot diverge')
    }

    if (!comparison.replayMatchesSnapshot) {
      notesParts.push('getDocumentChunk replay text does not match citation snapshot')
    }

    if (isStubbed && comparison.consistent) {
      notesParts.push('Stubbed replay payload — rerun replay against live D1 to capture real text.')
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'mcp',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: comparison.consistent ? 'replay-consistent' : 'replay-drift',
      environment: context.runtimeConfig.environment as 'local' | 'staging' | 'production',
      evidenceRefs: [
        {
          description: `source_chunks row (${sample.sourceChunkId})`,
          kind: 'source-chunk',
          pointer: `source_chunks:${sample.sourceChunkId}`,
        },
        {
          description: `citation_records row (${sample.citationId}) → document_versions:${sample.documentVersionId}`,
          kind: 'citation-record',
          pointer: `citation_records:${sample.citationId}`,
        },
        {
          description: `getDocumentChunk replay response (http=${sample.httpStatus})`,
          kind: 'replay-response',
          pointer: sample.replaySourcePointer,
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
