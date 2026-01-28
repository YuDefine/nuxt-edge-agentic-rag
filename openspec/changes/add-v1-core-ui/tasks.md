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

- [x] 4.1 建立 `app/composables/useChat.ts` — 封裝 `@ai-sdk/vue` 的 `useChat` + conversationId 管理
- [x] 4.2 建立 `app/composables/useConversations.ts` — 對話列表 CRUD（GET/POST /api/conversations）
- [x] 4.3 建立 `app/pages/chat.vue` — Chat 首頁，整合 sidebar + 空狀態引導
- [x] 4.4 建立 `app/pages/chat/[id].vue` — 對話詳情頁，整合 message list + input
- [x] 4.5 實作 Streaming Answer And Refusal Display — loading skeleton、逐 token 渲染、refusal 樣式，處理 Risk: Streaming 中斷處理（onError callback + 重試提示）
- [x] 4.6 實作 Citation Replay UI — 依 design.md「Citation Replay 流程」，點擊 marker → fetch `/api/citations/[id]` → 顯示 modal，expired 顯示錯誤狀態

## 5. Admin 文件管理元件

> 對應 design.md「文件列表 DataTable」與「Upload Wizard 狀態機」
> Note: 元件位於 `app/components/documents/` 而非 `app/components/admin/documents/`

- [x] 5.1 [P] 建立 `app/components/admin/documents/DocumentTable.vue` — 文件列表表格，含所有欄位與 actions
- [x] 5.2 [P] 建立 `app/components/admin/documents/UploadWizard.vue` — 多步驟上傳 UI
- [x] 5.3 [P] 建立 `app/components/admin/documents/DocumentStatusBadges.vue` — 組合多個 StatusBadge 顯示文件完整狀態

## 6. Admin 文件管理頁面

> 實作 Admin Document List UI、Staged Upload And Publish Wizard、Version Status Clarity
> Note: composable 邏輯 inline 在頁面/元件中

- [x] 6.1 建立 `app/composables/useDocuments.ts` — 文件列表 CRUD + pagination
- [x] 6.2 建立 `app/composables/useUploadWizard.ts` — Upload Wizard 狀態機（select → uploading → finalizing → syncing → publishing → done）
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

## 人工檢查

> 來源：`add-v1-core-ui` | Specs: `web-chat-ui`, `admin-document-management-ui`

- [ ] #1 以 Web User 登入後，從首頁進入 `/chat`，確認 Navigation 正確顯示（無 Admin 入口）
- [x] #2 以 Web Admin 登入後，確認 Navigation 顯示 Chat + Documents 入口
- [ ] #3 在 Chat 頁面提問，確認 streaming 回答逐字顯示，refusal 有不同樣式
- [ ] #4 點擊引用標記，確認 Citation Replay Modal 正確顯示原文段落
- [ ] #5 以 Admin 進入 `/admin/documents`，確認文件列表顯示所有欄位與狀態 Badge
- [ ] #6 執行完整上傳流程（select → upload → finalize → sync → publish），確認每步驟狀態正確
- [ ] #7 以非 Admin 訪問 `/admin/documents`，確認被阻擋（403 或 redirect）
- [ ] #8 測試 empty state、loading state、error state 是否正確顯示

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
