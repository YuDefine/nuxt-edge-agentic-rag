import { runA01DeploySmokeExporter } from './a01-deploy-smoke'
import { runA02AiSearchOrchestrationExporter } from './a02-ai-search-orchestration'
import { runA03CitationReplayExporter } from './a03-citation-replay'
import { runA04CurrentVersionOnlyExporter } from './a04-current-version-only'
import { runA05SelfCorrectionExporter } from './a05-self-correction'
import { runA06RefusalAccuracyExporter } from './a06-refusal-accuracy'
import { runA07McpContractExporter } from './a07-mcp-contract'
import { runA08OauthAllowlistExporter } from './a08-oauth-allowlist'
import { runA09RestrictedScopeExporter } from './a09-restricted-scope'
import { runA10AdminWebMcpIsolationExporter } from './a10-admin-web-mcp-isolation'
import { runA11PersistenceAuditExporter } from './a11-persistence-audit'
import { runA12McpNoInternalDiagnosticsExporter } from './a12-mcp-no-internal-diagnostics'
import { runA13RateLimitRetentionExporter } from './a13-rate-limit-retention'
import { runEv01CoreLoopExporter } from './ev01-core-loop'
import { runEv02OauthAllowlistExporter } from './ev02-oauth-allowlist'
import { runEv03PublishCutoverExporter } from './ev03-publish-cutover'
import { runEv04RateLimitCleanupExporter } from './ev04-rate-limit-cleanup'
import { runEvUi01StateCoverageExporter } from './ev-ui-01-state-coverage'
import {
  resolveEvidenceOutputPath,
  writeEvidenceJson,
  type EvidenceExporterOptions,
} from './shared'
import { buildEvidenceSummaryTables, type EvidenceSummaryTable } from './summary-tables'

/**
 * CLI entry: run A01–A13 evidence exporters and write them to
 * `evidence/<reportVersion>/<acceptanceId>.json`.
 *
 * Intended for local validation; production / local runs should inject
 * live observations via the individual exporter APIs rather than calling
 * this runner directly.
 */

export interface RunAllEvidenceExportersOptions extends EvidenceExporterOptions {
  write?: boolean
}

export function runAllEvidenceExporters(options: RunAllEvidenceExportersOptions = {}) {
  const exports = [
    runA01DeploySmokeExporter(options),
    runA02AiSearchOrchestrationExporter(options),
    runA03CitationReplayExporter(options),
    runA04CurrentVersionOnlyExporter(options),
    runA05SelfCorrectionExporter(options),
    runA06RefusalAccuracyExporter(options),
    runA07McpContractExporter(options),
    runA08OauthAllowlistExporter(options),
    runA09RestrictedScopeExporter(options),
    runA10AdminWebMcpIsolationExporter(options),
    runA11PersistenceAuditExporter(options),
    runA12McpNoInternalDiagnosticsExporter(options),
    runA13RateLimitRetentionExporter(options),
  ]

  if (options.write !== false) {
    for (const payload of exports) {
      const target = resolveEvidenceOutputPath(
        {
          directory: 'acceptance',
          filename: `${payload.acceptanceId}.json`,
        },
        payload.reportVersion
      )

      writeEvidenceJson(target, payload)
    }
  }

  return exports
}

export function runAllEvExporters(options: RunAllEvidenceExportersOptions = {}) {
  const exports = [
    runEv01CoreLoopExporter(options),
    runEv02OauthAllowlistExporter(options),
    runEv03PublishCutoverExporter(options),
    runEv04RateLimitCleanupExporter(options),
    runEvUi01StateCoverageExporter(options),
  ]

  if (options.write !== false) {
    for (const payload of exports) {
      const target = resolveEvidenceOutputPath(
        {
          directory: 'evidence',
          filename: `${payload.acceptanceId}.json`,
        },
        payload.reportVersion
      )

      writeEvidenceJson(target, payload)
    }
  }

  return exports
}

export function runFullEvidenceSummary(
  options: RunAllEvidenceExportersOptions = {}
): EvidenceSummaryTable[] {
  const acceptanceExports = runAllEvidenceExporters({ ...options, write: false })
  const evExports = runAllEvExporters({ ...options, write: false })
  const tables = buildEvidenceSummaryTables([...acceptanceExports, ...evExports])

  if (options.write !== false) {
    for (const table of tables) {
      const target = resolveEvidenceOutputPath(
        {
          directory: 'summary',
          filename: `${table.chapterRef}.json`,
        },
        table.reportVersion
      )

      writeEvidenceJson(target, table)
    }
  }

  return tables
}

const entryUrl = typeof import.meta !== 'undefined' ? import.meta.url : ''
const invokedDirectly =
  entryUrl !== '' &&
  typeof process !== 'undefined' &&
  process.argv[1] === new URL(entryUrl).pathname

if (invokedDirectly) {
  runAllEvidenceExporters({ write: true })
  runAllEvExporters({ write: true })
  runFullEvidenceSummary({ write: true })
}
