## Why

bootstrap-v1-core-from-report 已完成後端 API（Auth、Document Lifecycle、Web Answering、MCP、Governance），但目前 UI 層只有登入頁與中性首頁。要完成六步最小閉環的人工驗收（#1-#5），需要實作 Web Chat 介面與 Admin 文件管理介面，讓驗收人員能透過實際頁面操作而非 curl 命令。

## What Changes

### Chat 介面（Web User / Web Admin）

- `/chat` 頁面：對話歷史側欄、訊息清單、提問輸入區
- Streaming 回答顯示：loading skeleton、逐 token 渲染、refusal 樣式
- Citation Replay：引用標記點擊 → 開啟 Modal 顯示原文段落
- 對話管理：新建對話、切換對話、對話列表

### 文件管理介面（Admin Only）

- `/admin/documents` 頁面：文件列表 DataTable（title、category、access_level、status、version、updated_at）
- 上傳 Wizard：presign → direct upload → finalize → sync → publish 分步驟 UI
- 版本狀態 Badge：draft/active/archived、queued/syncing/indexed/failed
- 文件詳情/編輯：metadata 編輯、版本歷史、重新索引

### 共用 UI 元件

- `StatusBadge`：文件狀態、版本狀態、access level 視覺化
- `DataTable`：分頁、排序、篩選的共用表格元件
- Navigation Shell：role-aware 導航，Admin 看到管理入口，User 只看到 Chat

## Non-Goals

- MCP Token 管理 UI（屬於 `admin-ui-post-core` change）
- Query Logs 檢視 UI（屬於 `admin-ui-post-core` change）
- Dashboard 統計卡片（屬於 `admin-ui-post-core` change）
- Debug 分數面板（屬於 `observability-and-debug` change）
- 多格式文件支援（PDF、DOCX 預覽）— v1.0.0 後
- 批次上傳 — v1.0.0 後

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

（無 — 本 change 純實作既有 requirements，無需建立 delta specs）

## Impact

### 影響的程式碼

- `app/pages/chat/index.vue`（新建 — 單一 session 入口，對話列表 inline 於 Container.vue）
- `app/pages/chat/[id].vue`（新建）
- `app/pages/admin/documents/index.vue`（新建）
- `app/pages/admin/documents/[id].vue`（新建）
- `app/pages/admin/documents/upload.vue`（新建）
- `app/components/chat/`（新建目錄 — Container/MessageList/MessageInput/StreamingMessage/RefusalMessage/ConversationHistory/CitationMarker/CitationReplayModal/CitationCard）
- `app/components/documents/`（新建目錄 — DocumentListTable/UploadWizard/DocumentListEmpty/LifecycleConfirmDialog/AccessLevelBadge/DocumentStatusBadge/VersionSyncBadge/VersionIndexBadge）
- `app/layouts/default.vue`（修改 — 加入 `UNavigationMenu` 而非獨立 AppSidebar）
- `app/composables/useDocumentLifecycle.ts`（新建 — 封裝文件與版本 lifecycle；Chat streaming 直接使用 `@ai-sdk/vue` 的 `useChat`，不另包 composable）

### 依賴的 API（來自 bootstrap）

| API                                               | 用途            |
| ------------------------------------------------- | --------------- |
| `GET /api/conversations`                          | 對話列表        |
| `POST /api/conversations`                         | 新建對話        |
| `GET /api/conversations/[id]/messages`            | 訊息列表        |
| `POST /api/chat`                                  | Streaming 問答  |
| `GET /api/citations/[id]`                         | Citation Replay |
| `GET /api/admin/documents`                        | 文件列表        |
| `POST /api/uploads/presign`                       | 上傳預簽名      |
| `POST /api/uploads/finalize`                      | 上傳完成        |
| `POST /api/documents/[id]/sync`                   | 觸發同步        |
| `POST /api/documents/[id]/versions/[vid]/publish` | 發布版本        |

### 環境依賴

- 無新增環境變數
- 無新增 Cloudflare bindings
- 依賴 bootstrap 已建立的 D1 schema、Auth session
