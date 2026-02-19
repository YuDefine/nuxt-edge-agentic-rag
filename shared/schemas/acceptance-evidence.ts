import { z } from 'zod'

import {
  KNOWLEDGE_CHANNEL_VALUES,
  KNOWLEDGE_ENVIRONMENT_VALUES,
} from '#shared/schemas/knowledge-runtime'

/**
 * Acceptance evidence record — structured output emitted by the evidence
 * exporters that feeds the report backfill process.
 *
 * Spec: openspec/changes/test-coverage-and-automation/specs/acceptance-evidence-automation/spec.md
 *   "Each emitted record SHALL include config_snapshot_version, execution
 *    status, channel, and references to the stored evidence payloads"
 *
 * Required fields mirror the `Acceptance summary includes config snapshot
 * version` scenario plus room for deploy / replay / orchestration payload
 * pointers referenced by other scenarios.
 */

export const ACCEPTANCE_EVIDENCE_STATUS_VALUES = [
  'passed',
  'failed',
  'skipped',
  'pending-production-run',
] as const

export type AcceptanceEvidenceStatus = (typeof ACCEPTANCE_EVIDENCE_STATUS_VALUES)[number]

export const acceptanceEvidencePayloadRefSchema = z.object({
  description: z.string().min(1),
  kind: z.enum([
    'deploy-metadata',
    'smoke-response',
    'ai-search-request',
    'ai-search-response',
    'orchestration-log',
    'orchestration-log-correction',
    'citation-record',
    'source-chunk',
    'replay-response',
    'query-log',
    'json-file',
    'version-era-snapshot',
    'refusal-case-matrix',
    'contract-snapshot',
    'mcp-inspector-log',
    'oauth-session-snapshot',
    'allowlist-state',
    'scope-decision',
    'redacted-query-log',
    'access-matrix',
    'persistence-audit',
    'rate-limit-state',
    'retention-cleanup-report',
  ]),
  pointer: z.string().min(1),
})

export type AcceptanceEvidencePayloadRef = z.infer<typeof acceptanceEvidencePayloadRefSchema>

export const acceptanceEvidenceRecordSchema = z.object({
  acceptanceId: z.string().min(1),
  channel: z.enum([...KNOWLEDGE_CHANNEL_VALUES, 'shared']),
  configSnapshotVersion: z.string().min(1),
  decisionPath: z.string().min(1).nullable(),
  environment: z.enum(KNOWLEDGE_ENVIRONMENT_VALUES),
  evidenceRefs: z.array(acceptanceEvidencePayloadRefSchema),
  generatedAt: z.string().datetime(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  notes: z.string().optional(),
  reportVersion: z.string().min(1),
  status: z.enum(ACCEPTANCE_EVIDENCE_STATUS_VALUES),
  testCaseId: z.string().min(1).nullable(),
})

export type AcceptanceEvidenceRecord = z.infer<typeof acceptanceEvidenceRecordSchema>

export const acceptanceEvidenceExportSchema = z.object({
  acceptanceId: z.string().min(1),
  generatedAt: z.string().datetime(),
  records: z.array(acceptanceEvidenceRecordSchema).min(1),
  reportVersion: z.string().min(1),
})

export type AcceptanceEvidenceExport = z.infer<typeof acceptanceEvidenceExportSchema>

export function parseAcceptanceEvidenceExport(input: unknown): AcceptanceEvidenceExport {
  return acceptanceEvidenceExportSchema.parse(input)
}
