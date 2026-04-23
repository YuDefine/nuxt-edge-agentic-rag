## Context

目前 Web 問答入口 `server/api/chat.post.ts` 與 MCP 問答入口 `server/mcp/tools/ask.ts` 都已把 `answer` / `judge` 抽成可注入依賴，但正式路徑仍接到 fallback answer / fallback judge。這代表 retrieval、citation、query log、decision path 雖已成形，真正的回答層卻還沒有可靠的 Workers AI 證據鏈。由於 Web 與 MCP 共用 `server/utils/knowledge-answering.ts`、`server/utils/web-chat.ts`、`server/utils/mcp-ask.ts` 的治理核心，這個 change 必須同時處理兩個通道，並維持 retrieval、citation 與拒答規則不變。

## Goals / Non-Goals

**Goals:**

- 讓 Web 與 MCP 的 accepted path / judge path 由真實 Workers AI 執行。
- 維持 `models.defaultAnswer` 與 `models.agentJudge` 這類穩定角色，不把具體模型名稱直接寫進呼叫端邏輯。
- 保留現有 retrieval、citation、query log、refusal 與 governance 邊界，只替換回答層實作與驗證方式。
- 建立固定題組、可重跑 smoke 與少量實測 baseline，支撐成本與延遲的情境估算。

**Non-Goals:**

- 不實作前端真串流、SSE、首字延遲 UX 或多通道串流協定。
- 不把 refused path 的「零模型呼叫證明」納入本 change 的最低驗收。
- 不重新設計 retrieval truth source、document lifecycle、citation replay 或 admin dashboard。

## Decisions

### Shared Workers AI adapters stay behind the existing answer and judge contracts

Web 與 MCP 已經透過 `answer` / `judge` 依賴注入共享回答核心，因此本 change 應保留現有 contract，僅把 fallback 實作替換為 Workers AI adapter。這能避免把 change 膨脹成 orchestration 重寫，同時保留 `server/utils/knowledge-answering.ts` 的 decision path 與 telemetry 行為。

替代方案是為 Web 與 MCP 各自實作獨立模型呼叫流程，但那會複製治理分支並增加路徑漂移風險，因此不採用。

### Accepted-path evidence is a first-class deliverable

本 change 的完成定義不是「程式碼看起來已接模型」，而是 Web 與 MCP 都能以固定題組重跑 accepted path，並留下對得上的 Workers AI / AI Gateway 呼叫證據。設計上必須把 smoke、query log 與實測紀錄視為 capability 的一部分，而不是事後補文件。

替代方案是只依賴人工截圖或單次後台紀錄，但那不足以支撐可重跑驗收，因此不採用。

### Cost claims use measured baseline plus labeled scenario extrapolation

成本與延遲數字將基於少量真實 Workers AI 題組實測，再用公開假設與 mock data 外推成情境估算。這讓專案可以同時保留真實基準與可答辯的規模推估，也避免把本 change 擴張成大規模 benchmark。

替代方案是只用 mock data 或只用單次人工觀察。前者過於空泛，後者不足以形成可重現基準，因此都不採用。

### Refused-path governance remains stable and out of scope for zero-call proof

`audit.shouldBlock` 與既有 refusal 邏輯必須維持原有治理行為，但本 change 不把「證明完全未呼叫模型」列為最低驗收。這樣可以把範圍控制在回答層接入與 accepted path 證據，而不是把觀測系統升級也綁進來。

替代方案是把 zero-call proof 一起做成硬性驗收，但這會讓 change 膨脹到觀測對帳主題，因此不採用。

## Risks / Trade-offs

- [Risk] Workers AI adapter 與既有 answer / judge contract 不完全對齊，導致 Web 或 MCP 其中一路出現分歧。 → Mitigation：優先共用 adapter 介面與 shared tests，避免通道特化邏輯擴散。
- [Risk] 固定題組無法覆蓋 `judge_pass` 路徑，導致 DoD 缺一塊。 → Mitigation：在題組設計時明確要求覆蓋 `direct_answer` 與 `judge_pass` 兩條 accepted path。
- [Risk] 成本外推被誤讀成正式實測總成本。 → Mitigation：所有文件都必須標示「measured baseline」與「scenario estimate」的區別。
- [Risk] 為了留下證據而過度修改 query log schema 或 observability。 → Mitigation：優先使用既有 query log / gateway 資料面，僅補最低必要欄位與紀錄流程。
