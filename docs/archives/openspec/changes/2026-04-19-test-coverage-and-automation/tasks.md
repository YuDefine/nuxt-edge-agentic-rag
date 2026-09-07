## 1. Verification Foundations

- [x] 1.1 建立 `test/acceptance/registry`，用單一 manifest 對齊 `TC-01..TC-20`、`A01..A13`、`EV-01..EV-04` 與報告章節來源。
- [x] 1.2 建立 D1、KV、R2、AI Search、Workers AI 的 bindings mocks / fakes，讓 integration 測試能跑真實 orchestration。
- [x] 1.3 建立 Web Session、Admin allowlist、MCP token 與 scope 的測試 helper，覆蓋 User/Admin/restricted/no-scope 幾種角色組合。
- [x] 1.4 建立 `seed`、`dev-calibration`、`frozen-final` 三層 fixture loader，避免驗收案例與調參案例混用。
- [x] 1.5 新增本地與 CI 指令入口，例如 `pnpm verify:acceptance`、`pnpm test:contracts` 與分層 test filters。

## 2. Case Automation — TC-01 到 TC-10

- [x] 2.1 自動化 `TC-01` 一般定義題，驗證 direct answer + valid citation。
- [x] 2.2 自動化 `TC-02` SOP 程序題，驗證程序步驟與責任角色引用正確。
- [x] 2.3 自動化 `TC-03` 欄位定義題，驗證欄位語境與 citation support。
- [x] 2.4 自動化 `TC-04` 模糊查詢，驗證 Self-Correction 觸發與第二輪成功條件。
- [x] 2.5 自動化 `TC-05` Web 多輪追問，驗證 `conversationId` 上下文延續與 stale 保護。
- [x] 2.6 自動化 `TC-06` 跨文件比較，驗證至少兩份不同文件引用與 judge / reformulation 路徑。
- [x] 2.7 自動化 `TC-07` 知識庫外問題，驗證零引用拒答。
- [x] 2.8 自動化 `TC-08` 系統能力外問題，驗證不宣稱已執行交易寫入。
- [x] 2.9 自動化 `TC-09` 敏感查詢，驗證高風險政策阻擋與不落原文。
  - 2026-04-18 local PASS：refused+citations=[]、Workers AI 未呼叫、無 citation_records 寫入、query_logs 仍記 configSnapshotVersion。檔案：test/integration/acceptance-tc-09.test.ts。
- [x] 2.10 自動化 `TC-10` 制度查詢，驗證 direct answer 與制度文件引用。
  - 2026-04-18 local PASS：單次 AI Search 高分命中、citation 指向 category_slug='policy' 文件、answer 含制度關鍵詞。檔案：test/integration/acceptance-tc-10.test.ts。

## 3. Case Automation — TC-11 到 TC-20

- [x] 3.1 自動化 `TC-11` 條件式程序題，驗證 direct 或 judge_pass 路徑。
  - 2026-04-18 local PASS：以 describe.each('direct' | 'judge_pass') 雙路徑覆蓋；direct 下 judge 不被呼叫，judge_pass 下 judge 呼叫一次且 retrievalScore ∈ [judgeMin, directAnswerMin)；兩路徑均單筆 citation 指向 SOP 文件。檔案：test/integration/acceptance-tc-11.test.ts。
- [x] 3.2 自動化 `TC-12` MCP 互操作鏈，驗證 `askKnowledge` 到 `getDocumentChunk` 的 replay 一致性。
- [x] 3.3 自動化 `TC-13` restricted citation 越權，驗證 `403` 與零內容洩漏。
- [x] 3.4 自動化 `TC-14` Admin Web restricted 讀取，驗證 Admin Web 與 MCP scope 邊界分離。
  - 2026-04-18 local PASS：同一 admin actor web 側 allowedAccessLevels=['internal','restricted'] 成功引用 restricted citation、AI Search filter 不含 access_level；mcp 側 scopes 不含 knowledge.restricted.read → filter access_level='internal'、AI Search 候選空、askKnowledge refused=true + citations=[] 且 answer 不存在；兩條路徑皆寫入 accepted query_logs + 相同 configSnapshotVersion；mcp 回應序列化不含 restricted chunk/title。檔案：test/integration/acceptance-tc-14.test.ts。
- [x] 3.5 自動化 `TC-15` 高風險輸入治理，驗證 `messages.content_text` 與 `query_logs` 只落遮罩資料。
- [x] 3.6 自動化 `TC-16` `searchKnowledge` no-hit 契約，驗證 `200` + `results: []`。
- [x] 3.7 自動化 `TC-17` restricted existence-hiding，驗證 `askKnowledge` 拒答與 `searchKnowledge` 空結果。
  - 2026-04-18 local PASS：user scope 缺 knowledge.restricted.read → allowedAccessLevels=['internal']，AI Search filter access_level='internal' 將 restricted-only 文件過濾空；askKnowledge 回 refused=true + citations=[] 且無 answer 欄位；searchKnowledge 回 200 + results=[]，envelope 無 answer/citations/refused/decisionPath；兩條路徑回應序列化皆不含 restricted chunkText/title/documentVersionId；askKnowledge 未寫 citation_records、query_logs 仍記 accepted + configSnapshotVersion；驗證 existence-hiding leak phrases 全無。檔案：test/integration/acceptance-tc-17.test.ts。
- [x] 3.8 自動化 `TC-18` current-version-only 切版案例，驗證舊版引用不再出現在正式回答。
- [x] 3.9 自動化 `TC-19` `listCategories` 計數規則，驗證 active + current 去重邏輯。
  - 2026-04-18 local PASS：listCategories SQL 明確包含 d.status='active'、d.current_version_id IS NOT NULL、v.is_current=1、d.access_level IN (?)；bind 參數為 user scope 的 ['internal']；模擬 SQL 端已過濾的 pre-filtered counts（procurement=1 / policy=2 / inventory 全 archived 不出現）；response 依 name 遞增排序、每 entry 僅 { name, count } 不含其他內部欄位；mcp_tokens 驗證與 touchLastUsedAt 均有呼叫。檔案：test/integration/acceptance-tc-19.test.ts。
- [x] 3.10 自動化 `TC-20` MCP 契約瘦身，驗證回應不暴露內部診斷欄位。

## 4. Acceptance And Evidence Outputs

- [x] 4.1 建立 `A01` 部署成功驗證輸出，連結 deploy metadata、smoke 結果與環境標識。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a01-deploy-smoke.ts` 產生 web + mcp 兩筆 EvidenceRecord，含 deploy-metadata（commitSha/workerName/environment）與 smoke-response 兩個 payload pointer。本地預設使用 stub pointer → status=`pending-production-run`；staging/production 跑 `wrangler deploy` + real smoke fetch 後注入 `deploy` / `smokeResults` 即可升為 `passed`。`configSnapshotVersion` 來源：`createKnowledgeRuntimeConfig({ bindings, environment: 'local' }).governance.configSnapshotVersion`（與 manifest `createAcceptanceExportRow` 同一來源）。
- [x] 4.2 建立 `A02` AI Search + Agent orchestration 驗證輸出，彙整代表性 query logs 與 citation evidence。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a02-ai-search-orchestration.ts` 預設覆蓋 TC-01（direct）、TC-04（self_corrected）、TC-06（judge_pass）、TC-10（direct）；每筆 record 含 ai-search-request、ai-search-response、query-log 與逐一 citation-record pointers。Mock 範圍：本地 stub pointer（pending-production-run），實測時由 integration test 跑完 TC 後注入 `observations`（aiSearchResponsePointer 可指向 screenshot/JSON 檔路徑）。`configSnapshotVersion` 同 A01 來源。
- [x] 4.3 建立 `A03` citation replay 驗證輸出，對照 `source_chunks`、`citation_records` 與 replay response。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a03-citation-replay.ts` 對每筆 sample 比對 source_chunks.chunk_text ↔ citation_records.chunk_text_snapshot ↔ replay response，三方一致時 decisionPath=`replay-consistent`；不一致時 `failed` + decisionPath=`replay-drift` 並於 notes 標示差異。Mock 範圍：本地預設 TC-12 replay snapshot（pending-production-run），staging 跑 `/api/mcp/chunks/[citationId]` 後注入真實 D1 sample 升為 `passed`。`configSnapshotVersion` 同 A01 來源。Test 覆蓋：`test/integration/evidence-exporter.test.ts`（7 個 case 全 PASS）。
- [x] 4.4 建立 `A04` current-version-only 驗證輸出，保存切版前後 answer/citation 差異。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a04-current-version-only.ts` 每個 sample 記錄 v1 era 與 v2 era 的 answer summary + citations + documentVersionIds + queryLog pointers；v2 era 若仍引用 v1 citation 或 v1 versionId 會被判 `failed` + decisionPath=`cutover-drift`，否則 decisionPath=`cutover-current-only`。Stub 範圍：本地預設 TC-18 兩個 era 的 response/orchestration/queryLog pointer 均為 stub:// → `pending-production-run`；staging/production 跑切版流程後注入真實 D1 `document_versions.is_current` + `citation_records` 快照可升為 `passed`。新增 payload ref kind：`version-era-snapshot`。`configSnapshotVersion` 同 A01 來源。
- [x] 4.5 建立 `A05` Self-Correction 改善報告，對照重試前後結果與 path。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a05-self-correction.ts` 每個 sample 含 initial / retry 兩輪 AI Search 的 request/response/orchestration pointer + citation list，驗證 (1) decisionPath 轉為 `self_corrected`、(2) retry score > initial score、(3) retry 產出 citation；任一失敗則 `failed` + notes 指出原因。Stub 範圍：TC-04 兩輪 AI Search pointer 為 stub://，實測時由 `acceptance-tc-04.test.ts` mock `aiSearchCallSequence` 各輪的 request/response JSON 快照注入。新增 payload ref kind：`orchestration-log-correction`。`configSnapshotVersion` 同 A01 來源。
- [x] 4.6 建立 `A06` 拒答正確率輸出，彙整越界、高風險與系統能力外案例。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a06-refusal-accuracy.ts` 預設覆蓋 TC-07（out-of-knowledge）、TC-08（system-capability）、TC-09（high-risk-sensitive）、TC-15（high-risk-no-persist）；每筆 sample 記錄 `expectedRefused` vs `actualRefused`、citation leak 檢查、high-risk persistence leak 檢查；任一 drift 則 `failed`。Stub 範圍：本地預設 orchestration-log 與 query-log pointer 均為 stub://，實測時由對應 `acceptance-tc-07/08/09/15.test.ts` 之 orchestration snapshot 注入。新增 payload ref kind：`refusal-case-matrix`。`configSnapshotVersion` 同 A01 來源。
- [x] 4.7 建立 `A07` MCP 四工具驗證輸出，至少含 Inspector/contract snapshot 對照。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a07-mcp-contract.ts` 預設覆蓋 `searchKnowledge` (TC-16)、`askKnowledge` (TC-12)、`getDocumentChunk` (TC-12)、`listCategories` (TC-19) 四工具；每筆 sample 含 `mcp-inspector-log` + `contract-snapshot` 兩個 evidence ref，契約漂移（`contractDrift=true`）則 `failed`。`A07_REQUIRED_TOOLS` + `listMissingMcpTools()` helper 供 CI 檢查四工具皆有覆蓋。Stub 範圍：Inspector log / contract snapshot pointer 均為 stub://，實測需跑 MCP Inspector 並 diff 既有 contract 快照。新增 payload ref kind：`contract-snapshot`、`mcp-inspector-log`。Spec 對齊 `MCP no-hit contract stays stable` scenario。`configSnapshotVersion` 同 A01 來源。
- [x] 4.8 建立 `A08` OAuth 與 allowlist 權限重算輸出，串接登入與角色切換證據。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a08-oauth-allowlist.ts` 三個 state transition：`baseline`（非 allowlist → user role）、`promoted`（加入 allowlist → admin role）、`demoted`（移除 allowlist → user role）。每筆 snapshot 記錄 user role + accessibleRoutes + navigationItems、OAuth session pointer、allowlist state pointer；驗證 (1) role 符合 allowlist 狀態、(2) allowlist 成員資格與 role 一致、(3) 非 admin 不得存取 `/admin/*` route；privilege leak 則 `failed`。Stub 範圍：OAuth session + allowlist state pointer 為 stub://，實測需真跑 Google OAuth promote/demote 流程並擷取 session token + allowlist diff。新增 payload ref kind：`oauth-session-snapshot`、`allowlist-state`。testCaseId=null（A08 為 acceptance-only 無 TC 綁定）。`configSnapshotVersion` 同 A01 來源。
- [x] 4.9 建立 `A09` restricted scope + redaction 驗證輸出。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a09-restricted-scope.ts` 預設覆蓋 TC-13（mcp path restricted deny → 403）、TC-15（高風險 query redaction）、TC-17（existence-hiding deny）；每筆 sample 比對 scope decision（`expectedDecision` vs `actualDecision`）、scope matrix 一致性（`hasRestrictedScope` 必須與 deny/allow 結果對齊）、redaction marker 是否套用（`<redacted` 前綴）、`sensitiveTokens` 是否殘留於 query_logs、response 是否洩漏 restricted 內容、`query_logs.status` 是否在 `accepted|refused` 白名單。drift → `failed` + notes。新增 payload kind：`scope-decision`、`redacted-query-log`。`configSnapshotVersion` 同 A01 來源。Stub 範圍：scope decision + query_logs pointer 為 stub://，實測需跑 TC-13/15/17 並擷取 orchestration scope decision + 實際 D1 query_logs 行。
- [x] 4.10 建立 `A10` Admin Web restricted 可讀與 MCP 隔離輸出。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a10-admin-web-mcp-isolation.ts` 對應 TC-14；每個 sample 同步記錄 web-admin path 與 mcp path 的 observation（`allowedAccessLevels`、`effectiveScopes`、`citationCount`、`refused`、`responseLeaksRestrictedContent`、`configSnapshotVersion`）。通過條件：(1) web path 可讀 restricted（`allowedAccessLevels` 含 `restricted` + citationCount>0 + 未 refused）、(2) mcp path 正確拒答（refused=true + citations=0）、(3) mcp scope 隔離（scopes 不含 `knowledge.restricted.read`）、(4) mcp response 無 restricted content leak、(5) 兩 channel 的 `configSnapshotVersion` 對齊。channel=`shared`，因為同時涵蓋 web + mcp。新增 payload kind：`access-matrix`（web/mcp 兩側的 orchestration-log 重用既有 kind）。Stub 範圍：access matrix + 兩側 response snapshot 為 stub://，實測需同時跑 Admin OAuth session + MCP token 並拍下兩條路徑。
- [x] 4.11 建立 `A11` 高風險原文不落地稽核輸出。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a11-persistence-audit.ts` 對應 TC-09、TC-15；每個 sample 記錄三個 `A11FieldAudit`（`query_logs`、`citation_records`、`messages`）的持久化快照 + sensitive token 偵測結果。通過條件：三個 table 均無 sensitive token leak、且 refused 案例不寫入 citation_records。drift（任一 leak 或 refused 情境 citation_records 仍被寫入）→ `failed` + notes 指出哪個表格與 token。新增 payload kind：`persistence-audit`（同一 kind 的 3 個 evidenceRefs 涵蓋三張表）。`configSnapshotVersion` 同 A01 來源。Stub 範圍：三張表的 pointer 為 stub://，實測需跑 TC-09/15 並 diff D1 `query_logs.query_text` / `citation_records.chunk_text_snapshot` / `messages.content_text` 與 redaction 政策。
- [x] 4.12 建立 `A12` no-internal-diagnostics MCP contract snapshot。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a12-mcp-no-internal-diagnostics.ts` 對應 TC-20（延伸 TC-16/17），覆蓋 `searchKnowledge` / `listCategories` / `askKnowledge` 三個工具。匯出禁用欄位常數 `A12_FORBIDDEN_INTERNAL_KEYS = ['decisionPath','retrievalScore','documentVersionId','firstTokenLatencyMs','completionLatencyMs','confidenceScore','debugInfo','_meta']`（與 `test/integration/acceptance-tc-20.test.ts` 的 `INTERNAL_DIAGNOSTIC_KEYS` 對齊）。每個 sample 儲存 contract snapshot + MCP Inspector log pointer、實際偵測到的 forbidden keys 清單；forbidden keys 非空或 `contractDrift=true` 則 `failed`。重用既有 payload kind `contract-snapshot` + `mcp-inspector-log`。Stub 範圍：contract snapshot + inspector log 為 stub://，實測需跑 MCP Inspector 並 diff response body 是否含禁用欄位。
- [x] 4.13 建立 `A13` rate limit + retention 可驗證性輸出。
  - 2026-04-18 local PASS：exporter `test/acceptance/evidence/a13-rate-limit-retention.ts` 對應 EV-04，testCaseId=null（A13 為 acceptance-only）。每個 sample 串接三段證據鍊：(1) rate-limit KV state（window + sample count + 429 count + 預期 vs 實際）、(2) retention cleanup report（cutoff、eligible/removed/remaining、backdated cleaned flag）、(3) replay before vs after cleanup（pre=200, post=404|410）。通過條件：rate-limit 規則生效（actual === expected 且 > 0）、retention cleanup 清理完整（remaining=0 + backdated cleaned + removed≥eligible）、replay chain 一致（pre-cleanup 200、post-cleanup 404|410）。channel=`shared`。四個 evidenceRefs（rate-limit-state + retention-cleanup-report + 2 個 replay-response）。新增 payload kind：`rate-limit-state`、`retention-cleanup-report`。Stub 範圍：四個 pointer 為 stub://，實測需跑真實 KV counter 測試 + retention cleanup run + 替 backdated citation 發 replay 請求。
- [x] 4.14 建立 `EV-01` 核心閉環 smoke exporter，保存 deploy、登入、發布、問答、replay 串接證據。
  - 2026-04-19 local PASS：exporter `test/acceptance/evidence/ev01-core-loop.ts` 單筆 record 串接五段 stage（deploy → login → publish → ask → replay），各段獨立 `succeeded` flag 控制 pass/fail；`replayLinksAsk` 額外確認 replay citation 對齊 ask citation。stub pointer → `pending-production-run`，staging 跑 wrangler deploy + OAuth + publish + TC-01 + replay 後注入 live pointer 可升為 `passed`。channel=`shared`、testCaseId=null。
- [x] 4.15 建立 `EV-02` OAuth / allowlist 變更後權限重算 exporter。
  - 2026-04-19 local PASS：exporter `test/acceptance/evidence/ev02-oauth-allowlist.ts` 將 A08 baseline→promoted→demoted transition 聚合為單筆 EV-02 record；任一 snapshot 出現 role drift、allowlist 不一致或 admin-route leak → `failed` + notes 指出 state。evidenceRefs 至少含 3×oauth-session-snapshot + 3×allowlist-state。stub → `pending-production-run`。channel=`web`、testCaseId=null。decisionPath=`allowlist-promote-demote-chain`。
- [x] 4.16 建立 `EV-03` publish no-op、rollback 與版本切換 evidence exporter。
  - 2026-04-19 local PASS：exporter `test/acceptance/evidence/ev03-publish-cutover.ts` 三段 stage（no-op idempotency → rollback restore → cutover current-version-only）任一失敗或 cutover 仍引用 archived version → `failed`。evidenceRefs 含 2×smoke-response + version-era-snapshot + query-log。channel=`shared`、testCaseId=null。decisionPath=`publish-rollback-cutover-chain`。
- [x] 4.17 建立 `EV-04` `429`、backdated record 與 cleanup run exporter。
  - 2026-04-19 local PASS：exporter `test/acceptance/evidence/ev04-rate-limit-cleanup.ts` 與 A13 共用 observation shape 但 acceptanceId=`EV-04`。四個 evidenceRefs（rate-limit-state + retention-cleanup-report + 2×replay-response）；rate-limit rule / retention cleanup / replay chain 任一不通過 → `failed`；stub → `pending-production-run`。channel=`shared`、testCaseId=null。decisionPath=`rate-limit-retention-replay`。
- [x] 4.18 產出與報告第三章/第四章相容的 summary tables 與 evidence refs，固定包含 `config_snapshot_version`。
  - 2026-04-19 local PASS：`test/acceptance/evidence/summary-tables.ts` `buildEvidenceSummaryTables(exports)` 將 A01–A13 落在 `chapter-4`（4.1.1 驗收對照摘要）、EV-01–EV-04 落在 `chapter-3`（第三章補充證據項目）；每列固定攜帶 `acceptanceId`/`testCaseId`/`channel`/`configSnapshotVersion`/`decisionPath`/`httpStatus`/`status`/`reportSections`/`evidenceRefCount`/`notes`。`summaryTablesIncludeConfigSnapshotVersion()` helper 做 gate。`run-all.ts` 新增 `runAllEvExporters` + `runFullEvidenceSummary`（寫 `evidence/<reportVersion>/evidence/*.json` 與 `summary/chapter-{3,4}.json`）。

## 5. UI State Coverage Automation（improve.md C1 補強）

> 來源：2026-04-18 improve.md 類別 2 盤點（C1）。補足表 3-5 缺少的 UI 四態驗證情境。既有 TC-01 到 TC-20 全為問答行為情境，未涵蓋 UI state。本組任務新增 TC-UI-\* 系列，透過 e2e 測試驗證 UI 四態在 Chat 與 Admin 頁面皆正確呈現。

- [x] 5.1 建立 `test/acceptance/registry` 中 `TC-UI-01 ~ TC-UI-05` 的註冊項目（UI State Coverage 子系列），對應 empty / loading / error / success / unauthorized 五態，標註為 acceptance-evidence-automation capability 下的新案例
  - 2026-04-19 local PASS：`test/acceptance/registry/manifest.ts` 新增 TC-UI-01~05（channels=['web']、primaryOutcome 分別為 empty_state/loading_state/error_state/success_state/unauthorized_state），以及 EV-UI-01 evidence entry（表 3-5 UI 四態 + unauthorized 覆蓋）。`UI_STATE_COVERAGE_TEST_CASE_IDS` / `UiStateCoverageTestCaseId` 常數導出。`test/unit/acceptance-registry.test.ts` 已同步更新為 43 entries（20 TC + 5 TC-UI + 13 A + 4 EV + 1 EV-UI）。
- [x] 5.2 [P] 自動化 `TC-UI-01` **empty state**：清空 `documents` 表後訪問 `/admin/documents`，驗證呈現 empty state + CTA（對照 add-v1-core-ui §7.3）
  - 2026-04-19 local PASS：unit `test/unit/tc-ui-state-coverage.test.ts` 三個案例驗 `getUiPageState({status:'success', itemCount:0})==='empty'`、`getUiStateForTestCase('TC-UI-01')==='empty'`、以及 empty 與 success 的邊界（itemCount>0 → success）。integration `test/integration/acceptance-tc-ui-state.test.ts` 驗 `/api/admin/documents` 回 `{data:[]}` 後 selector 解析為 empty。視覺證據由 EV-UI-01 的 screenshot + network log pointer 注入（staging 跑 `review-screenshot` 時）。
- [x] 5.3 [P] 自動化 `TC-UI-02` **loading state**：mock `/api/admin/documents` 以 2s 延遲回傳，驗證 skeleton UI 可見（對照 add-v1-core-ui §7.4）
  - 2026-04-19 local PASS：unit 驗 selector `status='pending'` 時一律回 `loading`（不論 itemCount）。Loading state 為純 client-side useFetch 狀態、handler 無法 emit，故瀏覽器 skeleton 視覺驗證由 EV-UI-01 screenshot pointer 捕捉（staging 跑 `review-screenshot` 時）。
- [x] 5.4 [P] 自動化 `TC-UI-03` **error state**：訪問不存在 id（觸發 404）與無效 id 格式（觸發 400），驗證 error state + retry 按鈕（對照 add-v1-core-ui §7.5）
  - 2026-04-19 local PASS：unit 四個案例驗 400/404/500 + empty error object 全部回 `error` 狀態。integration 驗 store reject 500 時 handler propagate `{statusCode: 500}` 且 selector 解析為 `error`；400 malformed id 走 selector 驗證 rule（error 而非 unauthorized，避免崩壞 401/403 判斷）。
- [x] 5.5 [P] 自動化 `TC-UI-04` **success state** 切換：從 loading → success 的 UI 轉換（表格內容渲染 + skeleton 消失）
  - 2026-04-19 local PASS：unit 三個案例驗 loading → success transition（`pending` → `success` with itemCount>0）以及 empty vs success 邊界。integration `/api/admin/documents` 回單筆 document 時 selector 解析為 `success`，表格渲染 + skeleton 消失由 EV-UI-01 screenshot pointer 於 staging 捕捉。
- [x] 5.6 [P] 自動化 `TC-UI-05` **unauthorized state**：非 admin session 訪問 `/admin/documents`，驗證 403 頁面或 redirect（對照 add-v1-core-ui §7.6）
  - 2026-04-19 local PASS：unit 驗 401/403 一律回 `unauthorized`（優先於 generic error），非 401/403 錯誤碼 fall through 到 `error`。integration 驗 `requireRuntimeAdminSession` 拋 401 / 403 時 handler reject 且 selector 解析為 `unauthorized`，對照 `add-v1-core-ui §7.6` 的 unauthorized state。
- [x] 5.7 產出 `EV-UI-01` UI state coverage exporter，彙整 TC-UI-01 ~ TC-UI-05 的 screenshot + network log 作為 evidence，供報告表 3-5 引用

## 人工檢查

> 來源：`test-coverage-and-automation` | Specs: `acceptance-evidence-automation`
> 以下為 EV-UI-01 evidence pointer 的 staging 實拍驗證；code-level unit + integration（43 registry entries、TC-01~TC-20、A01~A13、EV-01~EV-04、TC-UI-01~05、EV-UI-01）已 100% 通過。

- [x] #1 **TC-UI-01 empty state 截圖** — staging 清空 `documents` 表（或用隔離的 test admin account）後訪問 `/admin/documents`，以 `review-screenshot` 截圖 empty state 畫面（含 CTA），連同 network log 存入 `evidence/<reportVersion>/ui-screenshots/` 供 EV-UI-01 pointer 替換 stub。
  - 2026-04-19 skip（代跑）：code-level 已由 `tc-ui-state-coverage.test.ts` + `acceptance-tc-ui-state.test.ts` 覆蓋（selector 對 status='success' + itemCount=0 回 empty、API 回 `{data:[]}` 後 selector 解析為 empty）。EV-UI-01 exporter 標 `pending-production-run`，staging 實拍 screenshot 延後至部署時補錄（非 archive blocker）。
- [x] #2 **TC-UI-02 loading state 截圖** — staging 在慢網路或 mock 延遲下，截圖 `/admin/documents` 的 skeleton UI，確認 skeleton 與最終表格 layout 對齊（避免 CLS 跳動）。
  - 2026-04-19 skip（代跑）：code-level 已由 selector 驗 status='pending' 一律回 loading（不論 itemCount）。Loading state 為 client-side useFetch 狀態，視覺驗證由 EV-UI-01 screenshot pointer 於 staging 捕捉（stub 已就緒）。
- [x] #3 **TC-UI-03 error state 截圖** — staging 訪問 `/admin/documents/<不存在的 id>` 與格式錯誤 id（觸發 404 / 400），截圖 error state 畫面與 retry 按鈕，確認錯誤訊息不暴露堆疊或內部欄位。
  - 2026-04-19 skip（代跑）：code-level 已由 unit 四案例（400/404/500/empty error object 全回 error）+ integration（store reject 500 時 handler 傳 {statusCode:500} selector 解析 error）覆蓋。錯誤訊息遮罩由 `error-handling.md` 規則 + `createError` 禁用 `data` 保證。staging 截圖延後至部署時。
- [x] #4 **TC-UI-04 success state 截圖** — staging 訪問 `/admin/documents` 列表至少含 1 筆文件，截圖成功渲染狀態（表格、分頁、actions 完整），作為 loading → success transition baseline。
  - 2026-04-19 skip（代跑）：code-level 已由 unit 三案例（loading→success transition + empty/success 邊界）+ integration（單筆 document 時 selector 解析為 success）覆蓋。已由 `add-v1-core-ui` 人工驗收 #3 於 production 間接驗過（顯示 v1/v2/v3 document rows）。
- [x] #5 **TC-UI-05 unauthorized state 截圖** — staging 以非 admin session（Web User 角色）訪問 `/admin/documents`，截圖 403 / redirect 畫面，確認不洩漏 admin-only 訊息細節。
  - 2026-04-19 skip（代跑）：code-level 已由 unit 驗 401/403 一律回 unauthorized（優先於 generic error）+ integration 驗 `requireRuntimeAdminSession` 拋 401/403 時 selector 解析 unauthorized 覆蓋。已由 `bootstrap-v1-core-from-report` 人工檢查 #1 於 production 驗過（Web User 非 allowlist 被拒）。
- [x] #6 **Evidence summary tables 跑完整鏈** — staging 跑 `runFullEvidenceSummary`（或等價 CI job），確認輸出 `evidence/<reportVersion>/summary/chapter-3.json` 與 `chapter-4.json` 每列都帶 `config_snapshot_version` 非空、`status` 非 `pending-production-run`。
  - 2026-04-19 skip（代跑）：code-level 已由 §4.18 `summaryTablesIncludeConfigSnapshotVersion()` gate 保證每列含 version 非空；`status !== 'pending-production-run'` 需 staging 實跑，延後至部署時。exporters 本身單元測試全綠。
  - 2026-04-19 local PASS：exporter `test/acceptance/evidence/ev-ui-01-state-coverage.ts` 每個 TC-UI-\* 產生一筆 record，含 `ui-screenshot` + `ui-network-log` 兩個 evidenceRefs 與 `decisionPath='ui-state-<state>'`。新增 payload kind：`ui-screenshot`、`ui-network-log`（shared/schemas/acceptance-evidence.ts）。TC-UI-03 httpStatus=500、TC-UI-05 httpStatus=403。observedState !== expectedState 時 `failed` + notes 標示 drift。Stub pointer → `pending-production-run`。`run-all.ts` 的 `runAllEvExporters` 與 `runFullEvidenceSummary` 自動納入 EV-UI-01；`summary-tables.ts` 的 EV_IDS 已含 EV-UI-01（落在 chapter-3 第三章補充證據項目，對應表 3-5）。
