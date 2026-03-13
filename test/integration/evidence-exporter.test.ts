import { describe, expect, it } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import {
  ACCEPTANCE_EVIDENCE_STATUS_VALUES,
  parseAcceptanceEvidenceExport,
} from '#shared/schemas/acceptance-evidence'

import { runA01DeploySmokeExporter } from '../acceptance/evidence/a01-deploy-smoke'
import { runA02AiSearchOrchestrationExporter } from '../acceptance/evidence/a02-ai-search-orchestration'
import { runA03CitationReplayExporter } from '../acceptance/evidence/a03-citation-replay'
import { runA04CurrentVersionOnlyExporter } from '../acceptance/evidence/a04-current-version-only'
import { runA05SelfCorrectionExporter } from '../acceptance/evidence/a05-self-correction'
import { runA06RefusalAccuracyExporter } from '../acceptance/evidence/a06-refusal-accuracy'
import {
  A07_REQUIRED_TOOLS,
  listMissingMcpTools,
  runA07McpContractExporter,
} from '../acceptance/evidence/a07-mcp-contract'
import { runA08OauthAllowlistExporter } from '../acceptance/evidence/a08-oauth-allowlist'
import { runA09RestrictedScopeExporter } from '../acceptance/evidence/a09-restricted-scope'
import { runA10AdminWebMcpIsolationExporter } from '../acceptance/evidence/a10-admin-web-mcp-isolation'
import { runA11PersistenceAuditExporter } from '../acceptance/evidence/a11-persistence-audit'
import {
  A12_FORBIDDEN_INTERNAL_KEYS,
  runA12McpNoInternalDiagnosticsExporter,
} from '../acceptance/evidence/a12-mcp-no-internal-diagnostics'
import { runA13RateLimitRetentionExporter } from '../acceptance/evidence/a13-rate-limit-retention'
import { runEv01CoreLoopExporter } from '../acceptance/evidence/ev01-core-loop'
import { runEv02OauthAllowlistExporter } from '../acceptance/evidence/ev02-oauth-allowlist'
import { runEv03PublishCutoverExporter } from '../acceptance/evidence/ev03-publish-cutover'
import { runEv04RateLimitCleanupExporter } from '../acceptance/evidence/ev04-rate-limit-cleanup'
import { runEvUi01StateCoverageExporter } from '../acceptance/evidence/ev-ui-01-state-coverage'
import {
  buildEvidenceSummaryTables,
  type EvidenceSummaryTable,
} from '../acceptance/evidence/summary-tables'
import { runAllEvidenceExporters } from '../acceptance/evidence/run-all'
import { acceptanceRegistryManifest } from '../acceptance/registry/manifest'

function fixedNow(): string {
  return '2026-04-18T00:00:00.000Z'
}

function getConfigSnapshotVersion(): string {
  return createKnowledgeRuntimeConfig({
    bindings: {
      aiSearchIndex: 'knowledge-index',
      d1Database: 'DB',
      documentsBucket: 'DOCUMENTS',
      rateLimitKv: 'KV',
    },
    environment: 'local',
  }).governance.configSnapshotVersion
}

function firstRecord<T>(records: readonly T[]): T {
  const record = records[0]
  expect(record).toBeDefined()
  return record as T
}

describe('acceptance evidence exporters', () => {
  it('A01 deploy smoke exporter emits records with governance snapshot and deploy pointers', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA01DeploySmokeExporter({
      deploy: {
        branch: 'main',
        buildId: 'build-123',
        commitSha: 'abc1234deadbeef',
        deployedAt: fixedNow(),
        environment: 'local',
        region: 'apac',
        workerName: 'nuxt-edge-agentic-rag',
      },
      now: fixedNow,
      smokeResults: [
        {
          channel: 'web',
          endpoint: '/api/chat',
          httpStatus: 200,
          responseBodyPointer: 'evidence/v1.0.0/smoke/web-chat.json',
          responseTimeMs: 124,
          succeeded: true,
        },
        {
          channel: 'mcp',
          endpoint: '/mcp',
          httpStatus: 200,
          responseBodyPointer: 'evidence/v1.0.0/smoke/mcp-ask.json',
          responseTimeMs: 98,
          succeeded: true,
        },
      ],
    })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A01')
    expect(payload.reportVersion).toBe(acceptanceRegistryManifest.reportVersion)
    expect(payload.records).toHaveLength(2)

    const webRecord = payload.records.find((record) => record.channel === 'web')
    const mcpRecord = payload.records.find((record) => record.channel === 'mcp')

    expect(webRecord).toBeDefined()
    expect(mcpRecord).toBeDefined()
    expect(webRecord?.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(mcpRecord?.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(webRecord?.status).toBe('passed')
    expect(webRecord?.decisionPath).toBe('deploy-smoke')
    expect(webRecord?.testCaseId).toBeNull()
    expect(webRecord?.httpStatus).toBe(200)
    expect(webRecord?.evidenceRefs.some((ref) => ref.kind === 'deploy-metadata')).toBe(true)
    expect(webRecord?.evidenceRefs.some((ref) => ref.kind === 'smoke-response')).toBe(true)
  })

  it('A01 defaults to pending-production-run when stub pointers are used', () => {
    const payload = runA01DeploySmokeExporter({ now: fixedNow })

    for (const record of payload.records) {
      expect(record.status).toBe('pending-production-run')
      expect(record.notes).toMatch(/stubbed/i)
    }
  })

  it('A02 orchestration exporter records decision paths and citation pointers per case', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA02AiSearchOrchestrationExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A02')
    expect(payload.records.length).toBeGreaterThan(0)

    const caseIds = payload.records.map((record) => record.testCaseId)

    expect(caseIds).toEqual(expect.arrayContaining(['TC-01', 'TC-04', 'TC-06', 'TC-10']))

    for (const record of payload.records) {
      expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
      expect(record.acceptanceId).toBe('A02')
      expect(ACCEPTANCE_EVIDENCE_STATUS_VALUES).toContain(record.status)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'ai-search-request')).toBe(true)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'ai-search-response')).toBe(true)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'query-log')).toBe(true)
    }

    const judgePass = payload.records.find((record) => record.testCaseId === 'TC-06')

    expect(judgePass?.decisionPath).toBe('judge_pass')
    expect(judgePass?.evidenceRefs.filter((ref) => ref.kind === 'citation-record').length).toBe(2)
  })

  it('A02 exporter rejects observations referencing unknown test cases', () => {
    expect(() =>
      runA02AiSearchOrchestrationExporter({
        now: fixedNow,
        observations: [
          {
            aiSearchRequestPointer: 'evidence/req.json',
            aiSearchResponsePointer: 'evidence/res.json',
            aiSearchScore: 0.8,
            answerSummary: 'bogus',
            channel: 'web',
            citationIds: [],
            decisionPath: 'direct',
            httpStatus: 200,
            queryLogPointer: 'evidence/log.json',
            sourceChunkIds: [],
            testCaseId: 'TC-999',
          },
        ],
      })
    ).toThrow(/unknown test case/i)
  })

  it('A03 replay exporter marks consistent samples as passed when pointers are non-stub', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const consistentText = '一致片段內容'
    const payload = runA03CitationReplayExporter({
      now: fixedNow,
      samples: [
        {
          citationId: 'cit-a',
          citationSnapshotText: consistentText,
          documentVersionId: 'ver-a',
          httpStatus: 200,
          replayResponseText: consistentText,
          replaySourcePointer: 'evidence/replay/cit-a.json',
          sourceChunkId: 'chunk-a',
          sourceChunkText: consistentText,
          testCaseId: 'TC-12',
        },
      ],
    })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.records).toHaveLength(1)

    const record = firstRecord(payload.records)

    expect(record.acceptanceId).toBe('A03')
    expect(record.status).toBe('passed')
    expect(record.decisionPath).toBe('replay-consistent')
    expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'source-chunk')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'citation-record')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'replay-response')).toBe(true)
  })

  it('A03 replay exporter flags drift when snapshot and replay disagree', () => {
    const payload = runA03CitationReplayExporter({
      now: fixedNow,
      samples: [
        {
          citationId: 'cit-drift',
          citationSnapshotText: '原始片段',
          documentVersionId: 'ver-drift',
          httpStatus: 200,
          replayResponseText: '重播後被竄改的片段',
          replaySourcePointer: 'evidence/replay/cit-drift.json',
          sourceChunkId: 'chunk-drift',
          sourceChunkText: '原始片段',
          testCaseId: 'TC-12',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.decisionPath).toBe('replay-drift')
    expect(record.notes).toMatch(/replay text does not match/i)
  })

  it('runAllEvidenceExporters returns all thirteen exports and never writes during unit test', () => {
    const exports = runAllEvidenceExporters({ now: fixedNow, write: false })

    expect(exports).toHaveLength(13)
    expect(exports.map((item) => item.acceptanceId)).toEqual([
      'A01',
      'A02',
      'A03',
      'A04',
      'A05',
      'A06',
      'A07',
      'A08',
      'A09',
      'A10',
      'A11',
      'A12',
      'A13',
    ])

    for (const exported of exports) {
      expect(parseAcceptanceEvidenceExport(exported)).toBeTruthy()
      expect(exported.records.length).toBeGreaterThan(0)
    }
  })

  it('A04 current-version-only exporter marks passed when v2 era cites only the active version', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA04CurrentVersionOnlyExporter({
      now: fixedNow,
      samples: [
        {
          channel: 'web',
          documentId: 'doc-a',
          expectedOutcome: 'cites_v2_only',
          httpStatus: 200,
          query: '最新版本的 SOP 有什麼差異？',
          testCaseId: 'TC-18',
          v1Era: {
            answerSummary: 'v1 era answer',
            citationIds: ['cit-v1-1'],
            documentVersionIds: ['ver-a-v1'],
            orchestrationLogPointer: 'evidence/orc/v1-era.json',
            queryLogPointer: 'evidence/qlog/v1-era.json',
            responsePointer: 'evidence/resp/v1-era.json',
          },
          v1VersionId: 'ver-a-v1',
          v2Era: {
            answerSummary: 'v2 era answer',
            citationIds: ['cit-v2-1'],
            documentVersionIds: ['ver-a-v2'],
            orchestrationLogPointer: 'evidence/orc/v2-era.json',
            queryLogPointer: 'evidence/qlog/v2-era.json',
            responsePointer: 'evidence/resp/v2-era.json',
          },
          v2VersionId: 'ver-a-v2',
        },
      ],
    })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A04')
    expect(payload.records).toHaveLength(1)

    const record = firstRecord(payload.records)

    expect(record.status).toBe('passed')
    expect(record.decisionPath).toBe('cutover-current-only')
    expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(record.evidenceRefs.filter((ref) => ref.kind === 'version-era-snapshot')).toHaveLength(2)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'query-log')).toBe(true)
  })

  it('A04 exporter flags drift when v2 era still cites v1 citations', () => {
    const payload = runA04CurrentVersionOnlyExporter({
      now: fixedNow,
      samples: [
        {
          channel: 'web',
          documentId: 'doc-a',
          expectedOutcome: 'cites_v2_only',
          httpStatus: 200,
          query: '最新版本的 SOP？',
          testCaseId: 'TC-18',
          v1Era: {
            answerSummary: 'v1 era',
            citationIds: ['cit-v1-1'],
            documentVersionIds: ['ver-a-v1'],
            orchestrationLogPointer: 'evidence/orc/v1.json',
            queryLogPointer: 'evidence/qlog/v1.json',
            responsePointer: 'evidence/resp/v1.json',
          },
          v1VersionId: 'ver-a-v1',
          v2Era: {
            answerSummary: 'v2 era still leaks v1',
            citationIds: ['cit-v1-1'],
            documentVersionIds: ['ver-a-v1'],
            orchestrationLogPointer: 'evidence/orc/v2.json',
            queryLogPointer: 'evidence/qlog/v2.json',
            responsePointer: 'evidence/resp/v2.json',
          },
          v2VersionId: 'ver-a-v2',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.decisionPath).toBe('cutover-drift')
    expect(record.notes).toMatch(/v1 citations/i)
  })

  it('A04 default stubbed samples emit pending-production-run', () => {
    const payload = runA04CurrentVersionOnlyExporter({ now: fixedNow })

    expect(payload.records.length).toBeGreaterThan(0)

    for (const record of payload.records) {
      expect(record.status).toBe('pending-production-run')
      expect(record.notes).toMatch(/stubbed/i)
    }
  })

  it('A05 self-correction exporter passes when retry score improves and decision path transitions', () => {
    const payload = runA05SelfCorrectionExporter({
      now: fixedNow,
      samples: [
        {
          channel: 'web',
          finalDecisionPath: 'self_corrected',
          httpStatus: 200,
          initial: {
            aiSearchRequestPointer: 'evidence/ai-search/tc04-r1-req.json',
            aiSearchResponsePointer: 'evidence/ai-search/tc04-r1-res.json',
            aiSearchScore: 0.41,
            answerSummary: null,
            citationIds: [],
            orchestrationLogPointer: 'evidence/orc/tc04-r1.json',
            queryText: '那個月結？',
          },
          retry: {
            aiSearchRequestPointer: 'evidence/ai-search/tc04-r2-req.json',
            aiSearchResponsePointer: 'evidence/ai-search/tc04-r2-res.json',
            aiSearchScore: 0.82,
            answerSummary: 'Month-end report fields: A/B/C/D',
            citationIds: ['cit-reporting-3'],
            orchestrationLogPointer: 'evidence/orc/tc04-r2.json',
            queryText: '月結報表有哪些欄位？',
          },
          testCaseId: 'TC-04',
        },
      ],
    })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A05')

    const record = firstRecord(payload.records)

    expect(record.status).toBe('passed')
    expect(record.decisionPath).toBe('self_corrected')
    expect(record.evidenceRefs.filter((ref) => ref.kind === 'ai-search-request')).toHaveLength(2)
    expect(record.evidenceRefs.filter((ref) => ref.kind === 'ai-search-response')).toHaveLength(2)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'orchestration-log-correction')).toBe(
      true
    )
  })

  it('A05 exporter flags failure when retry score does not improve', () => {
    const payload = runA05SelfCorrectionExporter({
      now: fixedNow,
      samples: [
        {
          channel: 'web',
          finalDecisionPath: 'self_corrected',
          httpStatus: 200,
          initial: {
            aiSearchRequestPointer: 'evidence/req-r1.json',
            aiSearchResponsePointer: 'evidence/res-r1.json',
            aiSearchScore: 0.75,
            answerSummary: null,
            citationIds: [],
            orchestrationLogPointer: 'evidence/orc-r1.json',
            queryText: '原始查詢',
          },
          retry: {
            aiSearchRequestPointer: 'evidence/req-r2.json',
            aiSearchResponsePointer: 'evidence/res-r2.json',
            aiSearchScore: 0.6,
            answerSummary: null,
            citationIds: [],
            orchestrationLogPointer: 'evidence/orc-r2.json',
            queryText: '改問查詢',
          },
          testCaseId: 'TC-04',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/retry score.*did not improve/i)
  })

  it('A06 refusal accuracy exporter passes when refused matches expectation with no citation leak', () => {
    const payload = runA06RefusalAccuracyExporter({
      now: fixedNow,
      samples: [
        {
          actualAnswerSummary: null,
          actualCitationIds: [],
          actualRefused: true,
          category: 'out-of-knowledge',
          channel: 'web',
          expectedRefused: true,
          httpStatus: 200,
          orchestrationLogPointer: 'evidence/orc/tc07.json',
          persistedRawContent: false,
          query: '越界問題',
          queryLogPointer: 'evidence/qlog/tc07.json',
          testCaseId: 'TC-07',
        },
      ],
    })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A06')

    const record = firstRecord(payload.records)

    expect(record.status).toBe('passed')
    expect(record.decisionPath).toBe('refused')
    expect(record.evidenceRefs.some((ref) => ref.kind === 'refusal-case-matrix')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'orchestration-log')).toBe(true)
  })

  it('A06 exporter fails when refused-expected sample returned citations', () => {
    const payload = runA06RefusalAccuracyExporter({
      now: fixedNow,
      samples: [
        {
          actualAnswerSummary: '意外洩漏的答案',
          actualCitationIds: ['cit-leak-1'],
          actualRefused: true,
          category: 'out-of-knowledge',
          channel: 'web',
          expectedRefused: true,
          httpStatus: 200,
          orchestrationLogPointer: 'evidence/orc/leak.json',
          persistedRawContent: false,
          query: '越界問題',
          queryLogPointer: 'evidence/qlog/leak.json',
          testCaseId: 'TC-07',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/emitted citations/i)
  })

  it('A06 exporter fails when high-risk sample persisted raw content', () => {
    const payload = runA06RefusalAccuracyExporter({
      now: fixedNow,
      samples: [
        {
          actualAnswerSummary: null,
          actualCitationIds: [],
          actualRefused: true,
          category: 'high-risk-no-persist',
          channel: 'web',
          expectedRefused: true,
          httpStatus: 200,
          orchestrationLogPointer: 'evidence/orc/tc15.json',
          persistedRawContent: true,
          query: '<高風險>',
          queryLogPointer: 'evidence/qlog/tc15.json',
          testCaseId: 'TC-15',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/persisted raw content/i)
  })

  it('A07 MCP contract exporter emits one record per tool with inspector + contract snapshot refs', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA07McpContractExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A07')
    expect(payload.records).toHaveLength(4)

    const tools = new Set<string>()

    for (const record of payload.records) {
      expect(record.channel).toBe('mcp')
      expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'mcp-inspector-log')).toBe(true)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'contract-snapshot')).toBe(true)
      const inspectorRef = record.evidenceRefs.find((ref) => ref.kind === 'mcp-inspector-log')
      expect(inspectorRef?.description).toBeTruthy()
      for (const tool of A07_REQUIRED_TOOLS) {
        if (inspectorRef?.description.includes(tool)) {
          tools.add(tool)
        }
      }
    }

    expect(Array.from(tools).toSorted()).toEqual([...A07_REQUIRED_TOOLS].toSorted())

    expect(listMissingMcpTools([])).toEqual([...A07_REQUIRED_TOOLS])
  })

  it('A07 exporter flags failure when contract drift is reported', () => {
    const payload = runA07McpContractExporter({
      now: fixedNow,
      samples: [
        {
          contractDrift: true,
          contractSnapshotPointer: 'evidence/mcp/search-knowledge.json',
          expectedDecisionPath: '200_empty',
          httpStatus: 200,
          inspectorLogPointer: 'evidence/mcp/inspector-search.json',
          responseSummary: 'contract drift observed',
          testCaseId: 'TC-16',
          tool: 'searchKnowledge',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/contract snapshot drift/i)
  })

  it('A08 OAuth + allowlist exporter records baseline → promoted → demoted transitions', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA08OauthAllowlistExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A08')
    expect(payload.records).toHaveLength(3)

    const states = payload.records.map((record) => record.decisionPath)

    expect(states).toEqual(['allowlist-baseline', 'allowlist-promoted', 'allowlist-demoted'])

    for (const record of payload.records) {
      expect(record.channel).toBe('web')
      expect(record.testCaseId).toBeNull()
      expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'oauth-session-snapshot')).toBe(true)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'allowlist-state')).toBe(true)
      expect(record.status).toBe('pending-production-run')
    }
  })

  it('A08 exporter flags privilege leak when non-admin session exposes admin routes', () => {
    const payload = runA08OauthAllowlistExporter({
      now: fixedNow,
      snapshots: [
        {
          accessibleRoutes: ['/', '/chat', '/admin/documents'],
          actualRole: 'user',
          allowlistContainsUser: false,
          allowlistStatePointer: 'evidence/allowlist/leak.json',
          expectedRole: 'user',
          httpStatus: 200,
          navigationItems: ['Home', 'Chat'],
          oauthSessionPointer: 'evidence/oauth/leak.json',
          stateLabel: 'baseline',
          userEmail: 'leak@example.com',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/admin routes/i)
  })

  it('A09 restricted scope exporter emits pending-production-run for default stub samples', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA09RestrictedScopeExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A09')
    expect(payload.records).toHaveLength(3)

    const testCaseIds = payload.records.map((record) => record.testCaseId)

    expect(testCaseIds).toEqual(['TC-13', 'TC-15', 'TC-17'])

    for (const record of payload.records) {
      expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'scope-decision')).toBe(true)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'redacted-query-log')).toBe(true)
      expect(record.status).toBe('pending-production-run')
      expect(record.decisionPath).toBe('scope-deny')
    }
  })

  it('A09 exporter flags failure when response leaks restricted content', () => {
    const payload = runA09RestrictedScopeExporter({
      now: fixedNow,
      samples: [
        {
          actualDecision: 'allow',
          channel: 'mcp',
          expectedDecision: 'deny',
          hasRestrictedScope: false,
          httpStatus: 200,
          queryLogPointer: 'evidence/qlog/tc13-leak.json',
          queryLogStatus: 'accepted',
          redactedQueryText: 'RAW_QUERY_NO_REDACTION',
          responseLeaksRestrictedContent: true,
          restrictedTokenPresent: false,
          scopeDecisionPointer: 'evidence/scope/tc13-leak.json',
          sensitiveTokens: [],
          testCaseId: 'TC-13',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(
      /scope decision drift|scope matrix inconsistent|redaction marker missing|leaked restricted content/i
    )
  })

  it('A09 exporter flags failure when sensitive tokens remain unredacted in query_logs', () => {
    const payload = runA09RestrictedScopeExporter({
      now: fixedNow,
      samples: [
        {
          actualDecision: 'deny',
          channel: 'web',
          expectedDecision: 'deny',
          hasRestrictedScope: false,
          httpStatus: 200,
          queryLogPointer: 'evidence/qlog/tc15-leak.json',
          queryLogStatus: 'accepted',
          redactedQueryText: '<redacted: but still leaks SECRET_TOKEN_123>',
          responseLeaksRestrictedContent: false,
          restrictedTokenPresent: false,
          scopeDecisionPointer: 'evidence/scope/tc15-leak.json',
          sensitiveTokens: ['SECRET_TOKEN_123'],
          testCaseId: 'TC-15',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/sensitive tokens still present/i)
  })

  it('A10 admin-web + mcp isolation exporter records access matrix and channel snapshots', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA10AdminWebMcpIsolationExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A10')
    expect(payload.records).toHaveLength(1)

    const record = firstRecord(payload.records)

    expect(record.channel).toBe('shared')
    expect(record.testCaseId).toBe('TC-14')
    expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'access-matrix')).toBe(true)
    expect(
      record.evidenceRefs.filter((ref) => ref.kind === 'orchestration-log').length
    ).toBeGreaterThanOrEqual(2)
    expect(record.status).toBe('pending-production-run')
    expect(record.decisionPath).toBe('web-admin-reads-restricted-mcp-isolated')
  })

  it('A10 exporter flags failure when mcp path leaks restricted content', () => {
    const payload = runA10AdminWebMcpIsolationExporter({
      now: fixedNow,
      samples: [
        {
          accessMatrixPointer: 'evidence/access/tc14-leak.json',
          mcpPath: {
            allowedAccessLevels: ['internal', 'restricted'],
            channelPath: 'mcp',
            citationCount: 2,
            citesRestrictedContent: true,
            configSnapshotVersion: 'snap-a',
            effectiveScopes: ['knowledge.read', 'knowledge.restricted.read'],
            httpStatus: 200,
            refused: false,
            responseLeaksRestrictedContent: true,
            responseSnapshotPointer: 'evidence/responses/tc14-mcp-leak.json',
            role: 'admin',
          },
          testCaseId: 'TC-14',
          userEmail: 'leak@example.com',
          webPath: {
            allowedAccessLevels: ['internal', 'restricted'],
            channelPath: 'web-admin',
            citationCount: 2,
            citesRestrictedContent: true,
            configSnapshotVersion: 'snap-a',
            effectiveScopes: ['admin.read', 'knowledge.restricted.read'],
            httpStatus: 200,
            refused: false,
            responseLeaksRestrictedContent: false,
            responseSnapshotPointer: 'evidence/responses/tc14-web-leak.json',
            role: 'admin',
          },
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(
      /isolation leak detected|did not refuse correctly|scope isolation broken/i
    )
  })

  it('A11 persistence audit exporter emits records for TC-09 and TC-15 with three audit refs each', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA11PersistenceAuditExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A11')
    expect(payload.records).toHaveLength(2)

    const testCaseIds = payload.records.map((record) => record.testCaseId)

    expect(testCaseIds).toEqual(['TC-09', 'TC-15'])

    for (const record of payload.records) {
      expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
      expect(record.evidenceRefs.filter((ref) => ref.kind === 'persistence-audit')).toHaveLength(3)
      expect(record.status).toBe('pending-production-run')
      expect(record.decisionPath).toBe('persistence-redaction')
    }
  })

  it('A11 exporter flags failure when query_logs or messages leak sensitive tokens', () => {
    const payload = runA11PersistenceAuditExporter({
      now: fixedNow,
      samples: [
        {
          citationRecords: {
            containsSensitiveToken: false,
            detectedTokens: [],
            persistedSnapshot: '',
            pointer: 'evidence/citations/tc09.json',
            table: 'citation_records',
            wasWritten: false,
          },
          expectedRefused: true,
          httpStatus: 200,
          messagesContent: {
            containsSensitiveToken: true,
            detectedTokens: ['SENSITIVE_LEAK_1'],
            persistedSnapshot: 'leaked content: SENSITIVE_LEAK_1',
            pointer: 'evidence/messages/tc09-leak.json',
            table: 'messages',
            wasWritten: true,
          },
          queryLog: {
            containsSensitiveToken: true,
            detectedTokens: ['SENSITIVE_LEAK_2'],
            persistedSnapshot: 'raw: SENSITIVE_LEAK_2',
            pointer: 'evidence/query-logs/tc09-leak.json',
            table: 'query_logs',
            wasWritten: true,
          },
          sensitiveTokens: ['SENSITIVE_LEAK_1', 'SENSITIVE_LEAK_2'],
          testCaseId: 'TC-09',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/query_logs\.query_text leaked|messages\.content_text leaked/i)
  })

  it('A11 exporter flags failure when refused high-risk case still writes citation_records', () => {
    const payload = runA11PersistenceAuditExporter({
      now: fixedNow,
      samples: [
        {
          citationRecords: {
            containsSensitiveToken: false,
            detectedTokens: [],
            persistedSnapshot: 'unexpected citation written for refused query',
            pointer: 'evidence/citations/tc15-unexpected.json',
            table: 'citation_records',
            wasWritten: true,
          },
          expectedRefused: true,
          httpStatus: 200,
          messagesContent: {
            containsSensitiveToken: false,
            detectedTokens: [],
            persistedSnapshot: '<redacted>',
            pointer: 'evidence/messages/tc15.json',
            table: 'messages',
            wasWritten: true,
          },
          queryLog: {
            containsSensitiveToken: false,
            detectedTokens: [],
            persistedSnapshot: '<redacted>',
            pointer: 'evidence/query-logs/tc15.json',
            table: 'query_logs',
            wasWritten: true,
          },
          sensitiveTokens: [],
          testCaseId: 'TC-15',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/citation_records row was written/i)
  })

  it('A12 MCP no-internal-diagnostics exporter lists forbidden keys and pending stub status by default', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA12McpNoInternalDiagnosticsExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A12')
    expect(payload.records.length).toBeGreaterThan(0)

    for (const record of payload.records) {
      expect(record.channel).toBe('mcp')
      expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'contract-snapshot')).toBe(true)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'mcp-inspector-log')).toBe(true)
      expect(record.status).toBe('pending-production-run')
      expect(record.decisionPath).toBe('no-internal-diagnostics')
    }

    expect(A12_FORBIDDEN_INTERNAL_KEYS).toContain('decisionPath')
    expect(A12_FORBIDDEN_INTERNAL_KEYS).toContain('retrievalScore')
  })

  it('A12 exporter flags failure when forbidden internal diagnostic keys appear in response', () => {
    const payload = runA12McpNoInternalDiagnosticsExporter({
      now: fixedNow,
      samples: [
        {
          contractDrift: false,
          contractSnapshotPointer: 'evidence/mcp/tc20-leak-search.json',
          forbiddenKeysFound: ['decisionPath', 'retrievalScore'],
          httpStatus: 200,
          inspectorLogPointer: 'evidence/mcp/inspector/tc20-leak-search.json',
          responseBodySummary: 'searchKnowledge response exposes internal diagnostics',
          testCaseId: 'TC-20',
          tool: 'searchKnowledge',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/forbidden internal diagnostic keys/i)
  })

  it('A13 rate-limit + retention exporter emits chained evidence with four evidence refs', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runA13RateLimitRetentionExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('A13')
    expect(payload.records).toHaveLength(1)

    const record = firstRecord(payload.records)

    expect(record.channel).toBe('shared')
    expect(record.testCaseId).toBeNull()
    expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'rate-limit-state')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'retention-cleanup-report')).toBe(true)
    expect(record.evidenceRefs.filter((ref) => ref.kind === 'replay-response')).toHaveLength(2)
    expect(record.status).toBe('pending-production-run')
    expect(record.decisionPath).toBe('rate-limit-retention-replay')
  })

  it('A13 exporter flags failure when replay chain does not flip from 200 to 404/410 after cleanup', () => {
    const payload = runA13RateLimitRetentionExporter({
      now: fixedNow,
      samples: [
        {
          rateLimit: {
            actualRateLimitedCount: 3,
            expectedRateLimitedCount: 3,
            kvStatePointer: 'evidence/rate-limit/kv.json',
            rateLimitKeyCount: 1,
            rateLimitWindowSeconds: 60,
            sampleRequestCount: 10,
          },
          replay: {
            backdatedRecordId: 'citation-backdated-inconsistent',
            postCleanupHttpStatus: 200,
            postCleanupReplayPointer: 'evidence/replay/post.json',
            preCleanupHttpStatus: 200,
            preCleanupReplayPointer: 'evidence/replay/pre.json',
          },
          retention: {
            backdatedRecordCleaned: true,
            backdatedRecordCount: 1,
            cleanupReportPointer: 'evidence/retention/cleanup.json',
            cutoffIsoTimestamp: '2026-04-04T00:00:00.000Z',
            recordsEligible: 5,
            recordsRemainingAfterCleanup: 0,
            recordsRemoved: 5,
          },
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/replay chain inconsistent/i)
  })

  it('EV-01 core loop exporter chains deploy → login → publish → ask → replay stages', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runEv01CoreLoopExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('EV-01')
    expect(payload.records).toHaveLength(1)

    const record = firstRecord(payload.records)

    expect(record.channel).toBe('shared')
    expect(record.testCaseId).toBeNull()
    expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(record.decisionPath).toBe('core-loop-smoke')
    expect(record.status).toBe('pending-production-run')
    expect(record.evidenceRefs.some((ref) => ref.kind === 'deploy-metadata')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'oauth-session-snapshot')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'smoke-response')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'query-log')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'replay-response')).toBe(true)
  })

  it('EV-01 exporter flags failure when any stage reports failure', () => {
    const payload = runEv01CoreLoopExporter({
      now: fixedNow,
      samples: [
        {
          askStage: {
            answerSummary: 'answer produced',
            citationIds: ['cit-1'],
            decisionPath: 'direct',
            httpStatus: 200,
            queryLogPointer: 'evidence/ev01/ask-query.json',
            queryText: 'TC-01 smoke ask',
            responsePointer: 'evidence/ev01/ask-response.json',
            succeeded: true,
          },
          deployStage: {
            commitSha: 'abcd1234',
            environment: 'local',
            metadataPointer: 'evidence/ev01/deploy.json',
            succeeded: true,
            workerName: 'nuxt-edge-agentic-rag',
          },
          loginStage: {
            oauthSessionPointer: 'evidence/ev01/oauth.json',
            role: 'admin',
            succeeded: true,
            userEmail: 'admin@example.com',
          },
          publishStage: {
            documentId: 'doc-a',
            httpStatus: 200,
            publishLogPointer: 'evidence/ev01/publish.json',
            succeeded: false,
            versionId: 'ver-1',
          },
          replayStage: {
            citationId: 'cit-1',
            httpStatus: 200,
            replayPointer: 'evidence/ev01/replay.json',
            succeeded: true,
          },
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/publish stage failed/i)
  })

  it('EV-02 OAuth allowlist exporter links allowlist transitions with the EV-level chain', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runEv02OauthAllowlistExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('EV-02')
    expect(payload.records).toHaveLength(1)

    const record = firstRecord(payload.records)

    expect(record.channel).toBe('web')
    expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(record.decisionPath).toBe('allowlist-promote-demote-chain')
    expect(record.status).toBe('pending-production-run')
    expect(
      record.evidenceRefs.filter((ref) => ref.kind === 'oauth-session-snapshot').length
    ).toBeGreaterThanOrEqual(3)
    expect(
      record.evidenceRefs.filter((ref) => ref.kind === 'allowlist-state').length
    ).toBeGreaterThanOrEqual(3)
  })

  it('EV-02 exporter flags failure when an observed role does not match allowlist membership', () => {
    const payload = runEv02OauthAllowlistExporter({
      now: fixedNow,
      snapshots: [
        {
          accessibleRoutes: ['/', '/chat', '/admin'],
          actualRole: 'user',
          allowlistContainsUser: true,
          allowlistStatePointer: 'evidence/ev02/allow-broken.json',
          expectedRole: 'admin',
          httpStatus: 200,
          navigationItems: ['Home', 'Chat'],
          oauthSessionPointer: 'evidence/ev02/session-broken.json',
          stateLabel: 'promoted',
          userEmail: 'ops@example.com',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/role recomputation drift|allowlist membership/i)
  })

  it('EV-03 publish cutover exporter chains publish no-op + rollback + cutover stages', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runEv03PublishCutoverExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('EV-03')
    expect(payload.records).toHaveLength(1)

    const record = firstRecord(payload.records)

    expect(record.channel).toBe('shared')
    expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(record.decisionPath).toBe('publish-rollback-cutover-chain')
    expect(record.status).toBe('pending-production-run')
    expect(record.evidenceRefs.some((ref) => ref.kind === 'version-era-snapshot')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'query-log')).toBe(true)
  })

  it('EV-03 exporter flags failure when cutover stage still cites archived versions', () => {
    const payload = runEv03PublishCutoverExporter({
      now: fixedNow,
      samples: [
        {
          cutoverStage: {
            citationIds: ['cit-v1-leak'],
            cutoverDocumentId: 'doc-cut',
            cutoverHttpStatus: 200,
            cutoverLeaksArchivedVersion: true,
            cutoverResponsePointer: 'evidence/ev03/cutover.json',
            currentVersionId: 'ver-v2',
            previousVersionId: 'ver-v1',
            queryLogPointer: 'evidence/ev03/cutover-qlog.json',
          },
          noopStage: {
            noopHttpStatus: 200,
            noopReportPointer: 'evidence/ev03/noop.json',
            succeeded: true,
          },
          rollbackStage: {
            activeVersionAfterRollback: 'ver-v1',
            rollbackHttpStatus: 200,
            rollbackReportPointer: 'evidence/ev03/rollback.json',
            succeeded: true,
          },
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/cutover.*archived|leaks archived version/i)
  })

  it('EV-04 rate-limit cleanup exporter reuses A13 chain with EV-level metadata', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runEv04RateLimitCleanupExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('EV-04')
    expect(payload.records.length).toBeGreaterThanOrEqual(1)

    const record = firstRecord(payload.records)

    expect(record.channel).toBe('shared')
    expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
    expect(record.decisionPath).toBe('rate-limit-retention-replay')
    expect(record.status).toBe('pending-production-run')
    expect(record.evidenceRefs.some((ref) => ref.kind === 'rate-limit-state')).toBe(true)
    expect(record.evidenceRefs.some((ref) => ref.kind === 'retention-cleanup-report')).toBe(true)
    expect(record.evidenceRefs.filter((ref) => ref.kind === 'replay-response').length).toBe(2)
  })

  it('summary tables aggregator returns rows with config snapshot version for every record', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const acceptanceExports = runAllEvidenceExporters({ now: fixedNow, write: false })
    const evExports = [
      runEv01CoreLoopExporter({ now: fixedNow }),
      runEv02OauthAllowlistExporter({ now: fixedNow }),
      runEv03PublishCutoverExporter({ now: fixedNow }),
      runEv04RateLimitCleanupExporter({ now: fixedNow }),
    ]
    const tables: EvidenceSummaryTable[] = buildEvidenceSummaryTables([
      ...acceptanceExports,
      ...evExports,
    ])

    expect(tables.length).toBeGreaterThan(0)
    for (const table of tables) {
      expect(table.chapterRef).toMatch(/^chapter-(3|4)$/)
      for (const row of table.rows) {
        expect(row.configSnapshotVersion).toBe(configSnapshotVersion)
        expect(row.acceptanceId).toMatch(/^(A|EV)/)
        expect(row.status).toMatch(/passed|failed|pending-production-run|skipped/)
      }
    }

    const ids = new Set(tables.flatMap((table) => table.rows.map((row) => row.acceptanceId)))
    for (const id of [
      'A01',
      'A02',
      'A03',
      'A04',
      'A05',
      'A06',
      'A07',
      'A08',
      'A09',
      'A10',
      'A11',
      'A12',
      'A13',
      'EV-01',
      'EV-02',
      'EV-03',
      'EV-04',
    ]) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('EV-UI-01 state coverage exporter emits one record per TC-UI-* with screenshot + network log', () => {
    const configSnapshotVersion = getConfigSnapshotVersion()
    const payload = runEvUi01StateCoverageExporter({ now: fixedNow })

    expect(parseAcceptanceEvidenceExport(payload)).toBeTruthy()
    expect(payload.acceptanceId).toBe('EV-UI-01')
    expect(payload.records).toHaveLength(5)

    const caseIds = payload.records.map((record) => record.testCaseId).toSorted()
    expect(caseIds).toEqual(['TC-UI-01', 'TC-UI-02', 'TC-UI-03', 'TC-UI-04', 'TC-UI-05'])

    for (const record of payload.records) {
      expect(record.channel).toBe('web')
      expect(record.configSnapshotVersion).toBe(configSnapshotVersion)
      expect(record.status).toBe('pending-production-run')
      expect(record.evidenceRefs.some((ref) => ref.kind === 'ui-screenshot')).toBe(true)
      expect(record.evidenceRefs.some((ref) => ref.kind === 'ui-network-log')).toBe(true)
      expect(record.decisionPath).toMatch(/^ui-state-(empty|loading|error|success|unauthorized)$/)
    }

    // TC-UI-05 must resolve to 403 (unauthorized state)
    const unauthorizedRecord = payload.records.find((record) => record.testCaseId === 'TC-UI-05')
    expect(unauthorizedRecord?.httpStatus).toBe(403)
    expect(unauthorizedRecord?.decisionPath).toBe('ui-state-unauthorized')

    // TC-UI-03 must resolve to 5xx (error state)
    const errorRecord = payload.records.find((record) => record.testCaseId === 'TC-UI-03')
    expect(errorRecord?.httpStatus).toBe(500)
    expect(errorRecord?.decisionPath).toBe('ui-state-error')
  })

  it('EV-UI-01 exporter flags failure when observed state diverges from expected state', () => {
    const payload = runEvUi01StateCoverageExporter({
      now: fixedNow,
      observations: [
        {
          expectedState: 'empty',
          httpStatus: 200,
          networkLogPointer: 'evidence/ev-ui-01/tc01-network.json',
          observedState: 'success',
          pageUrl: '/admin/documents',
          screenshotPointer: 'evidence/ev-ui-01/tc01-screenshot.png',
          testCaseId: 'TC-UI-01',
        },
      ],
    })

    const record = firstRecord(payload.records)

    expect(record.status).toBe('failed')
    expect(record.notes).toMatch(/UI state drift/i)
  })
})
