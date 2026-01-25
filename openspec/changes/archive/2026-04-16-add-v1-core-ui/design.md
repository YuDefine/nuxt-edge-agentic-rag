## Context

報告要求 `v1.0.0` 核心閉環至少可透過 Web 完成登入、文件上傳與發布、提問、引用回放，以及 current-version-only 與 restricted 邊界驗證。但 bootstrap change 目前以後端與治理契約為主，只補了 neutral shell 與 design review gate，沒有把核心操作頁面拆成獨立 UI workstream。

這個 change 的定位是「核心 UI 補完」，不是 admin 後置營運工具。它必須與 `admin-ui-post-core` 明確分界：

- 本 change：chat、對話歷史、citation replay、文件管理、上傳、sync、publish。
- `admin-ui-post-core`：token 管理、query logs、dashboard、運營摘要。

## Goals / Non-Goals

**Goals:**

- 讓 Web User 能在 `/chat` 實際提問、看到串流回答、查看引用與對話歷史。
- 讓 Admin 能在 `/admin/documents` 完成文件列表、上傳、同步與發布流程。
- 讓首頁與導航可依角色導到核心可用頁面，而不是停留在空 shell。
- 使用既有後端契約與 shared governance helpers，不重寫第二套邏輯。

**Non-Goals:**

- 不在本 change 建立 token 管理、query logs、dashboard 或 debug 面板。
- 不改變回答路由、current-version-only、redaction 或 scope 真相來源。
- 不新增不在報告中的新體驗，如 batch upload、inline editing、rich document preview。

## Decisions

### Core UI Lives On Explicit Routes

核心路由固定為：

- `/`：首頁/導航
- `/chat`：所有已登入使用者可用的 Web 問答頁
- `/admin/documents`：Admin 文件列表與版本狀態頁
- `/admin/documents/upload`：Admin staged upload 與 publish 流程頁

這讓 middleware 與 manual acceptance 有清楚的 URL 目標，也避免把核心功能藏在 modal-only flow。

### Chat Uses Persisted Web Conversation Semantics

Chat UI 不是 session-only playground。它必須對齊報告中的 Web 對話持久化語意，至少整合：

- 對話歷史列表
- 當前 conversation message list
- 問答串流顯示
- 拒答呈現
- 引用回放

若對話刪除、stale follow-up 或 visibility recalculation 已由 governance helpers 提供，UI 只能消費這些正式邏輯，不得自行推斷。

### Citation Replay Uses A Dedicated App Surface

前端不直接呼叫 MCP transport；應使用 app 內部 server route 或等價 wrapper，重用 `getDocumentChunk` 核心邏輯，回傳 UI 所需資料。這樣可以保留相同的授權與 retention 規則，又不把 MCP 對外契約硬綁到瀏覽器實作細節。

### Document Management Prioritizes State Clarity

文件管理 UI 的首要目標是讓 Admin 看懂目前文件與版本處在什麼狀態，而不是追求複雜表格功能。因此頁面優先順序是：

1. list / empty / loading / error states
2. staged upload wizard
3. sync / publish 操作與回饋
4. 版本狀態與 current 標示

### Design And UX Boundaries

核心 UI 要求可以完成驗收，不等於可以偷做成工程內頁。頁面仍需遵守 design checkpoint，但不追求 post-core 的 debug density 或運營 dashboard。關鍵是：

- Chat 頁資訊階層清楚
- Citation 清楚可點、可回放
- Admin 文件狀態明確
- Unauthorized / empty / error / loading 四態完整

## Risks / Trade-offs

- [與 bootstrap 重疊]：bootstrap 已有 UI design gate，但沒有具體 UI deliverables。此 change 必須只吃 UI surface，不重做後端 orchestration。
- [與 admin-ui-post-core 重疊]：需嚴格排除 token、query logs、dashboard。
- [前端自行判權]：UI guards 只能改善 UX，真正授權仍靠 runtime allowlist 與 server checks。
- [引用回放端點不明確]：若沒有 app wrapper，前端容易直接依賴 MCP transport 細節。

## Migration Plan

1. 先補頁面 guards 與最小資料來源，如 documents list API 與 citation replay app route。
2. 建立 documents 與 chat 共用元件，先補完整 state coverage。
3. 整合首頁導航與 role-aware entry。
4. 跑 design review、audit 與 screenshot review，完成核心 UI 視覺驗收。

## Execution Strategy

### Work Breakdown

| 區塊       | 內容                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Chat       | `/chat` page, message list, input, streaming state, refusal UI, citation modal, conversation history |
| Admin Docs | list page, upload page, staged upload wizard, status badges, sync/publish actions                    |
| Navigation | home entry, role-aware links, unauthorized redirects                                                 |

### Dependency Notes

- documents list API 與 citation replay wrapper 若缺失，需在本 change 一併補齊最小 server surface。
- governance change 若後續補上 stale/delete helpers，UI 應消費 shared helper，而非自行保留平行邏輯。

## Open Questions

- citation replay 的 app route 最終命名應沿用 `/api/citations/:citationId` 或其他 wrapper path，需依現有 server API 命名慣例決定。
- 文件列表是否需要首版即支援搜尋與篩選，或只保留排序與狀態顯示，需依時程決定。
