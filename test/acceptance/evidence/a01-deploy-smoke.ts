import type {
  AcceptanceEvidenceExport,
  AcceptanceEvidenceRecord,
} from '#shared/schemas/acceptance-evidence'

import { getAcceptanceRegistryEntry } from '../registry/manifest'
import {
  createEvidenceExport,
  createEvidenceExporterContext,
  type EvidenceExporterContext,
  type EvidenceExporterOptions,
} from './shared'

/**
 * A01: Deployment success verification.
 *
 * Produces an evidence record per probed channel summarising:
 *   - deploy metadata (git SHA, branch, environment identifier)
 *   - smoke test response (status + body pointer)
 *   - config snapshot version tying the evidence to the governance surface
 *
 * Real local / production runs should inject:
 *   - `deploy` from the Cloudflare deploy response
 *   - `smokeResults` from actual `fetch('/api/health'|'/mcp')` calls
 *
 * Locally we fall back to environment variables + stub responses so the
 * wiring, schema, and config_snapshot_version binding stay exercised.
 */

const ACCEPTANCE_ID = 'A01'

export interface DeployMetadata {
  branch: string | null
  buildId: string
  commitSha: string
  deployedAt: string
  environment: string
  region: string | null
  workerName: string
}

export interface DeploySmokeResult {
  channel: 'web' | 'mcp'
  endpoint: string
  httpStatus: number
  responseBodyPointer: string
  responseTimeMs: number | null
  succeeded: boolean
}

export interface A01ExporterInput extends EvidenceExporterOptions {
  deploy?: DeployMetadata
  smokeResults?: DeploySmokeResult[]
}

export function resolveDefaultDeployMetadata(context: EvidenceExporterContext): DeployMetadata {
  const commitSha =
    process.env.COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? 'pending-production-run'
  const branch = process.env.GIT_BRANCH ?? process.env.CF_PAGES_BRANCH ?? null

  return {
    branch,
    buildId: process.env.CF_WORKER_BUILD_ID ?? 'local-build',
    commitSha,
    deployedAt: context.generatedAt,
    environment: context.runtimeConfig.environment,
    region: process.env.CF_REGION ?? null,
    workerName: process.env.CF_WORKER_NAME ?? 'nuxt-edge-agentic-rag',
  }
}

function defaultSmokeResults(deploy: DeployMetadata): DeploySmokeResult[] {
  return [
    {
      channel: 'web',
      endpoint: '/api/chat',
      httpStatus: 200,
      responseBodyPointer: `stub://local/${deploy.environment}/web-smoke-response.json`,
      responseTimeMs: null,
      succeeded: true,
    },
    {
      channel: 'mcp',
      endpoint: '/mcp',
      httpStatus: 200,
      responseBodyPointer: `stub://local/${deploy.environment}/mcp-smoke-response.json`,
      responseTimeMs: null,
      succeeded: true,
    },
  ]
}

export function runA01DeploySmokeExporter(input: A01ExporterInput = {}): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const deploy = input.deploy ?? resolveDefaultDeployMetadata(context)
  const smokeResults = input.smokeResults ?? defaultSmokeResults(deploy)

  const registryEntry = getAcceptanceRegistryEntry(ACCEPTANCE_ID)

  if (!registryEntry) {
    throw new Error(`Registry entry not found for ${ACCEPTANCE_ID}`)
  }

  const records: AcceptanceEvidenceRecord[] = smokeResults.map((smoke) => {
    const allPassed = smoke.succeeded && smoke.httpStatus >= 200 && smoke.httpStatus < 300
    const isStubbed =
      smoke.responseBodyPointer.startsWith('stub://') ||
      deploy.commitSha === 'pending-production-run'

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: smoke.channel,
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: 'deploy-smoke',
      environment: context.runtimeConfig.environment,
      evidenceRefs: [
        {
          description: `Cloudflare Worker deploy metadata (${deploy.workerName}@${deploy.commitSha})`,
          kind: 'deploy-metadata',
          pointer: `git:${deploy.commitSha}`,
        },
        {
          description: `Smoke ${smoke.channel.toUpperCase()} ${smoke.endpoint} → ${smoke.httpStatus}`,
          kind: 'smoke-response',
          pointer: smoke.responseBodyPointer,
        },
      ],
      generatedAt: context.generatedAt,
      httpStatus: smoke.httpStatus,
      notes: isStubbed
        ? 'Stubbed smoke response — re-run against local/production to capture real payload.'
        : undefined,
      reportVersion: context.reportVersion,
      status: allPassed ? (isStubbed ? 'pending-production-run' : 'passed') : 'failed',
      testCaseId: null,
    }
  })

  return createEvidenceExport(ACCEPTANCE_ID, records, context)
}
