## Why

`v1.0.0` 核心閉環不只需要能問答與上傳文件，還需要讓 Admin 具備最基本的營運與治理操作面。但這些介面並非六步最小閉環的 blocker，因此應在核心驗收完成後，以獨立 change 補齊，避免和 add-v1-core-ui 的核心 UI scope 混在一起。

本 change 專注於 token 管理 UI、query logs UI 與 feature-flag-protected dashboard summary，對應報告中的同版後置項與 roadmap 的 admin-ui-post-core backlog。

## What Changes

- 新增 MCP token 管理 UI：列表、建立、scope 顯示、一次性 secret reveal、撤銷。
- 新增 Query Logs UI：列表、篩選、詳情與 redaction-safe 顯示。
- 新增 Admin summary dashboard：在 feature flag 開啟時顯示問答數、文件數、token 數與基本營運摘要。
- 補齊這些 UI 所需的最小 server data surface 與 page-level auth/feature gating。

## Non-Goals

- 不重做核心 chat 與文件管理 UI；那些由 add-v1-core-ui 處理。
- 不加入 debug 分數面板、decision path drilldown 或 latency 詳細圖；那些由 observability-and-debug 處理。
- 不在 production `v1.0.0` 預設開啟 dashboard；仍需遵守 `features.adminDashboard = false` 預設。

## Capabilities

### New Capabilities

- `admin-token-management-ui`: Admin MCP token 管理介面。
- `admin-query-log-ui`: Admin query logs 檢視與詳情介面。
- `admin-observability-dashboard`: Feature-gated 的管理摘要儀表板。

### Modified Capabilities

(none)

## Impact

- Affected specs: `admin-token-management-ui`, `admin-query-log-ui`, `admin-observability-dashboard`
- Affected code: `app/pages/admin/tokens/**`, `app/pages/admin/query-logs/**`, `app/pages/admin/dashboard/**`, `app/components/admin/**`, `server/api/mcp-tokens/**`, `server/api/query-logs/**`, `shared/**`
