import {
  createKnowledgeRuntimeConfig,
  type KnowledgeRuntimeConfigInput,
} from '#shared/schemas/knowledge-runtime'

export interface AcceptanceRegistryManifest {
  reportPath: string
  reportVersion: string
  summary: {
    acceptances: number
    evidence: number
    testCases: number
  }
}

export interface AcceptanceRegistryBaseEntry {
  id: string
  kind: 'acceptance' | 'evidence' | 'test-case'
  reportSections: string[]
  sourceLine: number
  title: string
}

export interface AcceptanceCaseRegistryEntry extends AcceptanceRegistryBaseEntry {
  acceptanceIds: string[]
  channels: string[]
  expectedHttpStatus: string
  primaryOutcome: string
}

export interface AcceptanceGoalRegistryEntry extends AcceptanceRegistryBaseEntry {
  caseIds: string[]
  chapterRefs: string[]
  evidenceIds: string[]
}

export interface AcceptanceEvidenceRegistryEntry extends AcceptanceRegistryBaseEntry {
  acceptanceIds: string[]
  evidenceForm: string
}

export interface AcceptanceRegistryEntryMap {
  [key: string]:
    | AcceptanceCaseRegistryEntry
    | AcceptanceEvidenceRegistryEntry
    | AcceptanceGoalRegistryEntry
}

export interface AcceptanceExportRow {
  acceptanceId: string
  channel: 'mcp' | 'web'
  configSnapshotVersion: string
  decisionPath: string
  httpStatus: number
  passed: boolean
  testCaseId: string
}

const reportSections = {
  acceptance: ['4.1.1'],
  evidence: ['第三章補充證據項目'],
  testCase: ['附錄 B', '4.1.1'],
}

const testCaseRegistryEntries: AcceptanceCaseRegistryEntry[] = [
  createTestCaseEntry(
    'TC-01',
    'PO 與 PR 差異定義題',
    ['A02'],
    ['web', 'mcp'],
    1759,
    '200',
    'direct'
  ),
  createTestCaseEntry('TC-02', '庫存不足 SOP 題', ['A02'], ['web', 'mcp'], 1760, '200', 'direct'),
  createTestCaseEntry('TC-03', '報表欄位定義題', ['A02'], ['web', 'mcp'], 1761, '200', 'direct'),
  createTestCaseEntry(
    'TC-04',
    '模糊查詢 self-correction 題',
    ['A05'],
    ['web', 'mcp'],
    1762,
    '200',
    'self_corrected'
  ),
  createTestCaseEntry('TC-05', 'Web 多輪追問語境延續', ['A02'], ['web'], 1763, '200', 'direct'),
  createTestCaseEntry('TC-06', '跨文件比較題', ['A02'], ['web', 'mcp'], 1764, '200', 'judge_pass'),
  createTestCaseEntry('TC-07', '知識庫外拒答題', ['A06'], ['web', 'mcp'], 1765, '200', 'refused'),
  createTestCaseEntry('TC-08', '系統能力外拒答題', ['A06'], ['web', 'mcp'], 1766, '200', 'refused'),
  createTestCaseEntry(
    'TC-09',
    '高風險敏感資料阻擋題',
    ['A06', 'A11'],
    ['web', 'mcp'],
    1767,
    '200',
    'refused'
  ),
  createTestCaseEntry('TC-10', '制度查詢題', ['A02'], ['web', 'mcp'], 1768, '200', 'direct'),
  createTestCaseEntry('TC-11', '條件式程序題', ['A02'], ['web', 'mcp'], 1769, '200', 'direct'),
  createTestCaseEntry(
    'TC-12',
    'MCP answer-to-replay 工具鏈',
    ['A03', 'A07'],
    ['mcp'],
    1770,
    '200 / 200',
    'direct'
  ),
  createTestCaseEntry(
    'TC-13',
    'restricted citation scope 阻擋',
    ['A09'],
    ['mcp'],
    1771,
    '403',
    '403'
  ),
  createTestCaseEntry(
    'TC-14',
    'Admin Web restricted 可讀',
    ['A10'],
    ['web'],
    1772,
    '200',
    'direct'
  ),
  createTestCaseEntry(
    'TC-15',
    '高風險原文不落地治理',
    ['A06', 'A09', 'A11'],
    ['web'],
    1773,
    '200',
    'refused'
  ),
  createTestCaseEntry(
    'TC-16',
    'searchKnowledge no-hit 契約',
    ['A07'],
    ['mcp'],
    1774,
    '200',
    '200_empty'
  ),
  createTestCaseEntry(
    'TC-17',
    'restricted existence-hiding',
    ['A09'],
    ['mcp'],
    1775,
    '200',
    'refused_or_empty'
  ),
  createTestCaseEntry(
    'TC-18',
    'current-version-only 切版驗證',
    ['A04'],
    ['web', 'mcp'],
    1776,
    '200',
    'refused_or_new_version_only'
  ),
  createTestCaseEntry('TC-19', 'listCategories 計數規則', ['A07'], ['mcp'], 1777, '200', 'direct'),
  createTestCaseEntry(
    'TC-20',
    'MCP no-internal-diagnostics 契約',
    ['A12'],
    ['mcp'],
    1778,
    '200',
    'direct'
  ),
]

const acceptanceRegistryEntries: AcceptanceGoalRegistryEntry[] = [
  createAcceptanceEntry('A01', '邊緣原生架構可部署', ['EV-01'], [], ['1.2.1', '1.3.2'], 1470),
  createAcceptanceEntry(
    'A02',
    '完成 AI Search 與自建 Agent 流程整合',
    ['EV-01'],
    ['TC-01', 'TC-04', 'TC-06'],
    ['1.2.1', '2.1.2'],
    1471
  ),
  createAcceptanceEntry(
    'A03',
    'citationId 可回放且 source_chunks 對應正確',
    ['EV-03'],
    ['TC-12'],
    ['2.2.1', '2.2.5'],
    1472
  ),
  createAcceptanceEntry(
    'A04',
    '僅 current 版本與 active 文件參與正式回答',
    ['EV-03'],
    ['TC-18'],
    ['1.3.2', '2.2.4'],
    1473
  ),
  createAcceptanceEntry(
    'A05',
    'Self-Correction 可改善模糊查詢',
    [],
    ['TC-04'],
    ['2.1.2', '2.4.4'],
    1474
  ),
  createAcceptanceEntry(
    'A06',
    '拒答機制可正確阻擋越界或高風險查詢',
    [],
    ['TC-07', 'TC-08', 'TC-09', 'TC-15'],
    ['1.2.2', '2.4.1'],
    1475
  ),
  createAcceptanceEntry(
    'A07',
    'MCP 4 個 Tools 可被外部 Client 正常使用',
    [],
    ['TC-12', 'TC-16', 'TC-17', 'TC-19', 'TC-20'],
    ['2.2.2', '3.2.2'],
    1476
  ),
  createAcceptanceEntry(
    'A08',
    'Google OAuth 與 ADMIN_EMAIL_ALLOWLIST 正常運作',
    ['EV-02'],
    [],
    ['2.4.1', '3.2.2'],
    1477
  ),
  createAcceptanceEntry(
    'A09',
    'restricted scope 與記錄遮罩規則正常運作',
    [],
    ['TC-13', 'TC-15', 'TC-17'],
    ['2.4.1', '2.4.4'],
    1478
  ),
  createAcceptanceEntry(
    'A10',
    'Admin Web 問答可讀 restricted 且 MCP 隔離正確',
    [],
    ['TC-14'],
    ['2.4.1', '3.3.1'],
    1479
  ),
  createAcceptanceEntry(
    'A11',
    '高風險輸入不會以原文寫入持久化紀錄',
    [],
    ['TC-15'],
    ['2.4.1', '2.4.4'],
    1480
  ),
  createAcceptanceEntry(
    'A12',
    '對外 MCP 契約不暴露內部診斷欄位',
    [],
    ['TC-20'],
    ['2.2.2', '附錄 A'],
    1481
  ),
  createAcceptanceEntry('A13', 'rate limit 與保留期限規則可被驗證', ['EV-04'], [], ['2.4.1'], 1482),
]

const evidenceRegistryEntries: AcceptanceEvidenceRegistryEntry[] = [
  createEvidenceEntry(
    'EV-01',
    '部署成功與核心閉環 smoke',
    ['A01', 'A02'],
    '部署紀錄、架構圖、上傳到問答的閉環操作錄影或截圖',
    1453
  ),
  createEvidenceEntry(
    'EV-02',
    'OAuth 與 allowlist 權限重算',
    ['A08'],
    '登入截圖、Session 權限比對紀錄、allowlist 異動前後操作結果',
    1454
  ),
  createEvidenceEntry(
    'EV-03',
    '發布流程、版本切換與 rollback',
    ['A03', 'A04'],
    'publish no-op、失敗 transaction、版本切換前後查詢紀錄',
    1455
  ),
  createEvidenceEntry(
    'EV-04',
    'rate limit 與 retention 清理',
    ['A13'],
    '`429` 測試紀錄、backdated record、清理作業日誌',
    1456
  ),
]

export const acceptanceRegistryManifest: AcceptanceRegistryManifest = {
  reportPath: 'main-v0.0.36.md',
  reportVersion: 'v0.0.36',
  summary: {
    acceptances: acceptanceRegistryEntries.length,
    evidence: evidenceRegistryEntries.length,
    testCases: testCaseRegistryEntries.length,
  },
}

export function listAcceptanceRegistryEntries(): Array<
  AcceptanceCaseRegistryEntry | AcceptanceEvidenceRegistryEntry | AcceptanceGoalRegistryEntry
> {
  return [...testCaseRegistryEntries, ...acceptanceRegistryEntries, ...evidenceRegistryEntries]
}

export function getAcceptanceRegistryEntry(
  id: string
):
  | AcceptanceCaseRegistryEntry
  | AcceptanceEvidenceRegistryEntry
  | AcceptanceGoalRegistryEntry
  | null {
  return listAcceptanceRegistryEntries().find((entry) => entry.id === id) ?? null
}

export function createAcceptanceRegistryMap(): AcceptanceRegistryEntryMap {
  return Object.fromEntries(listAcceptanceRegistryEntries().map((entry) => [entry.id, entry]))
}

export function createAcceptanceExportRow(
  input: Omit<AcceptanceExportRow, 'configSnapshotVersion'>,
  runtimeConfigInput: KnowledgeRuntimeConfigInput = {}
): AcceptanceExportRow {
  return {
    ...input,
    configSnapshotVersion:
      createKnowledgeRuntimeConfig(runtimeConfigInput).governance.configSnapshotVersion,
  }
}

function createTestCaseEntry(
  id: string,
  title: string,
  acceptanceIds: string[],
  channels: string[],
  sourceLine: number,
  expectedHttpStatus: string,
  primaryOutcome: string
): AcceptanceCaseRegistryEntry {
  return {
    acceptanceIds,
    channels,
    expectedHttpStatus,
    id,
    kind: 'test-case',
    primaryOutcome,
    reportSections: reportSections.testCase,
    sourceLine,
    title,
  }
}

function createAcceptanceEntry(
  id: string,
  title: string,
  evidenceIds: string[],
  caseIds: string[],
  chapterRefs: string[],
  sourceLine: number
): AcceptanceGoalRegistryEntry {
  return {
    caseIds,
    chapterRefs,
    evidenceIds,
    id,
    kind: 'acceptance',
    reportSections: reportSections.acceptance,
    sourceLine,
    title,
  }
}

function createEvidenceEntry(
  id: string,
  title: string,
  acceptanceIds: string[],
  evidenceForm: string,
  sourceLine: number
): AcceptanceEvidenceRegistryEntry {
  return {
    acceptanceIds,
    evidenceForm,
    id,
    kind: 'evidence',
    reportSections: reportSections.evidence,
    sourceLine,
    title,
  }
}
