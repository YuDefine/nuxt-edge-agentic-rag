export const DEMO_SEED_VERSION = 'v2026-05-04'

export const REQUIRED_DEMO_FEATURES = [
  'admin_dashboard',
  'document_library',
  'document_detail',
  'document_upload_replay',
  'ai_search_rag',
  'web_chat_history',
  'mcp_tokens',
  'query_logs',
  'debug_latency',
  'usage_analytics',
  'members_roles',
  'guest_policy',
  'access_control',
  'citation_replay',
] as const

export type DemoEnvironment = 'production' | 'staging'
type DemoFeatureId = (typeof REQUIRED_DEMO_FEATURES)[number]
type AccessLevel = 'internal' | 'restricted'
type DocumentStatus = 'active' | 'archived'
type TokenStatus = 'active' | 'expired' | 'revoked'
type QueryLogStatus = 'accepted' | 'blocked' | 'rejected' | 'limited'
type RewriterStatus =
  | 'disabled'
  | 'fallback_error'
  | 'fallback_parse'
  | 'fallback_timeout'
  | 'success'

export interface DemoSeedInput {
  environment: DemoEnvironment
  now?: Date
}

interface Section {
  heading: string
  lines: string[]
}

interface VersionBlueprint {
  sections: Section[]
  versionNumber: number
}

interface DocumentBlueprint {
  accessLevel: AccessLevel
  categorySlug: string
  slug: string
  status?: DocumentStatus
  title: string
  versions: VersionBlueprint[]
}

export interface DemoUser {
  banned: number
  banExpires: number | null
  banReason: string | null
  createdAt: number
  displayName: string
  email: string | null
  emailVerified: number
  id: string
  image: string | null
  name: string
  role: 'admin' | 'guest' | 'member'
  updatedAt: number
}

export interface DemoUserProfile {
  adminSource: 'allowlist' | 'none'
  createdAt: string
  displayName: string
  emailNormalized: string | null
  id: string
  roleSnapshot: 'admin' | 'guest' | 'member'
  updatedAt: string
}

export interface DemoDocument {
  accessLevel: AccessLevel
  archivedAt: string | null
  categorySlug: string
  createdAt: string
  createdByUserId: string
  currentVersionId: string | null
  id: string
  slug: string
  status: DocumentStatus
  title: string
  updatedAt: string
}

export interface DemoDocumentVersion {
  createdAt: string
  documentId: string
  id: string
  indexStatus: 'indexed'
  isCurrent: boolean
  metadataJson: string
  normalizedTextR2Key: string
  publishedAt: string | null
  smokeTestQueriesJson: string
  sourceR2Key: string
  syncStatus: 'completed'
  updatedAt: string
  versionNumber: number
}

export interface DemoSourceChunk {
  accessLevel: AccessLevel
  chunkHash: string
  chunkIndex: number
  chunkText: string
  citationLocator: string
  createdAt: string
  documentVersionId: string
  id: string
  metadataJson: string
}

export interface DemoR2Object {
  contentType: string
  customMetadata?: Record<string, string>
  key: string
  text: string
}

export interface DemoConversation {
  accessLevel: AccessLevel
  createdAt: string
  deletedAt: string | null
  id: string
  title: string
  updatedAt: string
  userProfileId: string
}

export interface DemoQueryLog {
  allowedAccessLevelsJson: string
  channel: 'mcp' | 'web'
  completionLatencyMs: number | null
  configSnapshotVersion: string
  createdAt: string
  decisionPath: string | null
  environment: DemoEnvironment
  firstTokenLatencyMs: number | null
  id: string
  judgeScore: number | null
  mcpTokenId: string | null
  queryRedactedText: string
  redactionApplied: boolean
  refusalReason: string | null
  retrievalScore: number | null
  rewrittenQuery: string | null
  rewriterStatus: RewriterStatus
  riskFlagsJson: string
  status: QueryLogStatus
  userProfileId: string | null
  workersAiRunsJson: string
}

export interface DemoMessage {
  channel: 'mcp' | 'web'
  citationsJson: string
  contentRedacted: string
  contentText: string | null
  conversationId: string | null
  createdAt: string
  id: string
  queryLogId: string | null
  redactionApplied: boolean
  refusalReason: string | null
  refused: boolean
  riskFlagsJson: string
  role: 'assistant' | 'system' | 'tool' | 'user'
  userProfileId: string | null
}

export interface DemoCitationRecord {
  chunkTextSnapshot: string
  citationLocator: string
  createdAt: string
  documentVersionId: string
  expiresAt: string
  id: string
  queryLogId: string
  sourceChunkId: string
}

export interface DemoMcpToken {
  createdAt: string
  createdByUserId: string
  environment: DemoEnvironment
  expiresAt: string | null
  id: string
  lastUsedAt: string | null
  name: string
  revokedAt: string | null
  revokedReason: string | null
  scopesJson: string
  status: TokenStatus
  tokenHash: string
}

export interface DemoFeatureCoverage {
  evidenceIds: string[]
  id: DemoFeatureId
  surfaces: string[]
}

export interface DemoSeedSummary {
  archivedDocuments: number
  citationRecords: number
  conversations: number
  currentDocuments: number
  documentVersions: number
  documents: number
  environment: DemoEnvironment
  featureCoverage: number
  mcpTokens: number
  memberRoleChanges: number
  messages: number
  queryLogs: number
  r2Objects: number
  seedKey: string
  sourceChunks: number
  users: number
}

export interface DemoSeed {
  accounts: Array<Record<string, string | number | null>>
  citationRecords: DemoCitationRecord[]
  conversations: DemoConversation[]
  documentVersions: DemoDocumentVersion[]
  documents: DemoDocument[]
  featureCoverage: DemoFeatureCoverage[]
  mcpTokens: DemoMcpToken[]
  memberRoleChanges: Array<Record<string, string | null>>
  messages: DemoMessage[]
  passkeys: Array<Record<string, string | number | null>>
  queryLogs: DemoQueryLog[]
  r2Objects: DemoR2Object[]
  sessions: Array<Record<string, string | null>>
  sourceChunks: DemoSourceChunk[]
  summary: DemoSeedSummary
  systemSettings: Array<Record<string, string>>
  userProfiles: DemoUserProfile[]
  users: DemoUser[]
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const DOCUMENT_BLUEPRINTS: DocumentBlueprint[] = [
  {
    accessLevel: 'internal',
    categorySlug: 'procurement',
    slug: 'procurement-playbook',
    title: '採購流程展示手冊',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('採購總覽', '2025 草案以 PR、PO、收貨、付款四個節點描述採購主流程。'),
          section('PR 申請', '需求單位需說明品名、預算科目、交期與驗收人。'),
          section('PO 核准', '採購人員比價後產生 PO，主管依金額級距核准。'),
          section('收貨驗收', '倉管與需求單位共同確認數量、規格與瑕疵。'),
        ],
      },
      {
        versionNumber: 2,
        sections: [
          section(
            '採購總覽',
            '展示版採購流程以 PR 建立、PO 核准、收貨驗收、發票付款與例外追蹤組成。',
          ),
          section('PR 申請', 'PR 必須包含需求原因、預算來源、交付日期、驗收標準與附件報價。'),
          section('PO 核准', 'PO 核准依金額分層，十萬元以下由部門主管核准，十萬元以上需財務複核。'),
          section('供應商比價', '三家以上比價需保存報價摘要；單一來源需寫明技術或合約限制。'),
          section('收貨驗收', '收貨後三個工作天內完成驗收，差異需建立待辦並通知採購窗口。'),
          section('發票與付款', '發票需對齊 PO、驗收紀錄與付款條件，缺一不可進入付款批次。'),
        ],
      },
    ],
  },
  {
    accessLevel: 'internal',
    categorySlug: 'hr',
    slug: 'leave-policy',
    title: '員工請假申請辦法',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('請假總則', '一般請假需於事前提出，緊急狀況可於當日補登。'),
          section('特休假', '特休以小時為單位，須避開團隊共同值班時段。'),
          section('病假', '連續兩日以上病假需附醫療證明。'),
          section('代理安排', '請假人需指定代理人並交接進行中的客戶或專案事項。'),
        ],
      },
      {
        versionNumber: 2,
        sections: [
          section('請假總則', '展示資料以特休、病假、公假、補休與代理安排說明完整請假流程。'),
          section('特休假', '特休需於三個工作天前提出；低於半日的申請可由直屬主管直接核准。'),
          section('病假', '病假可當日補登，連續兩日以上需附證明並註記預計復工日。'),
          section('公假與補休', '公假需附活動通知或主管指派紀錄，補休需連結加班核准單。'),
          section('代理安排', '代理人需能處理待回覆訊息、簽核節點與客戶時程。'),
          section('逾期補登', '逾期補登會進入 HR 待審清單，系統保留補登原因供稽核。'),
        ],
      },
    ],
  },
  {
    accessLevel: 'internal',
    categorySlug: 'finance',
    slug: 'travel-expense',
    title: '差旅費用報銷規範',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('差旅申請', '出差前需建立差旅申請，包含目的、地點、期間與預估費用。'),
          section('交通費', '高鐵、台鐵、計程車與租車需附票證或電子收據。'),
          section('住宿費', '住宿費依地區上限核銷，超額需主管事前同意。'),
          section('餐費與雜支', '餐費採每日上限，雜支需說明業務目的。'),
          section('報銷時限', '返程後十個工作天內送出報銷單並補齊附件。'),
          section('退件原因', '常見退件包含缺少發票、費用科目錯誤與日期不一致。'),
        ],
      },
    ],
  },
  {
    accessLevel: 'internal',
    categorySlug: 'hr',
    slug: 'onboarding-checklist',
    title: '新人入職指南',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('入職前準備', 'HR 需確認報到文件、帳號開通、座位安排與設備借用。'),
          section('第一天流程', '新人第一天完成公司介紹、資安宣導、設備點交與主管面談。'),
          section('系統帳號', 'SSO、Email、聊天工具與知識庫權限需於報到日前一天完成。'),
          section('試用期目標', '主管需在第一週設定三十、六十、九十日目標與回饋節點。'),
          section('導師制度', '每位新人指定一位導師協助文化、流程與常見問題。'),
          section('文件確認', '新人需閱讀請假、差旅、採購與資訊安全文件並完成確認。'),
        ],
      },
    ],
  },
  {
    accessLevel: 'internal',
    categorySlug: 'support',
    slug: 'ai-chat-user-guide',
    title: '知識問答使用手冊',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section(
            '提問方式',
            '使用者應以具體情境提問，例如「PR 和 PO 的差別」或「病假補登規則」。',
          ),
          section('引用來源', '回答應附引用，若系統找不到可信來源會明確拒答。'),
          section('敏感資訊', '問題包含身分證、電話或私人地址時，系統會遮罩後再記錄。'),
          section('限制範圍', '系統只回答知識庫內有依據的公司流程與制度問題。'),
          section('對話歷史', '使用者可回到近期對話，查看問題、回答、引用與拒答原因。'),
          section('回報問題', '回答不完整時可提供缺漏文件名稱，管理員會補充資料。'),
        ],
      },
    ],
  },
  {
    accessLevel: 'internal',
    categorySlug: 'analytics',
    slug: 'report-dashboard-guide',
    title: '管理報表與使用量儀表板指南',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('使用量概覽', '儀表板顯示近七日查詢量、文件數、活躍 token 與錯誤趨勢。'),
          section('查詢趨勢', 'Usage 頁面以日為單位呈現 web 與 MCP 查詢量，協助判斷展示熱度。'),
          section(
            '延遲觀察',
            'Debug latency 顯示首 token、完成時間、retrieval score 與 judge score。',
          ),
          section('拒答分類', '拒答會分為無引用、權限不足、敏感資料與查詢範圍外。'),
          section(
            '資料解讀',
            '展示資料需同時包含成功、拒答、遮罩與低分 fallback 才能完整檢查 UI。',
          ),
          section('稽核匯出', 'Query log detail 保留 decision path、模型執行與 citation replay。'),
        ],
      },
    ],
  },
  {
    accessLevel: 'internal',
    categorySlug: 'governance',
    slug: 'document-governance',
    title: '文件治理與發布規範',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('文件狀態', '文件可能處於草稿、已發布、封存或待重新索引狀態。'),
          section('版本管理', '每次上傳都建立新版本，只有 current version 會進入正式回答範圍。'),
          section('索引同步', '發布後系統會寫入 R2 chunk metadata，再觸發 AI Search 同步工作。'),
          section(
            '權限層級',
            'internal 文件提供成員與管理員查詢，restricted 文件只提供高權限路徑。',
          ),
          section('刪除與封存', '封存文件保留歷史與稽核資料，但不會被一般檢索命中。'),
          section('展示檢查', '展示前需確認 D1、R2、AI Search 和引用 replay 四層資料一致。'),
        ],
      },
    ],
  },
  {
    accessLevel: 'restricted',
    categorySlug: 'integration',
    slug: 'mcp-connector-playbook',
    title: 'MCP Connector 展示手冊',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section(
            'Token 生命週期',
            'MCP token 需顯示 active、revoked、expired 三種狀態供管理員檢查。',
          ),
          section(
            '工具呼叫',
            'askKnowledge 回答知識問題，searchKnowledge 回傳候選文件與 citation locator。',
          ),
          section('權限範圍', 'Token scopes 會限制工具、環境與可查詢的 access level。'),
          section('SSE 連線', '展示時可使用 SSE client 驗證 session 建立、心跳與工具結果。'),
          section(
            '撤銷行為',
            '撤銷 token 後既有 session 應失效，query log 保留但 token attribution 可為 null。',
          ),
          section(
            '稽核欄位',
            'MCP query log 需包含 token、channel、allowed access levels 與拒答分類。',
          ),
        ],
      },
    ],
  },
  {
    accessLevel: 'internal',
    categorySlug: 'ops',
    slug: 'incident-response-runbook',
    title: '系統事件應變 Runbook',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('事件分級', 'P0 代表服務不可用，P1 代表核心功能受影響，P2 代表局部退化。'),
          section('初始確認', '先確認 HTTP health、D1 查詢、R2 物件與 AI Search stats。'),
          section(
            '資料層檢查',
            '若回答無引用，需比對 source_chunks、R2 metadata 與 index sync job。',
          ),
          section('回復策略', '先恢復讀取路徑，再補查詢日志與缺漏文件。'),
          section('對外溝通', '每十五分鐘更新一次影響範圍、已知根因與下一個檢查點。'),
          section('事後檢討', '事件後需登記 tech debt、更新 runbook 並補 acceptance fixture。'),
        ],
      },
    ],
  },
  {
    accessLevel: 'restricted',
    categorySlug: 'security',
    slug: 'security-pii-governance',
    title: '資安與個資遮罩規範',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('個資類型', '身分證、電話、私人地址、薪資與醫療內容都屬於敏感資訊。'),
          section('輸入遮罩', 'query log 儲存前需遮罩個資，保留風險旗標與 redaction_applied。'),
          section('回答限制', '模型不得復述使用者提供的敏感資料，引用也需避免暴露個資。'),
          section('權限控管', 'restricted 文件只允許管理員或明確授權 token 查詢。'),
          section('稽核留存', '拒答與遮罩事件需保留 decision path，方便管理員追查。'),
          section(
            '展示案例',
            '展示資料需包含一筆電話遮罩、一筆 restricted blocked 與一筆安全拒答。',
          ),
        ],
      },
    ],
  },
  {
    accessLevel: 'restricted',
    categorySlug: 'finance',
    slug: 'finance-budget-forecast',
    title: '年度預算與財務預測樣本',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('預算摘要', '2026 展示預算分為人事、雲端服務、採購與訓練四大科目。'),
          section('雲端費用', 'AI Search、Workers AI、R2 與 D1 的展示成本需分開估算。'),
          section('採購預留', '大型設備採購需預留百分之十的價格波動與匯率緩衝。'),
          section('審批規則', '超過年度科目上限的申請需財務主管與營運主管共同核准。'),
          section('敏感範圍', '預算資料僅限 restricted access，普通成員只能看到公開摘要。'),
          section('報表節奏', '月結後三個工作天產生預算偏差報表，供經營會議檢視。'),
        ],
      },
    ],
  },
  {
    accessLevel: 'internal',
    categorySlug: 'archive',
    slug: 'legacy-procurement-2024',
    status: 'archived',
    title: '2024 舊版採購辦法封存樣本',
    versions: [
      {
        versionNumber: 1,
        sections: [
          section('封存原因', '此文件保留用於展示 archived 狀態，不應出現在一般 RAG 回答。'),
          section('舊版流程', '舊版只要求兩家比價，已被 2026 展示手冊取代。'),
          section('歷史查詢', '管理員可在文件 detail 查看版本和封存時間。'),
          section('引用限制', '封存文件的 R2 metadata 不標記為 active current。'),
          section('稽核用途', '保留舊版可測試文件列表的狀態 badge 與篩選。'),
          section('資料邊界', '封存樣本不會被一般使用者的回答引用。'),
        ],
      },
    ],
  },
]

export async function buildDemoSeed(input: DemoSeedInput): Promise<DemoSeed> {
  const now = input.now ?? new Date()
  const seedKey = getSeedKey(input.environment)
  const users = buildUsers(input.environment, now)
  const userProfiles = buildUserProfiles(users, now)
  const adminProfileId = `${prefix(input.environment)}user-admin`
  const documentBundle = await buildDocumentBundle({
    adminProfileId,
    environment: input.environment,
    now,
    seedKey,
  })
  const mcpTokens = buildMcpTokens(input.environment, now, users[0]!.id)
  const queryLogs = buildQueryLogs({
    environment: input.environment,
    mcpTokens,
    now,
    users,
  })
  const citationRecords = buildCitationRecords({
    queryLogs,
    sourceChunks: documentBundle.sourceChunks,
    versions: documentBundle.documentVersions,
    now,
  })
  const conversations = buildConversations(input.environment, now, users)
  const messages = buildMessages({
    citationRecords,
    conversations,
    environment: input.environment,
    now,
    queryLogs,
    users,
  })
  const featureCoverage = buildFeatureCoverage({
    citationRecords,
    conversations,
    documents: documentBundle.documents,
    mcpTokens,
    queryLogs,
    users,
  })
  const seed: DemoSeed = {
    accounts: buildAccounts(users, now),
    citationRecords,
    conversations,
    documentVersions: documentBundle.documentVersions,
    documents: documentBundle.documents,
    featureCoverage,
    mcpTokens,
    memberRoleChanges: buildMemberRoleChanges(input.environment, now, users),
    messages,
    passkeys: buildPasskeys(users, now),
    queryLogs,
    r2Objects: documentBundle.r2Objects,
    sessions: buildSessions(users, now),
    sourceChunks: documentBundle.sourceChunks,
    summary: {
      ...summarizePartial({
        citationRecords,
        conversations,
        documentVersions: documentBundle.documentVersions,
        documents: documentBundle.documents,
        featureCoverage,
        mcpTokens,
        memberRoleChanges: buildMemberRoleChanges(input.environment, now, users),
        messages,
        queryLogs,
        r2Objects: documentBundle.r2Objects,
        sourceChunks: documentBundle.sourceChunks,
        users,
      }),
      environment: input.environment,
      seedKey,
    },
    systemSettings: buildSystemSettings(input.environment, now, seedKey),
    userProfiles,
    users,
  }

  return {
    ...seed,
    summary: summarizeDemoSeed(seed),
  }
}

export function summarizeDemoSeed(
  seed: Pick<
    DemoSeed,
    | 'citationRecords'
    | 'conversations'
    | 'documentVersions'
    | 'documents'
    | 'featureCoverage'
    | 'mcpTokens'
    | 'memberRoleChanges'
    | 'messages'
    | 'queryLogs'
    | 'r2Objects'
    | 'sourceChunks'
    | 'summary'
    | 'users'
  >,
): DemoSeedSummary {
  return {
    ...summarizePartial(seed),
    environment: seed.summary.environment,
    seedKey: seed.summary.seedKey,
  }
}

function summarizePartial(
  seed: Pick<
    DemoSeed,
    | 'citationRecords'
    | 'conversations'
    | 'documentVersions'
    | 'documents'
    | 'featureCoverage'
    | 'mcpTokens'
    | 'memberRoleChanges'
    | 'messages'
    | 'queryLogs'
    | 'r2Objects'
    | 'sourceChunks'
    | 'users'
  >,
): Omit<DemoSeedSummary, 'environment' | 'seedKey'> {
  return {
    archivedDocuments: seed.documents.filter((document) => document.status === 'archived').length,
    citationRecords: seed.citationRecords.length,
    conversations: seed.conversations.length,
    currentDocuments: seed.documents.filter((document) => document.status === 'active').length,
    documentVersions: seed.documentVersions.length,
    documents: seed.documents.length,
    featureCoverage: seed.featureCoverage.length,
    mcpTokens: seed.mcpTokens.length,
    memberRoleChanges: seed.memberRoleChanges.length,
    messages: seed.messages.length,
    queryLogs: seed.queryLogs.length,
    r2Objects: seed.r2Objects.length,
    sourceChunks: seed.sourceChunks.length,
    users: seed.users.length,
  }
}

function section(heading: string, ...lines: string[]): Section {
  return { heading, lines }
}

function getSeedKey(environment: DemoEnvironment): string {
  return `demo-${environment}-${DEMO_SEED_VERSION}`
}

function prefix(environment: DemoEnvironment): string {
  return `demo-${environment}-`
}

function iso(now: Date, offsetHours = 0): string {
  return new Date(now.getTime() + offsetHours * HOUR_MS).toISOString()
}

function epochMs(now: Date, offsetDays = 0): number {
  return now.getTime() + offsetDays * DAY_MS
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

function buildUsers(environment: DemoEnvironment, now: Date): DemoUser[] {
  const idPrefix = prefix(environment)
  return [
    {
      banned: 0,
      banExpires: null,
      banReason: null,
      createdAt: epochMs(now, -32),
      displayName: `展示管理員 ${environment}`,
      email: `demo.admin.${environment}@example.com`,
      emailVerified: 1,
      id: `${idPrefix}user-admin`,
      image: null,
      name: '展示管理員',
      role: 'admin',
      updatedAt: epochMs(now, -1),
    },
    {
      banned: 0,
      banExpires: null,
      banReason: null,
      createdAt: epochMs(now, -25),
      displayName: `採購成員 ${environment}`,
      email: `demo.procurement.${environment}@example.com`,
      emailVerified: 1,
      id: `${idPrefix}user-procurement`,
      image: null,
      name: '採購成員',
      role: 'member',
      updatedAt: epochMs(now, -2),
    },
    {
      banned: 0,
      banExpires: null,
      banReason: null,
      createdAt: epochMs(now, -18),
      displayName: `HR 成員 ${environment}`,
      email: `demo.hr.${environment}@example.com`,
      emailVerified: 1,
      id: `${idPrefix}user-hr`,
      image: null,
      name: 'HR 成員',
      role: 'member',
      updatedAt: epochMs(now, -3),
    },
    {
      banned: 0,
      banExpires: null,
      banReason: null,
      createdAt: epochMs(now, -11),
      displayName: `訪客觀察員 ${environment}`,
      email: `demo.guest.${environment}@example.com`,
      emailVerified: 1,
      id: `${idPrefix}user-guest`,
      image: null,
      name: '訪客觀察員',
      role: 'guest',
      updatedAt: epochMs(now, -4),
    },
    {
      banned: 1,
      banExpires: epochMs(now, 14),
      banReason: '展示停權狀態',
      createdAt: epochMs(now, -8),
      displayName: `停權樣本 ${environment}`,
      email: `demo.suspended.${environment}@example.com`,
      emailVerified: 1,
      id: `${idPrefix}user-suspended`,
      image: null,
      name: '停權樣本',
      role: 'guest',
      updatedAt: epochMs(now, -1),
    },
  ]
}

function buildUserProfiles(users: DemoUser[], now: Date): DemoUserProfile[] {
  return users.map((user, index) => ({
    adminSource: user.role === 'admin' ? 'allowlist' : 'none',
    createdAt: iso(now, -24 * (30 - index)),
    displayName: user.displayName,
    emailNormalized: user.email?.toLowerCase() ?? null,
    id: user.id,
    roleSnapshot: user.role,
    updatedAt: iso(now, -index - 1),
  }))
}

async function buildDocumentBundle(input: {
  adminProfileId: string
  environment: DemoEnvironment
  now: Date
  seedKey: string
}): Promise<{
  documentVersions: DemoDocumentVersion[]
  documents: DemoDocument[]
  r2Objects: DemoR2Object[]
  sourceChunks: DemoSourceChunk[]
}> {
  const documents: DemoDocument[] = []
  const documentVersions: DemoDocumentVersion[] = []
  const sourceChunks: DemoSourceChunk[] = []
  const r2Objects: DemoR2Object[] = []
  const idPrefix = prefix(input.environment)

  for (let documentIndex = 0; documentIndex < DOCUMENT_BLUEPRINTS.length; documentIndex += 1) {
    const blueprint = DOCUMENT_BLUEPRINTS[documentIndex]!
    const documentId = `${idPrefix}doc-${blueprint.slug}`
    const status = blueprint.status ?? 'active'
    const currentVersionNumber = Math.max(
      ...blueprint.versions.map((version) => version.versionNumber),
    )
    const currentVersionId =
      status === 'active' ? `${idPrefix}ver-${blueprint.slug}-v${currentVersionNumber}` : null
    const createdAt = iso(input.now, -24 * (20 - documentIndex))
    const updatedAt = iso(input.now, -documentIndex)

    documents.push({
      accessLevel: blueprint.accessLevel,
      archivedAt: status === 'archived' ? iso(input.now, -12) : null,
      categorySlug: blueprint.categorySlug,
      createdAt,
      createdByUserId: input.adminProfileId,
      currentVersionId,
      id: documentId,
      slug: `demo-${input.environment}-${blueprint.slug}`,
      status,
      title: blueprint.title,
      updatedAt,
    })

    for (const version of blueprint.versions) {
      const versionId = `${idPrefix}ver-${blueprint.slug}-v${version.versionNumber}`
      const isCurrent = status === 'active' && version.versionNumber === currentVersionNumber
      const sourceR2Key = `demo-seed/${input.environment}/source/${blueprint.slug}-v${version.versionNumber}.md`
      const normalizedTextR2Key = `normalized-text/${versionId}/`
      const content = buildMarkdown(blueprint.title, version.sections)
      const normalizedLines = normalizeMarkdown(content)
      const chunks = await buildChunks({
        accessLevel: blueprint.accessLevel,
        lines: normalizedLines,
        versionId,
      })
      const metadata = {
        accessLevel: blueprint.accessLevel,
        categorySlug: blueprint.categorySlug,
        demoSeed: input.seedKey,
        sourceMimeType: 'text/markdown',
        sourceObjectKey: sourceR2Key,
        title: blueprint.title,
        versionNumber: version.versionNumber,
      }
      const smokeTestQueries = version.sections.map((item) => item.heading).slice(0, 5)

      documentVersions.push({
        createdAt,
        documentId,
        id: versionId,
        indexStatus: 'indexed',
        isCurrent,
        metadataJson: json(metadata),
        normalizedTextR2Key,
        publishedAt: isCurrent ? updatedAt : null,
        smokeTestQueriesJson: json(smokeTestQueries),
        sourceR2Key,
        syncStatus: 'completed',
        updatedAt,
        versionNumber: version.versionNumber,
      })
      r2Objects.push({
        contentType: 'text/markdown; charset=utf-8',
        customMetadata: {
          demo_seed: input.seedKey,
          document_version_id: versionId,
          object_kind: 'source',
        },
        key: sourceR2Key,
        text: content,
      })

      for (const chunk of chunks) {
        const chunkId = `${versionId}-chunk-${String(chunk.chunkIndex + 1).padStart(2, '0')}`
        const statusMetadata =
          status === 'active' && isCurrent
            ? { status: 'active', version_state: 'current' }
            : {
                status: status === 'archived' ? 'archived' : 'inactive',
                version_state: status === 'archived' ? 'archived' : 'previous',
              }
        sourceChunks.push({
          accessLevel: blueprint.accessLevel,
          chunkHash: chunk.chunkHash,
          chunkIndex: chunk.chunkIndex,
          chunkText: chunk.chunkText,
          citationLocator: chunk.citationLocator,
          createdAt,
          documentVersionId: versionId,
          id: chunkId,
          metadataJson: json({
            demoSeed: input.seedKey,
            lineEnd: chunk.lineEnd,
            lineStart: chunk.lineStart,
          }),
        })
        r2Objects.push({
          contentType: 'text/plain; charset=utf-8',
          customMetadata: {
            access_level: blueprint.accessLevel,
            citation_locator: chunk.citationLocator,
            demo_seed: input.seedKey,
            document_version_id: versionId,
            ...statusMetadata,
          },
          key: `normalized-text/${versionId}/${String(chunk.chunkIndex + 1).padStart(4, '0')}.txt`,
          text: chunk.chunkText,
        })
      }
    }
  }

  return { documentVersions, documents, r2Objects, sourceChunks }
}

function buildMarkdown(title: string, sections: Section[]): string {
  return [
    `# ${title}`,
    '',
    ...sections.flatMap((item) => [`## ${item.heading}`, ...item.lines, '']),
  ]
    .join('\n')
    .trim()
}

function normalizeMarkdown(markdown: string): string[] {
  return markdown.split(/\r?\n/u).map((line) => {
    const trimmed = line.trim()
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/u)
    if (heading?.[1]) {
      return heading[1].trim()
    }
    return trimmed
      .replace(/^[-*+]\s+/u, '')
      .replace(/\[(?: |x)\]\s+/giu, '')
      .replace(/[*_`>#]+/gu, '')
      .trim()
  })
}

async function buildChunks(input: {
  accessLevel: AccessLevel
  lines: string[]
  versionId: string
}): Promise<
  Array<{
    chunkHash: string
    chunkIndex: number
    chunkText: string
    citationLocator: string
    lineEnd: number
    lineStart: number
  }>
> {
  const chunks: Array<{
    chunkHash: string
    chunkIndex: number
    chunkText: string
    citationLocator: string
    lineEnd: number
    lineStart: number
  }> = []
  let currentLines: string[] = []
  let lineStart = 1

  for (let index = 0; index < input.lines.length; index += 1) {
    const line = input.lines[index] ?? ''
    const lineNumber = index + 1
    if (!line) {
      if (currentLines.length > 0) {
        const chunkText = currentLines.join('\n')
        chunks.push({
          chunkHash: await sha256Hex(chunkText),
          chunkIndex: chunks.length,
          chunkText,
          citationLocator: `lines ${lineStart}-${lineNumber - 1}`,
          lineEnd: lineNumber - 1,
          lineStart,
        })
        currentLines = []
      }
      lineStart = lineNumber + 1
      continue
    }
    if (currentLines.length === 0) {
      lineStart = lineNumber
    }
    currentLines.push(line)
  }

  if (currentLines.length > 0) {
    const chunkText = currentLines.join('\n')
    chunks.push({
      chunkHash: await sha256Hex(chunkText),
      chunkIndex: chunks.length,
      chunkText,
      citationLocator: `lines ${lineStart}-${input.lines.length}`,
      lineEnd: input.lines.length,
      lineStart,
    })
  }

  return chunks
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function buildMcpTokens(
  environment: DemoEnvironment,
  now: Date,
  adminUserId: string,
): DemoMcpToken[] {
  const idPrefix = prefix(environment)
  return [
    {
      createdAt: iso(now, -120),
      createdByUserId: adminUserId,
      environment,
      expiresAt: iso(now, 24 * 30),
      id: `${idPrefix}token-ops-active`,
      lastUsedAt: iso(now, -2),
      name: '展示 MCP Token - 營運查詢',
      revokedAt: null,
      revokedReason: null,
      scopesJson: json(['ask:knowledge', 'search:knowledge', 'access:internal']),
      status: 'active',
      tokenHash: `${idPrefix}hash-ops-active`,
    },
    {
      createdAt: iso(now, -96),
      createdByUserId: adminUserId,
      environment,
      expiresAt: iso(now, 24 * 14),
      id: `${idPrefix}token-admin-active`,
      lastUsedAt: iso(now, -1),
      name: '展示 MCP Token - Restricted 管理',
      revokedAt: null,
      revokedReason: null,
      scopesJson: json([
        'ask:knowledge',
        'search:knowledge',
        'access:internal',
        'access:restricted',
      ]),
      status: 'active',
      tokenHash: `${idPrefix}hash-admin-active`,
    },
    {
      createdAt: iso(now, -72),
      createdByUserId: adminUserId,
      environment,
      expiresAt: iso(now, -4),
      id: `${idPrefix}token-expired`,
      lastUsedAt: iso(now, -30),
      name: '展示 MCP Token - 已過期',
      revokedAt: null,
      revokedReason: null,
      scopesJson: json(['ask:knowledge']),
      status: 'expired',
      tokenHash: `${idPrefix}hash-expired`,
    },
    {
      createdAt: iso(now, -48),
      createdByUserId: adminUserId,
      environment,
      expiresAt: iso(now, 24 * 7),
      id: `${idPrefix}token-revoked`,
      lastUsedAt: iso(now, -26),
      name: '展示 MCP Token - 已撤銷',
      revokedAt: iso(now, -20),
      revokedReason: '展示撤銷狀態',
      scopesJson: json(['search:knowledge']),
      status: 'revoked',
      tokenHash: `${idPrefix}hash-revoked`,
    },
  ]
}

function buildQueryLogs(input: {
  environment: DemoEnvironment
  mcpTokens: DemoMcpToken[]
  now: Date
  users: DemoUser[]
}): DemoQueryLog[] {
  const idPrefix = prefix(input.environment)
  const admin = input.users[0]!
  const procurement = input.users[1]!
  const hr = input.users[2]!
  const guest = input.users[3]!
  const activeOpsToken = input.mcpTokens[0]!
  const restrictedToken = input.mcpTokens[1]!
  const stagingRewriter = input.environment === 'staging'

  const specs: Array<{
    access: AccessLevel[]
    channel: 'mcp' | 'web'
    completion: number | null
    decision: string | null
    firstToken: number | null
    judge: number | null
    profile: DemoUser | null
    query: string
    redacted?: boolean
    refusal?: string | null
    retrieval: number | null
    rewritten?: string | null
    rewriter: RewriterStatus
    risk?: string[]
    status: QueryLogStatus
    token?: DemoMcpToken | null
  }> = [
    {
      access: ['internal'],
      channel: 'web',
      completion: 1860,
      decision: 'direct_answer',
      firstToken: 420,
      judge: 0.88,
      profile: procurement,
      query: 'PR 和 PO 的差別是什麼？',
      retrieval: 0.86,
      rewritten: stagingRewriter ? '採購流程 PR PO 差異 核准' : null,
      rewriter: stagingRewriter ? 'success' : 'disabled',
      status: 'accepted',
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: 1510,
      decision: 'direct_answer',
      firstToken: 380,
      judge: 0.84,
      profile: hr,
      query: '病假連續兩天要附什麼資料？',
      retrieval: 0.82,
      rewritten: stagingRewriter ? '病假 連續兩日 醫療證明 請假辦法' : null,
      rewriter: stagingRewriter ? 'success' : 'disabled',
      status: 'accepted',
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: 1740,
      decision: 'direct_answer',
      firstToken: 510,
      judge: 0.81,
      profile: procurement,
      query: '差旅返程後多久要送出報銷？',
      retrieval: 0.79,
      rewriter: 'disabled',
      status: 'accepted',
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: 2130,
      decision: 'direct_answer',
      firstToken: 580,
      judge: 0.77,
      profile: guest,
      query: '新人第一天需要完成哪些項目？',
      retrieval: 0.74,
      rewriter: stagingRewriter ? 'fallback_timeout' : 'disabled',
      status: 'accepted',
    },
    {
      access: ['internal'],
      channel: 'mcp',
      completion: 1320,
      decision: 'mcp_direct_answer',
      firstToken: 300,
      judge: 0.83,
      profile: null,
      query: 'searchKnowledge 查詢 MCP token 生命週期',
      retrieval: 0.8,
      rewriter: 'disabled',
      status: 'accepted',
      token: activeOpsToken,
    },
    {
      access: ['internal', 'restricted'],
      channel: 'mcp',
      completion: 1690,
      decision: 'restricted_direct_answer',
      firstToken: 440,
      judge: 0.86,
      profile: null,
      query: 'restricted access 可以查哪些預算資料？',
      retrieval: 0.84,
      rewriter: stagingRewriter ? 'success' : 'disabled',
      status: 'accepted',
      token: restrictedToken,
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: null,
      decision: 'restricted_blocked',
      firstToken: null,
      judge: null,
      profile: procurement,
      query: '請顯示年度預算敏感明細',
      refusal: 'restricted_scope',
      retrieval: null,
      rewriter: 'disabled',
      status: 'blocked',
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: 980,
      decision: 'no_citation_refuse',
      firstToken: 260,
      judge: 0.22,
      profile: hr,
      query: '公司寵物津貼是多少？',
      refusal: 'no_citation',
      retrieval: 0.18,
      rewriter: stagingRewriter ? 'fallback_parse' : 'disabled',
      status: 'rejected',
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: null,
      decision: 'sensitive_input_blocked',
      firstToken: null,
      judge: null,
      profile: guest,
      query: '我的電話 [PHONE]，可以幫我查薪資嗎？',
      redacted: true,
      refusal: 'sensitive_governance',
      retrieval: null,
      rewriter: 'disabled',
      risk: ['phone', 'salary'],
      status: 'blocked',
    },
    {
      access: ['internal'],
      channel: 'mcp',
      completion: 1160,
      decision: 'tool_search_results',
      firstToken: 240,
      judge: 0.73,
      profile: null,
      query: '查詢 AI Search 同步與 R2 metadata',
      retrieval: 0.76,
      rewriter: 'disabled',
      status: 'accepted',
      token: activeOpsToken,
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: 2210,
      decision: 'self_correction_retry',
      firstToken: 650,
      judge: 0.7,
      profile: admin,
      query: 'Debug latency 頁面要看哪些數值？',
      retrieval: 0.71,
      rewritten: stagingRewriter
        ? 'debug latency first token completion retrieval judge score'
        : null,
      rewriter: stagingRewriter ? 'success' : 'disabled',
      status: 'accepted',
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: 1420,
      decision: 'direct_answer',
      firstToken: 330,
      judge: 0.79,
      profile: admin,
      query: 'query log detail 保留哪些稽核資料？',
      retrieval: 0.78,
      rewriter: 'disabled',
      status: 'accepted',
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: 1580,
      decision: 'direct_answer',
      firstToken: 350,
      judge: 0.82,
      profile: procurement,
      query: '收貨驗收差異要怎麼處理？',
      retrieval: 0.83,
      rewriter: stagingRewriter ? 'success' : 'disabled',
      status: 'accepted',
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: 1260,
      decision: 'direct_answer',
      firstToken: 290,
      judge: 0.76,
      profile: hr,
      query: '訪客政策有哪幾種？',
      retrieval: 0.72,
      rewriter: 'disabled',
      status: 'accepted',
    },
    {
      access: ['internal'],
      channel: 'mcp',
      completion: null,
      decision: 'token_revoked_blocked',
      firstToken: null,
      judge: null,
      profile: null,
      query: '使用已撤銷 token 查詢文件',
      refusal: 'token_revoked',
      retrieval: null,
      rewriter: 'disabled',
      status: 'blocked',
      token: input.mcpTokens[3],
    },
    {
      access: ['internal'],
      channel: 'web',
      completion: 1880,
      decision: 'direct_answer',
      firstToken: 470,
      judge: 0.8,
      profile: admin,
      query: '封存文件會被一般 RAG 回答引用嗎？',
      retrieval: 0.75,
      rewriter: 'disabled',
      status: 'accepted',
    },
  ]

  return specs.map((spec, index) => ({
    allowedAccessLevelsJson: json(spec.access),
    channel: spec.channel,
    completionLatencyMs: spec.completion,
    configSnapshotVersion: `${DEMO_SEED_VERSION}-${input.environment}`,
    createdAt: iso(input.now, -(index + 1) * 3),
    decisionPath: spec.decision,
    environment: input.environment,
    firstTokenLatencyMs: spec.firstToken,
    id: `${idPrefix}ql-${String(index + 1).padStart(2, '0')}`,
    judgeScore: spec.judge,
    mcpTokenId: spec.token?.id ?? null,
    queryRedactedText: spec.query,
    redactionApplied: spec.redacted ?? false,
    refusalReason: spec.refusal ?? null,
    retrievalScore: spec.retrieval,
    rewrittenQuery: spec.rewritten ?? null,
    rewriterStatus: spec.rewriter,
    riskFlagsJson: json(spec.risk ?? []),
    status: spec.status,
    userProfileId: spec.profile?.id ?? null,
    workersAiRunsJson: json(
      spec.firstToken === null
        ? []
        : [
            {
              latencyMs: Math.max(120, spec.firstToken - 80),
              model: '@cf/meta/llama-3.1-8b-instruct',
              modelRole: 'answer',
              usage: { inputTokens: 420 + index * 12, outputTokens: 160 + index * 7 },
            },
          ],
    ),
  }))
}

function buildCitationRecords(input: {
  now: Date
  queryLogs: DemoQueryLog[]
  sourceChunks: DemoSourceChunk[]
  versions: DemoDocumentVersion[]
}): DemoCitationRecord[] {
  const slugByQuery: Record<string, string> = {
    'ql-01': 'procurement-playbook',
    'ql-02': 'leave-policy',
    'ql-03': 'travel-expense',
    'ql-04': 'onboarding-checklist',
    'ql-05': 'mcp-connector-playbook',
    'ql-06': 'finance-budget-forecast',
    'ql-10': 'document-governance',
    'ql-11': 'report-dashboard-guide',
    'ql-12': 'report-dashboard-guide',
    'ql-13': 'procurement-playbook',
    'ql-14': 'document-governance',
    'ql-16': 'legacy-procurement-2024',
  }

  return input.queryLogs.flatMap((log, index) => {
    const querySuffix = log.id.slice(log.id.lastIndexOf('ql-'))
    const slug = slugByQuery[querySuffix]
    if (!slug || log.status !== 'accepted') {
      return []
    }
    const version = input.versions.find(
      (item) => item.id.includes(`ver-${slug}-`) && item.isCurrent,
    )
    const fallbackVersion = input.versions.find((item) => item.id.includes(`ver-${slug}-`))
    const selectedVersion = version ?? fallbackVersion
    if (!selectedVersion) {
      return []
    }
    const chunk =
      input.sourceChunks.find(
        (item) => item.documentVersionId === selectedVersion.id && item.chunkIndex === 0,
      ) ?? input.sourceChunks.find((item) => item.documentVersionId === selectedVersion.id)
    if (!chunk) {
      return []
    }
    return [
      {
        chunkTextSnapshot: chunk.chunkText,
        citationLocator: chunk.citationLocator,
        createdAt: log.createdAt,
        documentVersionId: selectedVersion.id,
        expiresAt: iso(input.now, 24 * 30),
        id: `${log.id}-citation-${String(index + 1).padStart(2, '0')}`,
        queryLogId: log.id,
        sourceChunkId: chunk.id,
      },
    ]
  })
}

function buildConversations(
  environment: DemoEnvironment,
  now: Date,
  users: DemoUser[],
): DemoConversation[] {
  const idPrefix = prefix(environment)
  const specs = [
    { access: 'internal' as const, title: '採購流程展示問答', user: users[1]! },
    { access: 'internal' as const, title: 'HR 請假與新人入職', user: users[2]! },
    { access: 'restricted' as const, title: 'Restricted 財務資料驗證', user: users[0]! },
    { access: 'internal' as const, title: '拒答與遮罩案例', user: users[3]! },
    { access: 'internal' as const, title: 'Debug 與報表檢查', user: users[0]! },
  ]
  return specs.map((spec, index) => ({
    accessLevel: spec.access,
    createdAt: iso(now, -(index + 1) * 10),
    deletedAt: null,
    id: `${idPrefix}conversation-${String(index + 1).padStart(2, '0')}`,
    title: spec.title,
    updatedAt: iso(now, -(index + 1)),
    userProfileId: spec.user.id,
  }))
}

function buildMessages(input: {
  citationRecords: DemoCitationRecord[]
  conversations: DemoConversation[]
  environment: DemoEnvironment
  now: Date
  queryLogs: DemoQueryLog[]
  users: DemoUser[]
}): DemoMessage[] {
  const idPrefix = prefix(input.environment)
  const byQuery = new Map(input.queryLogs.map((log) => [log.id, log]))
  const citationsByQuery = new Map<string, DemoCitationRecord[]>()
  for (const citation of input.citationRecords) {
    citationsByQuery.set(citation.queryLogId, [
      ...(citationsByQuery.get(citation.queryLogId) ?? []),
      citation,
    ])
  }
  const specs: Array<{
    content: string
    conversation: number
    query?: number
    refused?: boolean
    role: 'assistant' | 'user'
    user: DemoUser
  }> = [
    {
      content: 'PR 和 PO 的差別是什麼？',
      conversation: 0,
      query: 1,
      role: 'user',
      user: input.users[1]!,
    },
    {
      content:
        'PR 是需求申請，PO 是核准後對供應商發出的採購訂單；展示手冊也要求 PO 對齊比價與驗收紀錄。',
      conversation: 0,
      query: 1,
      role: 'assistant',
      user: input.users[1]!,
    },
    {
      content: '收貨驗收差異要怎麼處理？',
      conversation: 0,
      query: 13,
      role: 'user',
      user: input.users[1]!,
    },
    {
      content: '收貨後三個工作天內完成驗收，差異需建立待辦並通知採購窗口。',
      conversation: 0,
      query: 13,
      role: 'assistant',
      user: input.users[1]!,
    },
    {
      content: '病假連續兩天要附什麼資料？',
      conversation: 1,
      query: 2,
      role: 'user',
      user: input.users[2]!,
    },
    {
      content: '連續兩日以上病假需附證明並註記預計復工日。',
      conversation: 1,
      query: 2,
      role: 'assistant',
      user: input.users[2]!,
    },
    {
      content: '新人第一天需要完成哪些項目？',
      conversation: 1,
      query: 4,
      role: 'user',
      user: input.users[3]!,
    },
    {
      content: '第一天包含公司介紹、資安宣導、設備點交與主管面談。',
      conversation: 1,
      query: 4,
      role: 'assistant',
      user: input.users[3]!,
    },
    {
      content: 'restricted access 可以查哪些預算資料？',
      conversation: 2,
      query: 6,
      role: 'user',
      user: input.users[0]!,
    },
    {
      content: 'restricted 路徑可查年度預算摘要、雲端費用與審批規則，普通成員不應看到敏感明細。',
      conversation: 2,
      query: 6,
      role: 'assistant',
      user: input.users[0]!,
    },
    {
      content: '請顯示年度預算敏感明細',
      conversation: 3,
      query: 7,
      role: 'user',
      user: input.users[1]!,
    },
    {
      content: '這個問題需要 restricted 權限，目前無法提供敏感預算明細。',
      conversation: 3,
      query: 7,
      refused: true,
      role: 'assistant',
      user: input.users[1]!,
    },
    {
      content: '我的電話 [PHONE]，可以幫我查薪資嗎？',
      conversation: 3,
      query: 9,
      role: 'user',
      user: input.users[3]!,
    },
    {
      content: '我無法處理或復述個資與薪資敏感內容，請改以不含個資的流程問題詢問。',
      conversation: 3,
      query: 9,
      refused: true,
      role: 'assistant',
      user: input.users[3]!,
    },
    {
      content: 'Debug latency 頁面要看哪些數值？',
      conversation: 4,
      query: 11,
      role: 'user',
      user: input.users[0]!,
    },
    {
      content: '主要看首 token、完成時間、retrieval score、judge score 與 decision path。',
      conversation: 4,
      query: 11,
      role: 'assistant',
      user: input.users[0]!,
    },
    {
      content: 'query log detail 保留哪些稽核資料？',
      conversation: 4,
      query: 12,
      role: 'user',
      user: input.users[0]!,
    },
    {
      content: 'detail 保留 decision path、模型執行、allowed access levels 與 citation replay。',
      conversation: 4,
      query: 12,
      role: 'assistant',
      user: input.users[0]!,
    },
  ]

  return specs.map((spec, index) => {
    const queryLogId = spec.query ? `${idPrefix}ql-${String(spec.query).padStart(2, '0')}` : null
    const query = queryLogId ? byQuery.get(queryLogId) : null
    const citations = queryLogId ? (citationsByQuery.get(queryLogId) ?? []) : []
    return {
      channel: query?.channel ?? 'web',
      citationsJson: json(
        citations.map((citation) => ({
          citationLocator: citation.citationLocator,
          documentVersionId: citation.documentVersionId,
          excerpt: citation.chunkTextSnapshot.slice(0, 220),
          sourceChunkId: citation.sourceChunkId,
        })),
      ),
      contentRedacted: spec.content,
      contentText: spec.content,
      conversationId: input.conversations[spec.conversation]!.id,
      createdAt: iso(input.now, -(18 - index)),
      id: `${idPrefix}message-${String(index + 1).padStart(2, '0')}`,
      queryLogId,
      redactionApplied: query?.redactionApplied ?? false,
      refusalReason: spec.refused ? (query?.refusalReason ?? 'no_citation') : null,
      refused: spec.refused ?? false,
      riskFlagsJson: query?.riskFlagsJson ?? json([]),
      role: spec.role,
      userProfileId: spec.user.id,
    }
  })
}

function buildAccounts(
  users: DemoUser[],
  now: Date,
): Array<Record<string, string | number | null>> {
  return users.slice(0, 4).map((user, index) => ({
    accessToken: null,
    accessTokenExpiresAt: null,
    accountId: `google-${user.id}`,
    createdAt: epochMs(now, -20 + index),
    id: `${user.id}-account-google`,
    idToken: null,
    password: null,
    providerId: 'google',
    refreshToken: null,
    refreshTokenExpiresAt: null,
    scope: 'openid email profile',
    updatedAt: epochMs(now, -index),
    userId: user.id,
  }))
}

function buildSessions(users: DemoUser[], now: Date): Array<Record<string, string | null>> {
  return users.slice(0, 4).map((user, index) => ({
    createdAt: iso(now, -48 + index),
    expiresAt: iso(now, 24 * (7 + index)),
    id: `${user.id}-session`,
    ipAddress: `203.0.113.${20 + index}`,
    token: `${user.id}-session-token`,
    updatedAt: iso(now, -index - 1),
    userAgent: 'DemoBrowser/1.0',
    userId: user.id,
  }))
}

function buildPasskeys(
  users: DemoUser[],
  now: Date,
): Array<Record<string, string | number | null>> {
  return [users[0]!, users[2]!].map((user, index) => ({
    aaguid: `demo-aaguid-${index + 1}`,
    backedUp: 1,
    counter: index * 3,
    createdAt: epochMs(now, -12 + index),
    credentialID: `${user.id}-credential`,
    deviceType: 'multiDevice',
    id: `${user.id}-passkey`,
    name: index === 0 ? '管理員展示 Passkey' : 'HR 展示 Passkey',
    publicKey: `demo-public-key-${user.id}`,
    transports: 'internal,hybrid',
    userId: user.id,
  }))
}

function buildMemberRoleChanges(
  environment: DemoEnvironment,
  now: Date,
  users: DemoUser[],
): Array<Record<string, string | null>> {
  const idPrefix = prefix(environment)
  return [
    {
      changed_by: users[0]!.id,
      created_at: iso(now, -96),
      from_role: 'guest',
      id: `${idPrefix}role-change-01`,
      reason: '展示：採購窗口升級為 member',
      to_role: 'member',
      user_id: users[1]!.id,
    },
    {
      changed_by: users[0]!.id,
      created_at: iso(now, -72),
      from_role: 'guest',
      id: `${idPrefix}role-change-02`,
      reason: '展示：HR 成員完成審核',
      to_role: 'member',
      user_id: users[2]!.id,
    },
    {
      changed_by: users[0]!.id,
      created_at: iso(now, -48),
      from_role: 'member',
      id: `${idPrefix}role-change-03`,
      reason: '展示：外部觀察員降為 guest',
      to_role: 'guest',
      user_id: users[3]!.id,
    },
    {
      changed_by: users[0]!.id,
      created_at: iso(now, -24),
      from_role: 'guest',
      id: `${idPrefix}role-change-04`,
      reason: '展示：停權樣本維持 guest',
      to_role: 'guest',
      user_id: users[4]!.id,
    },
  ]
}

function buildSystemSettings(
  environment: DemoEnvironment,
  now: Date,
  seedKey: string,
): Array<Record<string, string>> {
  return [
    {
      key: 'guest_policy',
      updated_at: iso(now, -2),
      updated_by: `${prefix(environment)}user-admin`,
      value: 'same_as_member',
    },
    {
      key: `demo.${environment}.seed_version`,
      updated_at: iso(now),
      updated_by: 'demo-seed-script',
      value: seedKey,
    },
    {
      key: `demo.${environment}.feature_coverage`,
      updated_at: iso(now),
      updated_by: 'demo-seed-script',
      value: json(REQUIRED_DEMO_FEATURES),
    },
  ]
}

function buildFeatureCoverage(input: {
  citationRecords: DemoCitationRecord[]
  conversations: DemoConversation[]
  documents: DemoDocument[]
  mcpTokens: DemoMcpToken[]
  queryLogs: DemoQueryLog[]
  users: DemoUser[]
}): DemoFeatureCoverage[] {
  const activeDocument = input.documents.find((document) => document.status === 'active')!.id
  const restrictedDocument = input.documents.find(
    (document) => document.accessLevel === 'restricted',
  )!.id
  const acceptedLog = input.queryLogs.find((log) => log.status === 'accepted')!.id
  const blockedLog = input.queryLogs.find((log) => log.status === 'blocked')!.id
  const citation = input.citationRecords[0]!.id

  const rows: Record<DemoFeatureId, DemoFeatureCoverage> = {
    access_control: {
      evidenceIds: [restrictedDocument, blockedLog],
      id: 'access_control',
      surfaces: ['/chat', '/admin/query-logs', '/admin/debug/query-logs/[id]'],
    },
    admin_dashboard: {
      evidenceIds: [activeDocument, acceptedLog, input.mcpTokens[0]!.id],
      id: 'admin_dashboard',
      surfaces: ['/admin/dashboard'],
    },
    ai_search_rag: {
      evidenceIds: [activeDocument, citation],
      id: 'ai_search_rag',
      surfaces: ['/chat', 'MCP askKnowledge', 'MCP searchKnowledge'],
    },
    citation_replay: {
      evidenceIds: [citation],
      id: 'citation_replay',
      surfaces: ['/admin/query-logs/[id]', '/admin/debug/query-logs/[id]'],
    },
    debug_latency: {
      evidenceIds: [input.queryLogs.find((log) => log.firstTokenLatencyMs !== null)!.id],
      id: 'debug_latency',
      surfaces: ['/admin/debug/latency'],
    },
    document_detail: {
      evidenceIds: [activeDocument],
      id: 'document_detail',
      surfaces: ['/admin/documents/[id]'],
    },
    document_library: {
      evidenceIds: input.documents.slice(0, 4).map((document) => document.id),
      id: 'document_library',
      surfaces: ['/admin/documents'],
    },
    document_upload_replay: {
      evidenceIds: input.documents
        .slice(0, 2)
        .map((document) => document.currentVersionId ?? document.id),
      id: 'document_upload_replay',
      surfaces: ['/admin/documents/upload', '/admin/documents/[id]'],
    },
    guest_policy: {
      evidenceIds: ['guest_policy'],
      id: 'guest_policy',
      surfaces: ['/admin/settings/guest-policy', '/account-pending'],
    },
    mcp_tokens: {
      evidenceIds: input.mcpTokens.map((token) => token.id),
      id: 'mcp_tokens',
      surfaces: ['/admin/tokens', 'MCP SSE'],
    },
    members_roles: {
      evidenceIds: input.users.map((user) => user.id),
      id: 'members_roles',
      surfaces: ['/admin/members', '/account/settings'],
    },
    query_logs: {
      evidenceIds: [acceptedLog, blockedLog],
      id: 'query_logs',
      surfaces: ['/admin/query-logs', '/admin/query-logs/[id]'],
    },
    usage_analytics: {
      evidenceIds: input.queryLogs.slice(0, 7).map((log) => log.id),
      id: 'usage_analytics',
      surfaces: ['/admin/usage', '/admin/dashboard'],
    },
    web_chat_history: {
      evidenceIds: input.conversations.map((conversation) => conversation.id),
      id: 'web_chat_history',
      surfaces: ['/chat'],
    },
  }

  return REQUIRED_DEMO_FEATURES.map((featureId) => rows[featureId])
}
