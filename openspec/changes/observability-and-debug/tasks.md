## 0. Schema Prerequisites

- [x] 0.1 擴充 `server/db/schema.ts::queryLogs`，新增 6 個 nullable debug 欄位（`first_token_latency_ms` INTEGER、`completion_latency_ms` INTEGER、`retrieval_score` REAL、`judge_score` REAL、`decision_path` TEXT、`refusal_reason` TEXT），附上 JSDoc 說明 null 代表「未測量」而非 0 / 空字串。 2026-04-19 local PASS: drizzle schema 新增 6 欄位並維持既有欄位型別。
- [x] 0.2 建立 `server/database/migrations/0005_query_logs_observability_fields.sql`，對應 schema 擴充做 6 個 `ALTER TABLE query_logs ADD COLUMN ...`，並以 SQLite round-trip 驗證語法。 2026-04-19 local PASS: `sqlite3 < 0001 && sqlite3 < 0005` 後 `.schema query_logs` 顯示 6 個新欄位，舊列讀出全部為 NULL，新列 round-trip 值正確。
- [x] 0.3 更新 `server/utils/knowledge-audit.ts::createQueryLog` 與 `server/utils/mcp-ask.ts::createMcpQueryLogStore` 的 INSERT；`web-chat.ts` / `mcp-ask.ts` 的 auditStore interface 加入 optional debug 欄位；既有 caller 不傳時 NULL，不強制提供。 2026-04-19 local PASS: 兩個 INSERT 路徑都綁 18 個參數，optional 欄位 undefined → null；未動既有 caller，既有行為不變。
- [x] 0.4 Unit tests 驗新欄位 round-trip（INSERT + SELECT 回 NULL / 實際值）與 backfill 策略（舊 row 讀出為 null）。 2026-04-19 local PASS: `test/unit/knowledge-audit.test.ts` +2 case（NULL default、fully-supplied、refusal-only），`test/unit/mcp-ask.test.ts` +2 case（NULL default、fully-supplied）；既有 case 更新為 18-arg 綁定；`test/unit/knowledge-audit.test.ts` 9 綠、`test/unit/mcp-ask.test.ts` 5 綠。

## 1. Debug Data Preparation

- [x] 1.1 確認 query logs 已持久化可供 debug surface 使用的 score / path / latency 欄位。 2026-04-19 local PASS: schema 就緒，6 個 debug 欄位 nullable 可用（first_token_latency_ms / completion_latency_ms INTEGER、retrieval_score / judge_score REAL、decision_path / refusal_reason TEXT），預設 NULL，INSERT 18-arg contract 綁定兩條 query_log 路徑皆通過。
- [ ] 1.2 補齊 debug-safe derived fields，避免 UI 需重跑回答流程。
- [ ] 1.3 建立 internal gating，限制 debug surfaces 僅供 Admin / internal 使用。

## 2. Decision Inspection UI

- [ ] 2.1 建立 decision path badge / panel 元件。
- [ ] 2.2 建立 retrieval score、judge score、self-correction、refusal reason 顯示元件。
- [ ] 2.3 建立 citation eligibility / evidence summary 顯示區塊。
- [ ] 2.4 將 decision inspection 整合到 internal debug route 或 detail surface。
- [ ] 2.5 補齊 loading / empty / unauthorized / error 狀態。

## 3. Latency And Outcome UI

- [ ] 3.1 建立 latency summary cards 或圖表。
- [ ] 3.2 建立 outcome breakdown 顯示 answered / refused / forbidden / error。
- [ ] 3.3 表示 null latency 與 partial stream 狀態，不偽造數值。
- [ ] 3.4 補齊 redaction-safe aggregate summary 呈現。

## 4. Integration And Verification

- [ ] 4.1 補齊 debug/latency surfaces 的 component / integration tests。
- [ ] 4.2 驗證一般使用者與 MCP 對外契約看不到 debug 欄位。
- [ ] 4.3 更新 verify docs，記錄如何在 staging / preview 使用 internal debug surface。

## 5. Design Review

- [ ] 5.1 執行 `/design improve` 對 debug / observability surfaces。
- [ ] 5.2 修復 DRIFT 與 Critical issues。
- [ ] 5.3 執行 `/review-screenshot` 驗證 internal debug pages。

## 人工檢查

- [ ] #1 Admin 可看到 decision path、score、refusal diagnostics，且與 query log 記錄一致。
- [ ] #2 一般使用者與 MCP caller 不會在正常介面看見任何 debug 欄位。
- [ ] #3 latency surface 可分辨 answered、refused、forbidden、error，且 null latency 不會被偽造。
