import type {
  AcceptanceEvidenceExport,
  AcceptanceEvidenceRecord,
  AcceptanceEvidenceStatus,
} from '#shared/schemas/acceptance-evidence'

import { getAcceptanceRegistryEntry } from '../registry/manifest'

/**
 * Evidence summary tables for report Chapter 3 / Chapter 4 backfill.
 *
 * Chapter 3 needs per-evidence rows that prove the ambient system
 * behaves as claimed (EV-01 core loop, EV-02 OAuth, EV-03 publish
 * pipeline, EV-04 rate-limit / retention). Chapter 4 needs per-TC rows
 * linked back to the acceptance IDs (A01–A13). This module produces
 * both in one pass so the report can embed stable, versioned summary
 * tables that always include `config_snapshot_version`.
 */

export type EvidenceSummaryChapter = 'chapter-3' | 'chapter-4'

export interface EvidenceSummaryRow {
  acceptanceId: string
  channel: 'mcp' | 'web' | 'shared'
  configSnapshotVersion: string
  decisionPath: string | null
  environment: AcceptanceEvidenceRecord['environment']
  evidenceRefCount: number
  httpStatus: number | null
  notes: string | undefined
  reportSections: string[]
  status: AcceptanceEvidenceStatus
  testCaseId: string | null
}

export interface EvidenceSummaryTable {
  chapterRef: EvidenceSummaryChapter
  description: string
  reportVersion: string
  rows: EvidenceSummaryRow[]
  title: string
}

const EV_IDS = new Set(['EV-01', 'EV-02', 'EV-03', 'EV-04', 'EV-UI-01'])

function toSummaryRow(record: AcceptanceEvidenceRecord): EvidenceSummaryRow {
  const registryEntry = getAcceptanceRegistryEntry(record.acceptanceId)
  const reportSections = registryEntry?.reportSections ?? []

  return {
    acceptanceId: record.acceptanceId,
    channel: record.channel,
    configSnapshotVersion: record.configSnapshotVersion,
    decisionPath: record.decisionPath,
    environment: record.environment,
    evidenceRefCount: record.evidenceRefs.length,
    httpStatus: record.httpStatus,
    notes: record.notes,
    reportSections,
    status: record.status,
    testCaseId: record.testCaseId,
  }
}

export function buildEvidenceSummaryTables(
  exports: AcceptanceEvidenceExport[]
): EvidenceSummaryTable[] {
  if (exports.length === 0) {
    return []
  }

  const reportVersion = exports[0].reportVersion
  const chapter3Rows: EvidenceSummaryRow[] = []
  const chapter4Rows: EvidenceSummaryRow[] = []

  for (const payload of exports) {
    const isEvidence = EV_IDS.has(payload.acceptanceId)

    for (const record of payload.records) {
      const row = toSummaryRow(record)

      if (isEvidence) {
        chapter3Rows.push(row)
      } else {
        chapter4Rows.push(row)
      }
    }
  }

  const tables: EvidenceSummaryTable[] = []

  if (chapter3Rows.length > 0) {
    tables.push({
      chapterRef: 'chapter-3',
      description:
        'Chapter 3 evidence ledger — EV-01 core loop, EV-02 OAuth/allowlist, EV-03 publish pipeline, EV-04 rate-limit / retention. Every row carries config_snapshot_version.',
      reportVersion,
      rows: chapter3Rows,
      title: 'EV 證據摘要（第三章補充證據項目）',
    })
  }

  if (chapter4Rows.length > 0) {
    tables.push({
      chapterRef: 'chapter-4',
      description:
        'Chapter 4 acceptance ledger — A01 through A13 with their linked TC and decision paths. Every row carries config_snapshot_version.',
      reportVersion,
      rows: chapter4Rows,
      title: '驗收對照摘要（第四章 4.1.1）',
    })
  }

  return tables
}

export function summaryTablesIncludeConfigSnapshotVersion(tables: EvidenceSummaryTable[]): boolean {
  if (tables.length === 0) {
    return false
  }

  return tables.every(
    (table) =>
      table.rows.length > 0 &&
      table.rows.every(
        (row) =>
          typeof row.configSnapshotVersion === 'string' && row.configSnapshotVersion.length > 0
      )
  )
}
