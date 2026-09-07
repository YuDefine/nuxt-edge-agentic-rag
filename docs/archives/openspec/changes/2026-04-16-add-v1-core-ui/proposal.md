## Why

`v1.0.0` 的後端核心流程已經具備 upload、sync、publish、chat 與 MCP 契約，但目前前端仍缺少足以完成六步最小閉環的核心 UI。沒有 Admin 文件管理頁、Web 問答頁、對話歷史與引用回放介面，就算後端功能存在，也無法完成報告要求的可部署、可驗證、可答辯閉環。

此外，這個 change 的 scope 必須與 `admin-ui-post-core` 分開：本 change 只處理核心驗收所需 UI；token 管理、query logs 檢視、dashboard 與進階營運視圖仍屬同版後置。

## What Changes

- 新增核心 Web Chat UI，覆蓋提問、串流顯示、拒答顯示、對話歷史與引用回放。
- 新增 Admin 文件管理 UI，覆蓋文件列表、上傳、同步、發布與版本狀態顯示。
- 更新首頁與導覽結構，依使用者角色顯示 chat 與 admin 入口。
- 補齊核心 UI 所需的最小前端整合層，包含引用回放 server wrapper、documents list data source 與 admin page guards。

## Non-Goals

- MCP token 管理 UI、Query Logs UI、Dashboard 卡片與統計摘要。
- Debug 分數面板、延遲視覺化與 decision path 顯示。
- 多文件批次操作、線上文件編輯器、rich format 預覽。
- Passkey、MCP session 與 Cloud fallback 相關前端入口。

## Capabilities

### New Capabilities

- `web-chat-ui`: 核心問答介面，包含訊息輸入、串流回應、拒答狀態、對話歷史與 citation replay。
- `admin-document-management-ui`: Admin 文件管理介面，包含列表、狀態徽章、staged upload、sync / publish 操作與版本狀態回饋。

### Modified Capabilities

(none)

## Impact

- Affected specs: `web-chat-ui`, `admin-document-management-ui`
- Affected code: `app/pages/index.vue`, `app/pages/chat/**`, `app/pages/admin/documents/**`, `app/components/chat/**`, `app/components/documents/**`, `app/middleware/**`, `server/api/documents/**`, `server/api/citations/**`
