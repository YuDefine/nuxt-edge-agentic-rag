import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  createKnowledgeRuntimeConfig,
  type KnowledgeRuntimeConfig,
  type KnowledgeRuntimeConfigInput,
} from '#shared/schemas/knowledge-runtime'
import {
  acceptanceEvidenceExportSchema,
  type AcceptanceEvidenceExport,
  type AcceptanceEvidenceRecord,
} from '#shared/schemas/acceptance-evidence'

import { acceptanceRegistryManifest } from '../registry/manifest'

export interface EvidenceExporterContext {
  generatedAt: string
  now(): string
  reportVersion: string
  runtimeConfig: KnowledgeRuntimeConfig
}

export interface EvidenceExporterOptions {
  configInput?: KnowledgeRuntimeConfigInput
  now?: () => string
  reportVersion?: string
}

export function createEvidenceExporterContext(
  options: EvidenceExporterOptions = {}
): EvidenceExporterContext {
  const now = options.now ?? (() => new Date().toISOString())
  const runtimeConfig = createKnowledgeRuntimeConfig({
    bindings: {
      aiSearchIndex: 'knowledge-index',
      d1Database: 'DB',
      documentsBucket: 'DOCUMENTS',
      rateLimitKv: 'KV',
    },
    environment: 'local',
    ...options.configInput,
  })

  return {
    generatedAt: now(),
    now,
    reportVersion: options.reportVersion ?? acceptanceRegistryManifest.reportVersion,
    runtimeConfig,
  }
}

export function createEvidenceExport(
  acceptanceId: string,
  records: AcceptanceEvidenceRecord[],
  context: EvidenceExporterContext
): AcceptanceEvidenceExport {
  return acceptanceEvidenceExportSchema.parse({
    acceptanceId,
    generatedAt: context.generatedAt,
    records,
    reportVersion: context.reportVersion,
  })
}

export interface EvidenceOutputLocation {
  directory: string
  filename: string
}

export function resolveEvidenceOutputPath(
  location: EvidenceOutputLocation,
  reportVersion: string
): string {
  return resolve(process.cwd(), 'evidence', reportVersion, location.directory, location.filename)
}

export function writeEvidenceJson(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
