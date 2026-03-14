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
 * A11: 高風險原文不落地稽核輸出 (TC-09, TC-15).
 *
 * 針對高風險/敏感查詢檢查三個持久化表，確保**原文 sensitive token
 * 不落入任何欄位**：
 *   - `query_logs.query_text`        — 只能存遮罩版本
 *   - `citation_records.chunk_text_snapshot` — 若為 refused，應
 *     該完全沒有 citation_records 寫入；若寫入則不得含 sensitive token
 *   - `messages.content_text`        — 拒答回覆亦不可原文儲存
 *
 * 每個 sample 記錄三個 table 的實際持久化樣本（透過 pointer）與
 * 偵測到的 sensitive token 漏洞。Drift 定義：三個欄位任一者包含
 * `sensitiveTokens` 中任何字串，或 refused 案例仍寫入 citation_records。
 */

const ACCEPTANCE_ID = 'A11'

export type A11PersistenceField = 'query_logs' | 'citation_records' | 'messages'

export interface A11FieldAudit {
  containsSensitiveToken: boolean
  detectedTokens: string[]
  persistedSnapshot: string
  pointer: string
  table: A11PersistenceField
  wasWritten: boolean
}

export interface A11PersistenceSample {
  citationRecords: A11FieldAudit
  expectedRefused: boolean
  httpStatus: number
  messagesContent: A11FieldAudit
  queryLog: A11FieldAudit
  sensitiveTokens: string[]
  testCaseId: string
}

export interface A11ExporterInput extends EvidenceExporterOptions {
  samples?: A11PersistenceSample[]
}

function buildDefaultSamples(): A11PersistenceSample[] {
  return [
    {
      citationRecords: {
        containsSensitiveToken: false,
        detectedTokens: [],
        persistedSnapshot: '',
        pointer: 'stub://citation-records/tc09-empty.json',
        table: 'citation_records',
        wasWritten: false,
      },
      expectedRefused: true,
      httpStatus: 200,
      messagesContent: {
        containsSensitiveToken: false,
        detectedTokens: [],
        persistedSnapshot: '<redacted: refusal acknowledgement>',
        pointer: 'stub://messages/tc09-content.json',
        table: 'messages',
        wasWritten: true,
      },
      queryLog: {
        containsSensitiveToken: false,
        detectedTokens: [],
        persistedSnapshot: '<redacted: high-risk sensitive input>',
        pointer: 'stub://query-logs/tc09.json',
        table: 'query_logs',
        wasWritten: true,
      },
      sensitiveTokens: ['SENSITIVE_TOKEN_A', 'SENSITIVE_TOKEN_B'],
      testCaseId: 'TC-09',
    },
    {
      citationRecords: {
        containsSensitiveToken: false,
        detectedTokens: [],
        persistedSnapshot: '',
        pointer: 'stub://citation-records/tc15-empty.json',
        table: 'citation_records',
        wasWritten: false,
      },
      expectedRefused: true,
      httpStatus: 200,
      messagesContent: {
        containsSensitiveToken: false,
        detectedTokens: [],
        persistedSnapshot: '<redacted: refusal acknowledgement>',
        pointer: 'stub://messages/tc15-content.json',
        table: 'messages',
        wasWritten: true,
      },
      queryLog: {
        containsSensitiveToken: false,
        detectedTokens: [],
        persistedSnapshot: '<redacted: high-risk sensitive input>',
        pointer: 'stub://query-logs/tc15.json',
        table: 'query_logs',
        wasWritten: true,
      },
      sensitiveTokens: ['PII_TOKEN_X', 'PII_TOKEN_Y'],
      testCaseId: 'TC-15',
    },
  ]
}

interface PersistenceComparison {
  citationRecordsLeak: boolean
  citationRecordsWrittenOnRefused: boolean
  messagesLeak: boolean
  queryLogLeak: boolean
}

function comparePersistenceSample(sample: A11PersistenceSample): PersistenceComparison {
  const queryLogLeak =
    sample.queryLog.containsSensitiveToken || sample.queryLog.detectedTokens.length > 0
  const citationRecordsLeak =
    sample.citationRecords.containsSensitiveToken ||
    sample.citationRecords.detectedTokens.length > 0
  const messagesLeak =
    sample.messagesContent.containsSensitiveToken ||
    sample.messagesContent.detectedTokens.length > 0
  // 拒答情境不可寫入 citation_records（否則洩漏了引用的證據）
  const citationRecordsWrittenOnRefused =
    sample.expectedRefused && sample.citationRecords.wasWritten

  return {
    citationRecordsLeak,
    citationRecordsWrittenOnRefused,
    messagesLeak,
    queryLogLeak,
  }
}

export function runA11PersistenceAuditExporter(
  input: A11ExporterInput = {},
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error('A11 exporter requires at least one persistence sample to emit a record')
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const registryEntry = getAcceptanceRegistryEntry(sample.testCaseId)

    if (!registryEntry) {
      throw new Error(`Unknown test case registry id for A11: ${sample.testCaseId}`)
    }

    const isStubbed =
      sample.queryLog.pointer.startsWith('stub://') ||
      sample.citationRecords.pointer.startsWith('stub://') ||
      sample.messagesContent.pointer.startsWith('stub://')
    const comparison = comparePersistenceSample(sample)
    const passed =
      !comparison.queryLogLeak &&
      !comparison.citationRecordsLeak &&
      !comparison.messagesLeak &&
      !comparison.citationRecordsWrittenOnRefused
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (comparison.queryLogLeak) {
      notesParts.push(
        `query_logs.query_text leaked sensitive tokens: ${sample.queryLog.detectedTokens.join(', ')}`,
      )
    }

    if (comparison.citationRecordsLeak) {
      notesParts.push(
        `citation_records.chunk_text_snapshot leaked sensitive tokens: ${sample.citationRecords.detectedTokens.join(', ')}`,
      )
    }

    if (comparison.messagesLeak) {
      notesParts.push(
        `messages.content_text leaked sensitive tokens: ${sample.messagesContent.detectedTokens.join(', ')}`,
      )
    }

    if (comparison.citationRecordsWrittenOnRefused) {
      notesParts.push(
        'citation_records row was written for a refused high-risk query — expected zero rows',
      )
    }

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed persistence audit pointers — rerun TC-09/15 against live D1 and diff query_logs / citation_records / messages rows against redaction policy.',
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'web',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: 'persistence-redaction',
      environment: context.runtimeConfig.environment,
      evidenceRefs: [
        {
          description: `persistence audit (tc=${sample.testCaseId}, table=query_logs, leak=${comparison.queryLogLeak})`,
          kind: 'persistence-audit' as const,
          pointer: sample.queryLog.pointer,
        },
        {
          description: `persistence audit (tc=${sample.testCaseId}, table=citation_records, written=${sample.citationRecords.wasWritten}, leak=${comparison.citationRecordsLeak})`,
          kind: 'persistence-audit' as const,
          pointer: sample.citationRecords.pointer,
        },
        {
          description: `persistence audit (tc=${sample.testCaseId}, table=messages, leak=${comparison.messagesLeak})`,
          kind: 'persistence-audit' as const,
          pointer: sample.messagesContent.pointer,
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
