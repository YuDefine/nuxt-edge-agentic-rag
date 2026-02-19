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
 * A10: Admin Web restricted 可讀 + MCP 隔離驗證輸出 (TC-14).
 *
 * 同一個 admin 使用者透過兩條通路發出同樣的 restricted 查詢：
 *   - web 側（Admin Web）登入並走 `/api/chat` 類路徑，
 *     其 `allowedAccessLevels` 含 `internal` + `restricted`，
 *     可取得 restricted citation 與 chunk 內容。
 *   - mcp 側透過 MCP token（缺 `knowledge.restricted.read` scope）
 *     呼叫 `askKnowledge`，應 refused + citations=[]，
 *     response 序列化亦不得出現 restricted 文字。
 *
 * 記錄 access matrix：(channel, role, effectiveScopes, allowedAccessLevels,
 *  citationCount, leakDetected)。Drift 定義：
 *   - mcp path 可引用 restricted citation（citation leak）
 *   - mcp path response body 內含 restricted chunk text 或 title 的字樣
 *   - web path 與 mcp path 回應的 configSnapshotVersion 不一致
 *   - web path 失去 restricted 讀取能力（被錯誤降權）
 */

const ACCEPTANCE_ID = 'A10'

export type A10Role = 'admin' | 'user'
export type A10ChannelPath = 'web-admin' | 'mcp'

export interface A10PathObservation {
  allowedAccessLevels: string[]
  channelPath: A10ChannelPath
  citationCount: number
  citesRestrictedContent: boolean
  configSnapshotVersion: string
  effectiveScopes: string[]
  httpStatus: number
  refused: boolean
  responseLeaksRestrictedContent: boolean
  responseSnapshotPointer: string
  role: A10Role
}

export interface A10IsolationSample {
  accessMatrixPointer: string
  mcpPath: A10PathObservation
  testCaseId: string
  userEmail: string
  webPath: A10PathObservation
}

export interface A10ExporterInput extends EvidenceExporterOptions {
  samples?: A10IsolationSample[]
}

function buildDefaultSamples(): A10IsolationSample[] {
  return [
    {
      accessMatrixPointer: 'stub://access-matrix/tc14.json',
      mcpPath: {
        allowedAccessLevels: ['internal'],
        channelPath: 'mcp',
        citationCount: 0,
        citesRestrictedContent: false,
        configSnapshotVersion: 'stub-snapshot',
        effectiveScopes: ['knowledge.read', 'knowledge.citation.read'],
        httpStatus: 200,
        refused: true,
        responseLeaksRestrictedContent: false,
        responseSnapshotPointer: 'stub://responses/tc14-mcp.json',
        role: 'admin',
      },
      testCaseId: 'TC-14',
      userEmail: 'admin-lead@example.com',
      webPath: {
        allowedAccessLevels: ['internal', 'restricted'],
        channelPath: 'web-admin',
        citationCount: 2,
        citesRestrictedContent: true,
        configSnapshotVersion: 'stub-snapshot',
        effectiveScopes: ['admin.read', 'knowledge.restricted.read'],
        httpStatus: 200,
        refused: false,
        responseLeaksRestrictedContent: true,
        responseSnapshotPointer: 'stub://responses/tc14-web.json',
        role: 'admin',
      },
    },
  ]
}

interface IsolationComparison {
  configSnapshotsAligned: boolean
  mcpRefusedCorrectly: boolean
  mcpResponseLeakDetected: boolean
  mcpScopeIsolated: boolean
  webCanReadRestricted: boolean
}

function compareIsolationSample(sample: A10IsolationSample): IsolationComparison {
  // web path 必須可引用 restricted chunk（citationCount > 0 且 citesRestrictedContent）
  const webCanReadRestricted =
    sample.webPath.allowedAccessLevels.includes('restricted') &&
    sample.webPath.citationCount > 0 &&
    sample.webPath.citesRestrictedContent &&
    !sample.webPath.refused

  // mcp path 必須 refused + 無 restricted citation + 無 restricted content leak
  const mcpRefusedCorrectly = sample.mcpPath.refused && sample.mcpPath.citationCount === 0
  const mcpScopeIsolated =
    !sample.mcpPath.allowedAccessLevels.includes('restricted') &&
    !sample.mcpPath.effectiveScopes.includes('knowledge.restricted.read')
  const mcpResponseLeakDetected = sample.mcpPath.responseLeaksRestrictedContent

  const configSnapshotsAligned =
    sample.webPath.configSnapshotVersion === sample.mcpPath.configSnapshotVersion

  return {
    configSnapshotsAligned,
    mcpRefusedCorrectly,
    mcpResponseLeakDetected,
    mcpScopeIsolated,
    webCanReadRestricted,
  }
}

export function runA10AdminWebMcpIsolationExporter(
  input: A10ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const samples = input.samples ?? buildDefaultSamples()

  if (samples.length === 0) {
    throw new Error('A10 exporter requires at least one isolation sample to emit a record')
  }

  const records: AcceptanceEvidenceRecord[] = samples.map((sample) => {
    const registryEntry = getAcceptanceRegistryEntry(sample.testCaseId)

    if (!registryEntry) {
      throw new Error(`Unknown test case registry id for A10: ${sample.testCaseId}`)
    }

    const isStubbed =
      sample.accessMatrixPointer.startsWith('stub://') ||
      sample.webPath.responseSnapshotPointer.startsWith('stub://') ||
      sample.mcpPath.responseSnapshotPointer.startsWith('stub://')
    const comparison = compareIsolationSample(sample)
    const passed =
      comparison.webCanReadRestricted &&
      comparison.mcpRefusedCorrectly &&
      comparison.mcpScopeIsolated &&
      !comparison.mcpResponseLeakDetected &&
      comparison.configSnapshotsAligned
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (!comparison.webCanReadRestricted) {
      notesParts.push(
        'web-admin path failed to read restricted citation — possible over-redaction or misconfigured access level'
      )
    }

    if (!comparison.mcpRefusedCorrectly) {
      notesParts.push(
        `mcp path did not refuse correctly (refused=${sample.mcpPath.refused}, citations=${sample.mcpPath.citationCount})`
      )
    }

    if (!comparison.mcpScopeIsolated) {
      notesParts.push(
        'mcp token carries restricted scope — scope isolation broken between web and mcp channels'
      )
    }

    if (comparison.mcpResponseLeakDetected) {
      notesParts.push('mcp response serialized restricted content — isolation leak detected')
    }

    if (!comparison.configSnapshotsAligned) {
      notesParts.push(
        `config_snapshot_version drift between channels (web=${sample.webPath.configSnapshotVersion}, mcp=${sample.mcpPath.configSnapshotVersion})`
      )
    }

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed access matrix + channel snapshots — rerun TC-14 with real Admin OAuth session + MCP token to capture live payloads.'
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'shared',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: 'web-admin-reads-restricted-mcp-isolated',
      environment: context.runtimeConfig.environment as 'local' | 'staging' | 'production',
      evidenceRefs: [
        {
          description: `access matrix (user=${sample.userEmail}, web=${sample.webPath.allowedAccessLevels.join('|')}, mcp=${sample.mcpPath.allowedAccessLevels.join('|')})`,
          kind: 'access-matrix' as const,
          pointer: sample.accessMatrixPointer,
        },
        {
          description: `web-admin response snapshot (citations=${sample.webPath.citationCount}, refused=${sample.webPath.refused})`,
          kind: 'orchestration-log' as const,
          pointer: sample.webPath.responseSnapshotPointer,
        },
        {
          description: `mcp response snapshot (citations=${sample.mcpPath.citationCount}, refused=${sample.mcpPath.refused})`,
          kind: 'orchestration-log' as const,
          pointer: sample.mcpPath.responseSnapshotPointer,
        },
      ],
      generatedAt: context.generatedAt,
      httpStatus: sample.webPath.httpStatus,
      notes: notesParts.length > 0 ? notesParts.join(' | ') : undefined,
      reportVersion: context.reportVersion,
      status,
      testCaseId: sample.testCaseId,
    }
  })

  return createEvidenceExport(ACCEPTANCE_ID, records, context)
}
