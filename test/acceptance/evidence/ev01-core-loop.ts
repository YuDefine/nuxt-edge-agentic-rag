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
 * EV-01: 核心閉環 smoke evidence.
 *
 * Stitches the five canonical stages of a freshly deployed environment
 * into a single evidence record so the report can prove the end-to-end
 * loop is alive without cross-referencing multiple A-exporters:
 *   1. deploy — Cloudflare Worker deployment metadata (mirrors A01)
 *   2. login  — admin Google OAuth session established (mirrors A08)
 *   3. publish — a document version flipped to `current` (mirrors A04)
 *   4. ask    — `/api/chat` or MCP `askKnowledge` returns a citation
 *   5. replay — the emitted citation resolves via MCP `getDocumentChunk`
 *
 * Stage failures are surfaced via `notes` and flip the record to
 * `failed`; when all stages succeed and any pointer is still stubbed,
 * the record stays in `pending-production-run` so the reporter knows
 * to rerun against a live environment before backfilling.
 */

const ACCEPTANCE_ID = 'EV-01'

export interface Ev01DeployStage {
  commitSha: string
  environment: string
  metadataPointer: string
  succeeded: boolean
  workerName: string
}

export interface Ev01LoginStage {
  oauthSessionPointer: string
  role: 'admin' | 'user'
  succeeded: boolean
  userEmail: string
}

export interface Ev01PublishStage {
  documentId: string
  httpStatus: number
  publishLogPointer: string
  succeeded: boolean
  versionId: string
}

export interface Ev01AskStage {
  answerSummary: string | null
  citationIds: string[]
  decisionPath: 'direct' | 'judge_pass' | 'self_corrected' | 'refused'
  httpStatus: number
  queryLogPointer: string
  queryText: string
  responsePointer: string
  succeeded: boolean
}

export interface Ev01ReplayStage {
  citationId: string
  httpStatus: number
  replayPointer: string
  succeeded: boolean
}

export interface Ev01CoreLoopSample {
  askStage: Ev01AskStage
  deployStage: Ev01DeployStage
  loginStage: Ev01LoginStage
  publishStage: Ev01PublishStage
  replayStage: Ev01ReplayStage
}

export interface Ev01ExporterInput extends EvidenceExporterOptions {
  samples?: Ev01CoreLoopSample[]
}

function buildDefaultSample(): Ev01CoreLoopSample {
  return {
    askStage: {
      answerSummary: 'PR 為請購需求，PO 為核准後的採購訂單。',
      citationIds: ['cit-procurement-1'],
      decisionPath: 'direct',
      httpStatus: 200,
      queryLogPointer: 'stub://ev01/ask-query-log.json',
      queryText: 'PR 和 PO 的差別是什麼？',
      responsePointer: 'stub://ev01/ask-response.json',
      succeeded: true,
    },
    deployStage: {
      commitSha: 'pending-production-run',
      environment: 'local',
      metadataPointer: 'stub://ev01/deploy-metadata.json',
      succeeded: true,
      workerName: 'nuxt-edge-agentic-rag',
    },
    loginStage: {
      oauthSessionPointer: 'stub://ev01/oauth-session.json',
      role: 'admin',
      succeeded: true,
      userEmail: 'admin@example.com',
    },
    publishStage: {
      documentId: 'doc-procurement-sop',
      httpStatus: 200,
      publishLogPointer: 'stub://ev01/publish-log.json',
      succeeded: true,
      versionId: 'ver-procurement-sop-current',
    },
    replayStage: {
      citationId: 'cit-procurement-1',
      httpStatus: 200,
      replayPointer: 'stub://ev01/replay-response.json',
      succeeded: true,
    },
  }
}

interface CoreLoopComparison {
  allStagesSucceeded: boolean
  failedStageLabels: string[]
  replayLinksAsk: boolean
}

function compareSample(sample: Ev01CoreLoopSample): CoreLoopComparison {
  const failedStageLabels: string[] = []

  if (!sample.deployStage.succeeded) {
    failedStageLabels.push('deploy stage failed')
  }

  if (!sample.loginStage.succeeded) {
    failedStageLabels.push('login stage failed')
  }

  if (!sample.publishStage.succeeded) {
    failedStageLabels.push('publish stage failed')
  }

  if (!sample.askStage.succeeded) {
    failedStageLabels.push('ask stage failed')
  }

  if (!sample.replayStage.succeeded) {
    failedStageLabels.push('replay stage failed')
  }

  const replayLinksAsk = sample.askStage.citationIds.includes(sample.replayStage.citationId)

  if (!replayLinksAsk && sample.askStage.citationIds.length > 0) {
    failedStageLabels.push('replay citation does not match ask citations')
  }

  return {
    allStagesSucceeded: failedStageLabels.length === 0,
    failedStageLabels,
    replayLinksAsk,
  }
}

export function runEv01CoreLoopExporter(input: Ev01ExporterInput = {}): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? [buildDefaultSample()]

  if (samples.length === 0) {
    throw new Error('EV-01 exporter requires at least one core-loop sample to emit a record')
  }

  const registryEntry = getAcceptanceRegistryEntry(ACCEPTANCE_ID)

  if (!registryEntry) {
    throw new Error(`Registry entry not found for ${ACCEPTANCE_ID}`)
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const isStubbed =
      sample.deployStage.metadataPointer.startsWith('stub://') ||
      sample.loginStage.oauthSessionPointer.startsWith('stub://') ||
      sample.publishStage.publishLogPointer.startsWith('stub://') ||
      sample.askStage.responsePointer.startsWith('stub://') ||
      sample.replayStage.replayPointer.startsWith('stub://')

    const comparison = compareSample(sample)
    const status: AcceptanceEvidenceRecord['status'] = comparison.allStagesSucceeded
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts = [...comparison.failedStageLabels]

    if (isStubbed && comparison.allStagesSucceeded) {
      notesParts.push(
        'Stubbed core-loop stages — rerun EV-01 against a live deploy to capture deploy / OAuth / publish / ask / replay payloads.',
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'shared',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: 'core-loop-smoke',
      environment: context.runtimeConfig.environment,
      evidenceRefs: [
        {
          description: `deploy metadata (${sample.deployStage.workerName}@${sample.deployStage.commitSha})`,
          kind: 'deploy-metadata' as const,
          pointer: sample.deployStage.metadataPointer,
        },
        {
          description: `OAuth admin session (${sample.loginStage.userEmail} role=${sample.loginStage.role})`,
          kind: 'oauth-session-snapshot' as const,
          pointer: sample.loginStage.oauthSessionPointer,
        },
        {
          description: `publish log (doc=${sample.publishStage.documentId} version=${sample.publishStage.versionId} http=${sample.publishStage.httpStatus})`,
          kind: 'smoke-response' as const,
          pointer: sample.publishStage.publishLogPointer,
        },
        {
          description: `ask query_logs row (decision=${sample.askStage.decisionPath} http=${sample.askStage.httpStatus})`,
          kind: 'query-log' as const,
          pointer: sample.askStage.queryLogPointer,
        },
        {
          description: `ask response (query="${sample.askStage.queryText}")`,
          kind: 'smoke-response' as const,
          pointer: sample.askStage.responsePointer,
        },
        {
          description: `replay response (citation=${sample.replayStage.citationId} http=${sample.replayStage.httpStatus})`,
          kind: 'replay-response' as const,
          pointer: sample.replayStage.replayPointer,
        },
      ],
      generatedAt: context.generatedAt,
      httpStatus: sample.askStage.httpStatus,
      notes: notesParts.length > 0 ? notesParts.join(' | ') : undefined,
      reportVersion: context.reportVersion,
      status,
      testCaseId: null,
    }
  })

  return createEvidenceExport(ACCEPTANCE_ID, records, context)
}
