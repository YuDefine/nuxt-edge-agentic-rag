## Context

目前系統已記錄 query logs、decision path、risk flags 與 latency fields，但還沒有一層可以讓開發者或 Admin 在受控範圍內閱讀這些資訊，導致除錯與調校仍須直接看資料表或 raw JSON。報告已明確把 debug 分數面板與延遲追蹤列為同版後置項，因此需要獨立 change 收斂這些 surfaces。

這個 change 與 `admin-ui-post-core` 的差異在於：

- `admin-ui-post-core`：營運與治理 UI，偏列表/管理/summary。
- `observability-and-debug`：內部調試與診斷 UI，偏分數、延遲、decision trace。

## Goals / Non-Goals

**Goals:**

- 呈現與回答路由直接相關的 debug 指標，如 retrieval score、judge score、decision path、citation eligibility。
- 呈現 latency 與 outcome 摘要，幫助辨識慢查詢、拒答比例與 routing 行為。
- 以權限或 feature gate 保護內部診斷資訊，不暴露給一般使用者。

**Non-Goals:**

- 不把 debug surface 變成正式對外契約或 dashboard。
- 不新增影響回答決策的邏輯，只讀既有 governed data。
- 不在一般 chat UI 預設顯示所有 debug 細節，避免污染正式使用體驗。

## Decisions

### Debug Surfaces Are Internal-Only

決策分數、judge 結果、decision trace、latency breakdown 都屬於內部診斷資料，只能在受控 surface 顯示。一般 Web User 與外部 MCP callers 不得看見這些欄位。

### Decision Inspection Reads From Persisted Or Derived Debug-Safe Data

debug UI 應盡量讀取 query log 已保存欄位與 redaction-safe traces，而不是重新執行問答流程。這避免 debug 頁面與實際回答出現兩套不同狀態。

### Latency Views Stay Aggregate-First

延遲與 outcome 先以 card / chart / grouped list 形式呈現，必要時再連到單筆 detail；不直接把 raw query log 表塞到頁面上。

## Risks / Trade-offs

- [診斷資料外洩]：若 gate 不夠嚴，會把內部 decision data 暴露給一般使用者。
- [資料不一致]：若 debug 頁重跑流程而不是讀既有記錄，容易產生和當次回答不一致的結果。
- [與 admin summary 重疊]：需明確區分 summary 與 debug density。

## Migration Plan

1. 先補齊 server 端可安全暴露的 debug/latency fields。
2. 建立 decision inspection components 與 latency summary surfaces。
3. 補 feature gate / admin gate。
4. 補 tests 與 verify docs。

## Execution Strategy

### Surfaces

- debug panel（可嵌入 Admin query log detail 或獨立 debug route）
- latency / outcome summary page or section

### Gating

- 僅 Admin / internal debug surface 可見
- 受環境或 feature flag 控制

## Open Questions

- debug panel 最終放在 `/admin/query-logs/[id]` 旁掛頁、獨立 `/admin/debug`、還是可切換 drawer，需視 admin-ui-post-core 最終結構決定。
