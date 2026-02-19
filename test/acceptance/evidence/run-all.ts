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
import {
  resolveEvidenceOutputPath,
  writeEvidenceJson,
  type EvidenceExporterOptions,
} from './shared'

/**
 * CLI entry: run A01–A13 evidence exporters and write them to
 * `evidence/<reportVersion>/<acceptanceId>.json`.
 *
 * Intended for local validation; production / staging runs should inject
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

const entryUrl = typeof import.meta !== 'undefined' ? import.meta.url : ''
const invokedDirectly =
  entryUrl !== '' &&
  typeof process !== 'undefined' &&
  process.argv[1] === new URL(entryUrl).pathname

if (invokedDirectly) {
  runAllEvidenceExporters({ write: true })
}
