## Context

報告已把 MCP token 管理 UI、Query Logs UI 與管理統計儀表板明確列為 `v1.0.0` 同版後置項。它們屬於可用性與營運治理補完，而不是核心閉環 blocker，因此應該在 bootstrap + add-v1-core-ui 驗收後獨立推進。

這個 change 的原則是：

- 只補 Admin 運營 UI，不碰核心問答與文件發布主流程。
- 顯示 redaction-safe、audit-safe 資料，不在 UI 洩漏內部祕密或高風險原文。
- Dashboard 受 `features.adminDashboard` gate 控制，Production `v1.0.0` 預設仍為關閉。

## Goals / Non-Goals

**Goals:**

- 讓 Admin 可透過 UI 管理 MCP tokens，而非只靠 API 或 shell。
- 讓 Admin 可用 UI 查看 query logs、篩選通道/結果/風險標記，並開啟單筆詳情。
- 提供最小但可用的管理摘要卡片，幫助理解文件數、問答量、token 狀態等概況。

**Non-Goals:**

- 不實作 debug-level inspection，如 retrieval score、judge score、decision trace 展開。
- 不在 UI 顯示未遮罩的原始高風險輸入或任何不可回放的內部資料。
- 不把 dashboard 當成新的真相來源；它只讀取既有 query_logs/documents/mcp_tokens 彙整結果。

## Decisions

### Token UI Must Respect Secret Lifetime

token 建立後的明文 secret 只允許在建立當下顯示一次，後續列表只顯示 label、scope、status、expires_at、last_used_at 等 metadata。UI 不得提供「再次顯示明文 token」功能。

### Query Logs UI Is Redaction-Safe By Default

查詢紀錄頁只能顯示遮罩後資料與治理欄位，例如 `request_outcome`、`query_type`、`decision_path`、`redaction_applied`、`risk_flags_json`。若某筆訊息屬於高風險或 marker-only，UI 應明確顯示其狀態，但不能回推出原文。

### Dashboard Is A Gated Summary Surface

Dashboard 僅顯示粗粒度摘要卡片與趨勢，不承擔完整 drilldown 功能。由於報告要求 Production `features.adminDashboard = false`，頁面與導覽都要受 feature gate 保護；在 flag 關閉時，頁面可不存在、redirect，或顯示 disabled state。

## Risks / Trade-offs

- [與 observability 重疊]：Dashboard 與 logs 頁要停在 summary / audit-safe 層，不做 score-level debug。
- [祕密外洩]：token UI 最容易誤把 secret 長期保存或重顯，必須嚴格限制 reveal lifetime。
- [查詢日誌過載]：logs 頁若一次拉太多欄位，會變成不可讀表格；需先聚焦篩選與摘要欄位。

## Migration Plan

1. 先補 tokens、query logs 的列表與 CRUD/查看 surfaces。
2. 再加 dashboard summary 與 feature gate。
3. 最後補 admin UI tests、design review 與 screenshots。

## Execution Strategy

### Surfaces

- `/admin/tokens`
- `/admin/query-logs`
- `/admin/query-logs/[id]`
- `/admin/dashboard`（feature-gated）

### Data Priorities

1. Token metadata
2. Query logs filter + detail
3. Summary cards

## Open Questions

- query log detail 頁是否需要顯示 linked citations / request trace 入口，還是只保留高層欄位，需視 observability change 最終切法決定。
