## 1. Discuss 階段（必做，未完成不能進 apply）

- [ ] 1.1 `/spectra-discuss fix-mcp-streamable-http-session` 收斂方向 A / B / C，寫入 design.md
- [ ] 1.2 決定 session state 儲存位置（KV / Durable Objects / memory + lazy revive）及 TTL 策略
- [ ] 1.3 確認 Cloudflare Workers 對 SSE long-lived 連線的實作限制（30 秒 CPU 上限、heartbeat 策略）
- [ ] 1.4 決定 `nuxt.config.ts` 的 provider alias：是否仍用 node provider、或改回 cloudflare provider + `mcp-agents-compat.ts` shim
- [ ] 1.5 決定 session / auth 生命週期綁定：token per session 還是 session per request？rate-limit 窗口對應 token 還是 session？

## 2. Spec 同步

- [ ] 2.1 滿足 Requirement: MCP handler supports Streamable HTTP session with SSE channel — 在本 change 的 `specs/mcp-knowledge-tools/spec.md` 把 DRAFT scenario 補完（從 discuss 產出的 design.md 擷取）
- [ ] 2.2 `pnpm exec spectra validate fix-mcp-streamable-http-session` + `analyze` 通過（無 CRITICAL / WARNING）

## 3. 實作（待 discuss 收斂後填具體細節）

- [ ] 3.1 Session store util（位置 TBD）
- [ ] 3.2 `server/mcp/index.ts` 或 `server/utils/mcp-agents-compat.ts` 支援 session lifecycle
- [ ] 3.3 GET /mcp SSE handler（若走方向 A）或 fast 405 responder（若走方向 B）
- [ ] 3.4 middleware 調整：auth / rate-limit 與 session 的互動

## 4. 防回歸測試

- [ ] 4.1 Unit：session-id 產生、parse、lookup
- [ ] 4.2 Integration：完整 Streamable HTTP flow（initialize → GET SSE → tool call）
- [ ] 4.3 `rehydrateMcpRequestBody` 仍在且 unit test 不 regress
- [ ] 4.4 `pnpm test:contracts` + `pnpm typecheck` 全綠

## 5. 部署與驗證

- [ ] 5.1 `/commit` → `pnpm tag` → 自動 deploy
- [ ] 5.2 wrangler tail 觀察：GET /mcp 不再 hung、POST 不再 re-initialize 死循環
- [ ] 5.3 Claude.ai 實測 `AskKnowledge` 回真實答案 + citations
- [ ] 5.4 Claude.ai 實測 `ListCategories` 回真實 category 清單
- [ ] 5.5 ChatGPT Remote MCP（若有設定）實測同上

## 6. 人工檢查

- [ ] 6.1 使用者 Claude.ai 可穩定多輪 tool call（連續 3 次不同 query）
- [ ] 6.2 wrangler tail 觀察至少 5 分鐘，無 Worker hung / 無 re-initialize 循環
- [ ] 6.3 `fix-mcp-transport-body-consumed` 的 regression test 仍過（rehydrate helper 未被打破）
