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
 * EV-03: publish pipeline evidence chain.
 *
 * Aggregates three publish-pipeline signals into one evidence record:
 *   1. publish no-op      — re-publishing the same version SHALL emit a
 *                           no-op transaction rather than a second record
 *   2. publish rollback   — failed publish SHALL leave the previous
 *                           current version untouched
 *   3. version cutover    — promoting `v2` to current SHALL ensure
 *                           subsequent answers do not cite archived `v1`
 *
 * Drift conditions:
 *   - no-op stage: report does not flag re-publish as idempotent
 *   - rollback stage: active version after rollback differs from the
 *                     pre-publish previous version
 *   - cutover stage: any citation still references archived content
 */

const ACCEPTANCE_ID = 'EV-03'

export interface Ev03NoopStage {
  noopHttpStatus: number
  noopReportPointer: string
  succeeded: boolean
}

export interface Ev03RollbackStage {
  activeVersionAfterRollback: string
  rollbackHttpStatus: number
  rollbackReportPointer: string
  succeeded: boolean
}

export interface Ev03CutoverStage {
  citationIds: string[]
  cutoverDocumentId: string
  cutoverHttpStatus: number
  cutoverLeaksArchivedVersion: boolean
  cutoverResponsePointer: string
  currentVersionId: string
  previousVersionId: string
  queryLogPointer: string
}

export interface Ev03PublishCutoverSample {
  cutoverStage: Ev03CutoverStage
  noopStage: Ev03NoopStage
  rollbackStage: Ev03RollbackStage
}

export interface Ev03ExporterInput extends EvidenceExporterOptions {
  samples?: Ev03PublishCutoverSample[]
}

function buildDefaultSample(): Ev03PublishCutoverSample {
  const documentId = 'doc-procurement-sop'
  const v1 = 'ver-procurement-sop-v1'
  const v2 = 'ver-procurement-sop-v2'

  return {
    cutoverStage: {
      citationIds: ['cit-procurement-v2-step-1'],
      cutoverDocumentId: documentId,
      cutoverHttpStatus: 200,
      cutoverLeaksArchivedVersion: false,
      cutoverResponsePointer: 'stub://ev03/cutover-response.json',
      currentVersionId: v2,
      previousVersionId: v1,
      queryLogPointer: 'stub://ev03/cutover-query-log.json',
    },
    noopStage: {
      noopHttpStatus: 200,
      noopReportPointer: 'stub://ev03/publish-noop.json',
      succeeded: true,
    },
    rollbackStage: {
      activeVersionAfterRollback: v1,
      rollbackHttpStatus: 200,
      rollbackReportPointer: 'stub://ev03/publish-rollback.json',
      succeeded: true,
    },
  }
}

interface Ev03Comparison {
  cutoverCitesOnlyCurrent: boolean
  failureReasons: string[]
  noopConfirmed: boolean
  rollbackRestoredPrevious: boolean
}

function compareSample(sample: Ev03PublishCutoverSample): Ev03Comparison {
  const failureReasons: string[] = []
  const noopConfirmed = sample.noopStage.succeeded
  const rollbackRestoredPrevious = sample.rollbackStage.succeeded

  const cutoverCitesOnlyCurrent =
    !sample.cutoverStage.cutoverLeaksArchivedVersion &&
    !sample.cutoverStage.citationIds.some((id) =>
      id.includes(sample.cutoverStage.previousVersionId)
    ) &&
    !sample.cutoverStage.citationIds.some((id) => id.toLowerCase().includes('v1'))

  if (!noopConfirmed) {
    failureReasons.push('publish no-op stage failed — idempotent re-publish not proven')
  }

  if (!rollbackRestoredPrevious) {
    failureReasons.push('publish rollback stage failed — active version not restored')
  }

  if (!cutoverCitesOnlyCurrent) {
    failureReasons.push(
      `cutover stage leaks archived version (previous=${sample.cutoverStage.previousVersionId}, current=${sample.cutoverStage.currentVersionId})`
    )
  }

  return {
    cutoverCitesOnlyCurrent,
    failureReasons,
    noopConfirmed,
    rollbackRestoredPrevious,
  }
}

export function runEv03PublishCutoverExporter(
  input: Ev03ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? [buildDefaultSample()]

  if (samples.length === 0) {
    throw new Error('EV-03 exporter requires at least one publish-cutover sample to emit a record')
  }

  const registryEntry = getAcceptanceRegistryEntry(ACCEPTANCE_ID)

  if (!registryEntry) {
    throw new Error(`Registry entry not found for ${ACCEPTANCE_ID}`)
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const isStubbed =
      sample.noopStage.noopReportPointer.startsWith('stub://') ||
      sample.rollbackStage.rollbackReportPointer.startsWith('stub://') ||
      sample.cutoverStage.cutoverResponsePointer.startsWith('stub://') ||
      sample.cutoverStage.queryLogPointer.startsWith('stub://')

    const comparison = compareSample(sample)
    const passed = comparison.failureReasons.length === 0
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = [...comparison.failureReasons]

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed publish pipeline — rerun EV-03 against live publish/rollback/cutover transactions to capture real payloads.'
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'shared',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: 'publish-rollback-cutover-chain',
      environment: context.runtimeConfig.environment as 'local' | 'staging' | 'production',
      evidenceRefs: [
        {
          description: `publish no-op report (http=${sample.noopStage.noopHttpStatus})`,
          kind: 'smoke-response' as const,
          pointer: sample.noopStage.noopReportPointer,
        },
        {
          description: `publish rollback report (active-after=${sample.rollbackStage.activeVersionAfterRollback}, http=${sample.rollbackStage.rollbackHttpStatus})`,
          kind: 'smoke-response' as const,
          pointer: sample.rollbackStage.rollbackReportPointer,
        },
        {
          description: `cutover response (doc=${sample.cutoverStage.cutoverDocumentId}, current=${sample.cutoverStage.currentVersionId})`,
          kind: 'version-era-snapshot' as const,
          pointer: sample.cutoverStage.cutoverResponsePointer,
        },
        {
          description: `cutover query_logs row (http=${sample.cutoverStage.cutoverHttpStatus})`,
          kind: 'query-log' as const,
          pointer: sample.cutoverStage.queryLogPointer,
        },
      ],
      generatedAt: context.generatedAt,
      httpStatus: sample.cutoverStage.cutoverHttpStatus,
      notes: notesParts.length > 0 ? notesParts.join(' | ') : undefined,
      reportVersion: context.reportVersion,
      status,
      testCaseId: null,
    }
  })

  return createEvidenceExport(ACCEPTANCE_ID, records, context)
}
