## 1. Debug Data Preparation

- [ ] 1.1 確認 query logs 已持久化可供 debug surface 使用的 score / path / latency 欄位。
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
