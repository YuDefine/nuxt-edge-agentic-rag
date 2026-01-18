## Why

報告把 debug 分數面板、延遲追蹤與決策路徑顯示列為 `v1.0.0` 同版後置項，這些能力對調校、除錯與答辯說明很重要，但不該阻塞核心閉環。需要一個獨立 change，把可觀測性與 debug surface 補齊，同時保持與治理與 admin summary UI 的邊界清楚。

## What Changes

- 新增 decision inspection surface，顯示 confidence、retrieval、answerability judge、decision path 等調試資訊。
- 新增 latency and outcome observability surface，顯示 first-token / completion latency、refusal / success ratio 與核心 outcome 摘要。
- 補齊 query log / response payload 所需的 debug-safe metadata 與前端展示組件。
- 讓 debug surfaces 受環境或權限 gate 控制，避免對一般使用者暴露內部診斷資訊。

## Non-Goals

- 不新增管理型 token / query log CRUD 頁； تلك些屬於 admin-ui-post-core。
- 不改變核心回答或 MCP 對外契約。
- 不讓 debug UI 成為報表或 dashboard 的正式真相來源。

## Capabilities

### New Capabilities

- `debug-decision-inspection`: 分數、decision path 與 citation eligibility 的 debug surface。
- `latency-and-outcome-observability`: 延遲與 outcome 摘要視圖。

### Modified Capabilities

(none)

## Impact

- Affected specs: `debug-decision-inspection`, `latency-and-outcome-observability`
- Affected code: `app/components/debug/**`, `app/pages/admin/debug/**`, `shared/**`, `server/api/query-logs/**`, `server/utils/**`, `docs/verify/**`
