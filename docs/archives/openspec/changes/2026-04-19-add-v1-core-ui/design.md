## Context

bootstrap-v1-core-from-report 已建立完整的後端 API 與資料庫 schema。目前 UI 層只有：

- 登入頁面（Google OAuth）
- 中性首頁（無功能入口）
- 基本 layout（無 navigation）

本 change 補齊核心 UI，讓人工驗收（#1-#5）可以透過實際頁面操作進行。

### 現有 API Surface

| 類別          | Endpoints                                                                          |
| ------------- | ---------------------------------------------------------------------------------- |
| Auth          | `/api/auth/*`（better-auth）                                                       |
| Conversations | `GET/POST /api/conversations`, `GET /api/conversations/[id]/messages`              |
| Chat          | `POST /api/chat`（streaming）                                                      |
| Citations     | `GET /api/citations/[id]`                                                          |
| Documents     | `GET /api/admin/documents`, `GET/PATCH /api/admin/documents/[id]`                  |
| Upload        | `POST /api/uploads/presign`, `POST /api/uploads/finalize`                          |
| Sync/Publish  | `POST /api/documents/[id]/sync`, `POST /api/documents/[id]/versions/[vid]/publish` |

## Goals / Non-Goals

**Goals:**

1. 實作 `/chat` 頁面，讓 Web User 能提問並看到 streaming 回答
2. 實作 `/admin/documents` 頁面，讓 Admin 能看到文件列表與狀態
3. 實作上傳 wizard，讓 Admin 能完成 presign → upload → finalize → sync → publish 流程
4. 實作 citation replay modal，讓使用者點擊引用標記能看到原文
5. 提供 role-aware navigation，Admin 看到管理入口，User 只看到 Chat

**Non-Goals:**

- Token 管理 UI（`admin-ui-post-core`）
- Query Logs 檢視（`admin-ui-post-core`）
- Dashboard 統計（`admin-ui-post-core`）
- Debug 分數面板（`observability-and-debug`）
- 批次上傳、多格式預覽

## Decisions

### Navigation Shell 架構

**決定**：在 `default.vue` layout 加入 `<AppSidebar>` 元件，根據 `useUserRole()` 條件渲染 navigation items。

**理由**：

- 中央集中 navigation 定義，避免散落各頁面
- role-aware 邏輯封裝在 composable，頁面不需知道 allowlist 細節

**替代方案考量**：

- ❌ 在每個頁面重複判斷 — 不可維護
- ❌ 用 middleware 控制 — 這是 navigation visibility，不是 access control

### Chat 元件拆分

**決定**：拆分為以下元件：

```
app/components/chat/
├── ChatSidebar.vue        # 對話歷史列表
├── ChatMessageList.vue    # 訊息清單（含 streaming）
├── ChatInput.vue          # 提問輸入區
├── ChatMessage.vue        # 單則訊息（user/assistant）
├── CitationMarker.vue     # 引用標記
└── CitationReplayModal.vue # 引用回放 Modal
```

**理由**：

- 關注點分離：sidebar 管對話切換，message list 管顯示，input 管提問
- CitationReplayModal 獨立，因為它有自己的 fetch 邏輯與 error handling

### Chat Streaming 實作

**決定**：使用 `@ai-sdk/vue` 的 `useChat` composable，配合 `/api/chat` 的 Vercel AI SDK streaming response。

**理由**：

- `useChat` 內建 streaming 狀態管理、message append、error handling
- 與後端 `streamText` 完美配合，無需手寫 EventSource 邏輯

**技術細節**：

- `useChat({ api: '/api/chat', body: { conversationId } })`
- streaming 時 `isLoading = true`，顯示 typing indicator
- refusal 回應透過 message content 判斷，套用不同樣式

### Citation Replay 流程

**決定**：

1. 訊息中的引用以 `[1]` 格式顯示，渲染為 `<CitationMarker>` 元件
2. 點擊 marker 開啟 `<CitationReplayModal>`
3. Modal 呼叫 `GET /api/citations/[citationId]` 取得原文

**理由**：

- 延遲載入：只在使用者點擊時 fetch，不預載所有 citation
- 集中 error handling：expired/unavailable citation 在 modal 內顯示錯誤狀態

### Upload Wizard 狀態機

**決定**：以 `useUploadWizard()` composable 封裝多步驟流程，使用有限狀態機模式：

```typescript
type UploadStep =
  | 'select'
  | 'uploading'
  | 'finalizing'
  | 'syncing'
  | 'publishing'
  | 'done'
  | 'error'
```

**理由**：

- 清楚的狀態轉換，每個步驟有明確的 entry/exit 條件
- UI 可根據 `currentStep` 顯示對應的進度與按鈕狀態
- error 狀態可攜帶 `errorStep` 資訊，讓使用者知道哪一步失敗

**流程**：

1. `select` → 使用者選檔案，驗證 type/size
2. `uploading` → presign → direct upload to R2
3. `finalizing` → POST /api/uploads/finalize
4. `syncing` → POST /api/documents/[id]/sync，polling 等待 indexed
5. `publishing` → POST /api/documents/[id]/versions/[vid]/publish
6. `done` → 顯示成功，導回列表

### 文件列表 DataTable

**決定**：使用 `<UTable>` 配合 server-side pagination/sorting。

**欄位定義**：
| 欄位 | 來源 | 說明 |
|------|------|------|
| Title | `documents.title` | 可點擊進入詳情 |
| Category | `documents.category` | Badge 顯示 |
| Access Level | `documents.access_level` | Badge 顯示（public/restricted） |
| Status | `documents.status` | Badge（draft/active/archived） |
| Version | `document_versions.version_number` | 只顯示 current version |
| Index Status | `document_versions.index_status` | Badge（queued/syncing/indexed/failed） |
| Updated | `documents.updated_at` | relative time |
| Actions | — | 上傳新版、發布、刪除 |

**理由**：

- Server-side pagination 避免一次載入過多資料
- 多 Badge 讓 Admin 快速掃描狀態

### 共用 StatusBadge 元件

**決定**：建立 `<StatusBadge>` 元件，根據 status type 自動選擇顏色與 icon：

```vue
<StatusBadge type="document" value="active" />
<StatusBadge type="version" value="indexed" />
<StatusBadge type="accessLevel" value="restricted" />
```

**Mapping**：
| Type | Value | Color | Icon |
|------|-------|-------|------|
| document | draft | gray | — |
| document | active | green | check |
| document | archived | yellow | archive |
| version | queued | gray | clock |
| version | syncing | blue | spinner |
| version | indexed | green | check |
| version | failed | red | x |
| accessLevel | public | blue | globe |
| accessLevel | restricted | orange | lock |

**理由**：

- 一致的視覺語言，避免各頁面自定義顏色
- 集中維護，新增 status 時只改一處

## Risks / Trade-offs

### Risk: Streaming 中斷處理

**風險**：網路中斷時 streaming response 可能不完整
**緩解**：

- `useChat` 的 `onError` callback 處理錯誤
- 顯示「回答中斷，請重試」提示
- 保留已收到的部分內容

### Risk: Upload 中途失敗

**風險**：presign 成功但 upload 失敗時，R2 留下 orphan file
**緩解**：

- finalize endpoint 會檢查 R2 object 是否存在
- 未 finalize 的 upload 不會被系統使用
- 可透過 R2 lifecycle rule 清理（v1.0.0 後）

### Risk: 並發編輯衝突

**風險**：兩個 Admin 同時編輯同一文件
**緩解**：

- v1.0.0 不處理（假設單一 Admin 操作）
- PATCH 使用 optimistic concurrency 時加 `updated_at` 檢查（未來工作）

### Trade-off: 上傳進度顯示

**取捨**：direct upload to R2 無法取得精確進度百分比
**決定**：顯示 indeterminate progress bar + 步驟文字

## Open Questions

1. **Chat 輸入框位置**：固定在底部還是跟隨 message list 捲動？
   - 暫定：固定在底部（sticky），與主流 chat app 一致

2. **對話重新命名**：是否允許使用者重新命名對話？
   - 暫定：v1.0.0 不支援，對話以第一則訊息為標題

3. **Citation 過期處理**：顯示錯誤後是否提供「查看原文件」連結？
   - 暫定：只顯示錯誤訊息，因為原文件可能也已更新
