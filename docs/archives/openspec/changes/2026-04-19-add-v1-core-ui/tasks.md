## 1. Navigation Shell

> 對應 design.md「Navigation Shell 架構」
> Note: 採用 `UNavigationMenu` in layouts 而非獨立 `AppSidebar` 元件，功能等效

- [x] 1.1 建立 `app/components/AppSidebar.vue` — 側邊導航元件，根據 `useUserRole()` 條件渲染項目
- [x] 1.2 修改 `app/layouts/default.vue` — 整合 `<AppSidebar>` 與主內容區塊
- [x] 1.3 定義 navigation items — Chat（所有已登入）、Documents（Admin）、Logout
- [x] 1.4 實作 Chat Page Access And Navigation — 首頁顯示 `/chat` 入口，未登入導向 login

## 2. 共用 UI 元件

> 對應 design.md「共用 StatusBadge 元件」
> Note: 採用分離的 Badge 元件（DocumentStatusBadge, VersionSyncBadge, VersionIndexBadge, AccessLevelBadge）而非統一 StatusBadge，更符合單一職責；DataTable 直接使用 UTable

- [x] 2.1 [P] 建立 `app/components/ui/StatusBadge.vue` — 支援 document/version/accessLevel 三種 type
- [x] 2.2 [P] 建立 `app/components/ui/DataTable.vue` — 封裝 `<UTable>` + server-side pagination/sorting

## 3. Chat 元件

> 對應 design.md「Chat 元件拆分」與「Chat Streaming 實作」
> Note: 元件命名略有不同但功能完整 — ConversationHistory, MessageList, MessageInput, StreamingMessage, RefusalMessage

- [x] 3.1 [P] 建立 `app/components/chat/ChatSidebar.vue` — 對話歷史列表，支援新建/切換
- [x] 3.2 [P] 建立 `app/components/chat/ChatMessage.vue` — 單則訊息（user/assistant 樣式）
- [x] 3.3 [P] 建立 `app/components/chat/ChatMessageList.vue` — 訊息清單，streaming 時顯示 typing indicator
- [x] 3.4 [P] 建立 `app/components/chat/ChatInput.vue` — 提問輸入區，送出時觸發 streaming
- [x] 3.5 [P] 建立 `app/components/chat/CitationMarker.vue` — 引用標記 `[1]`，可點擊
- [x] 3.6 [P] 建立 `app/components/chat/CitationReplayModal.vue` — 引用回放 Modal，顯示原文

## 4. Chat 頁面

> 實作 Persisted Conversation Chat UI、Streaming Answer And Refusal Display
> Note: MVP 採用單一 session 模式，對話 composable 邏輯 inline 在 Container.vue

- [x] 4.1 直接於 `app/components/chat/Container.vue` 使用 `@ai-sdk/vue` 的 `useChat` + conversationId 管理（改以 inline 取代獨立 `useChat.ts`）
- [x] 4.2 於 `app/components/chat/Container.vue` inline 對話列表 CRUD 邏輯（GET/POST /api/conversations，改以 inline 取代獨立 `useConversations.ts`）
- [x] 4.3 建立 `app/pages/chat/index.vue` — Chat 首頁，整合 sidebar + 空狀態引導
- [x] 4.4 建立 `app/pages/chat/[id].vue` — 對話詳情頁，整合 message list + input
- [x] 4.5 實作 Streaming Answer And Refusal Display — loading skeleton、逐 token 渲染、refusal 樣式，處理 Risk: Streaming 中斷處理（onError callback + 重試提示）
- [x] 4.6 實作 Citation Replay UI — 依 design.md「Citation Replay 流程」，點擊 marker → fetch `/api/citations/[id]` → 顯示 modal，expired 顯示錯誤狀態

## 5. Admin 文件管理元件

> 對應 design.md「文件列表 DataTable」與「Upload Wizard 狀態機」
> Note: 元件位於 `app/components/documents/` 而非 `app/components/admin/documents/`

- [x] 5.1 [P] 建立 `app/components/documents/DocumentListTable.vue` — 文件列表表格，含所有欄位與 actions
- [x] 5.2 [P] 建立 `app/components/documents/UploadWizard.vue` — 多步驟上傳 UI
- [x] 5.3 [P] 建立 `app/components/documents/{DocumentStatusBadge,VersionSyncBadge,VersionIndexBadge,AccessLevelBadge}.vue` — 多個 StatusBadge 變體，組合呈現文件完整狀態

## 6. Admin 文件管理頁面

> 實作 Admin Document List UI、Staged Upload And Publish Wizard、Version Status Clarity
> Note: composable 邏輯 inline 在頁面/元件中

- [x] 6.1 建立 `app/composables/useDocumentLifecycle.ts` — 文件與版本 lifecycle 邏輯（取代拆分的 useDocuments/useUploadWizard，文件列表 CRUD + pagination 以 page-level `useFetch` 內嵌）
- [x] 6.2 於 `app/components/documents/UploadWizard.vue` 實作 Upload Wizard 狀態機（select → uploading → finalizing → syncing → publishing → done，以元件內 state 取代獨立 `useUploadWizard.ts`）
- [x] 6.3 建立 `app/pages/admin/documents/index.vue` — 文件列表頁，含 DataTable + 新增按鈕
- [x] 6.4 建立 `app/pages/admin/documents/[id].vue` — 文件詳情頁，含 metadata 編輯 + 版本歷史
- [x] 6.5 建立 `app/pages/admin/documents/upload.vue` — 上傳頁面，整合 UploadWizard
- [x] 6.6 實作 Staged Upload And Publish Wizard — presign → direct upload → finalize → sync → publish 流程 UI，處理 Risk: Upload 中途失敗（各步驟錯誤顯示），Trade-off: 上傳進度顯示（indeterminate progress bar）
- [x] 6.7 實作 Version Status Clarity — 用 StatusBadge 顯示 queued/syncing/indexed/failed 狀態

## 7. 權限與狀態處理

- [x] 7.1 實作 Admin 頁面 middleware — `/admin/*` 路徑需 Admin 角色，否則導向 403
- [x] 7.2 實作 Chat 頁面 middleware — `/chat` 路徑需已登入，否則導向 login
- [x] 7.3 實作 empty state — 對話列表空、文件列表空時的引導 UI
- [x] 7.4 實作 loading state — 頁面載入時的 skeleton UI
- [x] 7.5 實作 error state — API 錯誤時的提示 UI（含 retry 按鈕）
- [x] 7.6 實作 unauthorized state — 非 Admin 訪問 Admin 頁面時的 403 頁面

## 8. Design Review

> 適用於所有 UI 變更

- [x] 8.1 檢查 `.impeccable.md` 是否存在，若無則執行 `/impeccable teach`
- [x] 8.2 執行 `/design improve` 對 `app/pages/**`、`app/components/**`（含 Design Fidelity Report）
- [x] 8.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [x] 8.4 依 `/design` 計劃按 canonical order 執行 targeted skills
- [x] 8.5 執行 `/audit` — 確認 Critical = 0
- [x] 8.6 執行 `/review-screenshot` — 視覺 QA
- [x] 8.7 Fidelity 確認 — `design-review.md` 中無 DRIFT 項

## 9. UI/UX Refinements（improve.md B1/B2/B6/B7/B9/B13/B15 補強）

> 來源：2026-04-18 improve.md 類別 2 盤點。既有實作已涵蓋多數，以下為**補強項**，不覆蓋既有 completed tasks。完成後對應項目在 improve.md 標記 📝。

- [x] 9.1 **B1 補強：引用互動 UX** — 行內 `CitationMarker` hover 時對應 `CitationReplayModal` / 引用卡片加 highlight；引用卡片顯示 current 版 badge（對比歷史版）；引用卡片 click 至少兩種進入方式（直接展開 or 開 modal）
- [x] 9.2 [P] **B2 補強：拒答下一步引導** — `RefusalMessage` 元件補「建議行動」區塊：顯示 3 項可點擊建議（「改換關鍵字重新提問」/「查看相關文件清單」/「聯絡管理員」），點擊觸發對應行為（清空輸入框 focus / link 到 `/admin/documents` 或公開列表 / mailto）
- [x] 9.3 [P] **B6 補強：上傳進度 4 階段 UX** — `UploadWizard` 從 indeterminate progress 改為 **4 階段明確 UI**：(1) 上傳中顯示 XHR 百分比；(2) 前處理中顯示「前處理中」spinner + 預估文件處理時間；(3) smoke 驗證中顯示「驗證中」spinner；(4) 完成顯示「已發布」green checkmark；失敗顯示具體階段的錯誤訊息
- [x] 9.4 [P] **B7 補強：串流 UX 細節** — (a) `ChatInput` 加 stop 按鈕（串流中顯示、點擊中斷並呼叫 `abort()`）；(b) `useChat` onError 區分「user abort / network error / timeout / rate limit」並給不同 UX；(c) streaming markdown 中途若有未閉合 code fence 用 `md4x heal:streaming` 或等價處理避免破版
- [x] 9.5 [P] **B9 補強：429 rate limit UX** — `/api/chat` 回 429 時 `useChat` 捕獲 → 顯示錯誤 toast「請求過於頻繁，請於 X 秒後重試」；X 為從 response header 讀取的 retry-after 或預設 60；中斷 stop 按鈕切回發送狀態
- [x] 9.6 **B13 補強：版本 rollback UI + 歷史引用 badge** — (a) `/admin/documents/[id]` 版本歷史每列加「切為 current」按鈕（僅非 current 且 `index_status=indexed` 可點，二次確認 modal）；(b) 引用卡片若 sourceVersion ≠ current 時加 `已非最新版` 小 badge；(c) rollback 成功 toast 提示
- [x] 9.7 [P] **B15 補強：citation 審計回放（併入 B1 路徑）** — 註：對應 query_logs 詳情頁「跳至引用回放」按鈕屬 `admin-ui-post-core` 範疇，本 change 僅完成 Modal admin-only 欄位 — 確認 `CitationReplayModal` 在 admin 使用時除使用者層資訊外額外顯示：`query_log.id`、`citationId`、`source_chunk_id`、`expires_at`（admin-only 欄位區塊，一般使用者隱藏）；對應 query_logs 詳情頁（admin-ui-post-core 範疇）加「跳至引用回放」按鈕

## 人工檢查

> 來源：`add-v1-core-ui` | Specs: `web-chat-ui`, `admin-document-management-ui`

- [x] #1 以 Web User 登入後，從首頁進入 `/chat`，確認 Navigation 正確顯示（無 Admin 入口）
  - 2026-04-18 production PASS：Web User (非 allowlist Gmail) 在 `https://agentic.yudefine.com.tw/` 登入後停在首頁「開始探索知識庫」，Navigation 只顯示「問答」，無「文件管理」。截圖：temp/phase1/step1.1.png。
- [x] #2 以 Web Admin 登入後，確認 Navigation 顯示 Chat + Documents 入口
- [x] #3 在 Chat 頁面提問，確認 streaming 回答逐字顯示，refusal 有不同樣式
  - 2026-04-19 production PASS：問「AutoRAG 驗收文件的測試目的是什麼？」回應 streaming 逐字出現並帶 citation。問「今天股票哪支漲？」呈現 refusal 專屬 UI（標題「無法回答」、圖示、可能原因清單、重試引導），與一般 answer 視覺明顯區隔。
- [x] #4 點擊引用標記，確認 Citation Replay Modal 正確顯示原文段落
  - 2026-04-19 production PASS：點 `/chat` 回覆的「引用 1」tag 跳出 Citation Replay Modal，顯示「引用內容」標題 + 文件標題「Smoke Test 0418 — AutoRAG 驗收」+ 精確段落原文。
- [x] #5 以 Admin 進入 `/admin/documents`，確認文件列表顯示所有欄位與狀態 Badge
  - 2026-04-18 local PASS：列表顯示 7 欄（標題 / 分類 / 權限 / 狀態 / 目前版本 / 更新時間 / actions），3 份種子文件覆蓋 3 種 document status badge（草稿 / 啟用 / 已歸檔）與 version sync+index 實際值（待同步+前處理中、已同步+待索引），每列尾端有 `⋯` actions icon。截圖：screenshots/local/add-v1-core-ui/#5-admin-list-all-columns.png
- [x] #6 執行完整上傳流程（select → upload → finalize → sync → publish），確認每步驟狀態正確
  - 2026-04-19 production PASS：Smoke Test 0418 v1 + v2 均走完 `select → upload → finalize → sync → indexing_wait → publish`。每階段顯示對應步驟指示；indexing_wait 實際 polling `/api/documents/[id]/versions/[versionId]/index-status` 直到 `index_status='indexed'` 才允許 publish。UI 移除原本洩漏給使用者看的 `index_status / sync_status` 欄位。同 slug 第二次上傳在同一 wizard 由「⚠️ 此文件代碼已被其他文件使用，送出會失敗」改為「ℹ️ 此文件代碼已存在，將以新版本上傳到既有文件」並可正常送出建 v2。
- [x] #7 以非 Admin 訪問 `/admin/documents`，確認被阻擋（403 或 redirect）
  - 2026-04-18 production PASS：Web User session 直接訪問 `/admin/documents` 被 redirect 到 `/`（首頁），不可見文件列表。Observation: redirect 目標為 `/` 而非 Runbook 原本預期的 `/chat` 或 `/login`；已由使用者確認接受現況。
- [x] #8 測試 empty state、loading state、error state 是否正確顯示
  - 2026-04-18 local PASS：
    - Empty: 清空 `documents` / `document_versions` 後 `/admin/documents` 顯示 `DocumentsDocumentListEmpty`（`i-lucide-file-plus` 圖示 + 「開始建立知識庫」標題 + CTA「上傳第一份文件」）。驗完立刻以備份 SQL 還原 3 份文件。截圖：screenshots/local/add-v1-core-ui/#8-empty-state.png
    - Loading: `/admin/documents` 的 `isLoading` 分支（`i-lucide-loader-2` 旋轉 spinner + 「載入中...」）。透過 `window.fetch` wrapper 對 `/api/admin/documents` 注入 6 秒延遲，再從瀏覽器 devtools 以 `useNuxtApp()._asyncData[key].execute({cause:'refresh'})` 強制觸發 pending 狀態截圖（SPA 首次載入因 `ssr:false` 會只見空殼畫面，實際 `isLoading` UI 僅在 client-side refresh 路徑可見）。截圖：screenshots/local/add-v1-core-ui/#8-loading-state.png
    - Error: `/admin/documents/00000000-0000-0000-0000-000000000000` 觸發 404 分支 → 「找不到此文件，可能已被刪除。」+「返回列表」CTA（`i-lucide-file-x` 圖示）。截圖：screenshots/local/add-v1-core-ui/#8-error-404.png。附帶測試 `/admin/documents/not-a-uuid` 觸發 Zod 400 → 走 generic network error 分支「連線可能暫時中斷…」+「返回列表 / 重新載入」兩個 CTA。截圖：screenshots/local/add-v1-core-ui/#8-error-400.png

## Affected Entity Matrix

### Entity: conversations

| Dimension       | Values                                               |
| --------------- | ---------------------------------------------------- |
| Columns touched | `id`, `title`, `user_id`, `created_at`, `updated_at` |
| Roles           | Web User, Web Admin                                  |
| Actions         | list, create, select, view messages                  |
| States          | empty, loading, error, success                       |
| Surfaces        | `/chat`（側欄列表）, `/chat/[id]`（對話內容）        |

### Entity: messages

| Dimension       | Values                                                                |
| --------------- | --------------------------------------------------------------------- |
| Columns touched | `id`, `conversation_id`, `role`, `content`, `citations`, `created_at` |
| Roles           | Web User, Web Admin                                                   |
| Actions         | list, append (streaming)                                              |
| States          | loading (streaming), success, refusal                                 |
| Surfaces        | `/chat/[id]`（訊息列表）                                              |

### Entity: documents

| Dimension       | Values                                                                          |
| --------------- | ------------------------------------------------------------------------------- |
| Columns touched | `id`, `title`, `category`, `access_level`, `status`, `created_at`, `updated_at` |
| Roles           | Web Admin                                                                       |
| Actions         | list, view, edit metadata                                                       |
| States          | empty, loading, error, success                                                  |
| Surfaces        | `/admin/documents`（列表）, `/admin/documents/[id]`（詳情）                     |

### Entity: document_versions

| Dimension       | Values                                                                            |
| --------------- | --------------------------------------------------------------------------------- |
| Columns touched | `id`, `document_id`, `version_number`, `index_status`, `is_current`, `created_at` |
| Roles           | Web Admin                                                                         |
| Actions         | list, upload, publish                                                             |
| States          | queued, syncing, indexed, failed                                                  |
| Surfaces        | `/admin/documents/[id]`（版本歷史）, `/admin/documents/upload`（上傳流程）        |

## User Journeys

### Web User 問答流程

- **Web User** 從首頁點擊 Chat 入口 → 進入 `/chat` → 看到對話列表（或空狀態引導）→ 點擊新建對話 → 輸入問題 → 看到 streaming 回答 → 點擊引用標記 → 看到原文 Modal

### Web Admin 文件管理流程

- **Web Admin** 從 Navigation 點擊 Documents → 進入 `/admin/documents` → 看到文件列表 → 點擊「上傳新文件」→ 選擇檔案 → 填寫 metadata → 經歷 presign → upload → finalize → sync → publish → 回到列表看到新文件狀態為 active + indexed

### 未登入使用者被導向登入

- **未登入使用者** 直接訪問 `/chat` → 被 redirect 到 `/login` → 登入後自動導回 `/chat`

### 非 Admin 被阻擋管理頁面

- **Web User（非 Admin）** 訪問 `/admin/documents` → 看到 403 頁面或被 redirect 到首頁
