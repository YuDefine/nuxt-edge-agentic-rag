## 1. Discuss 階段（完成）

- [x] 1.1 `/spectra-discuss fix-mcp-streamable-http-session` 收斂方向 — **方向 B 採用**，A/C 拒絕。結論寫入 `design.md`
- [x] 1.2 決定 session state 儲存位置 — **不用 session**（stateless 是 Workers 官方推薦 + knowledge tools 無 state 需求）
- [x] 1.3 確認 Cloudflare Workers 對 SSE long-lived 連線的實作限制 — 30s CPU 上限 + 跨 instance memory 不共享，本 change 改走 JSON response 避開此問題
- [x] 1.4 決定 `nuxt.config.ts` 的 provider alias — **不動**，保持 `agents/mcp → mcp-agents-compat.ts` 自訂 shim
- [x] 1.5 決定 session / auth 生命週期綁定 — **不引入 session**；auth / rate-limit 維持 token-scoped（見 spec.md 新增 Requirement）

## 2. Spec 同步

- [x] 2.1 補齊本 change 的 `specs/mcp-knowledge-tools/spec.md` — 已填實 3 個 Requirement（GET/DELETE 405、POST JSON response、auth 語義保留）及 6 個 Scenario
- [x] 2.2 `pnpm exec spectra validate fix-mcp-streamable-http-session` + `analyze` 通過（無 CRITICAL / WARNING）

## 3. 實作（方向 B）

- [x] 3.1 MCP handler rejects GET and DELETE with 405 per MCP spec stateless mode — 修改 `server/utils/mcp-agents-compat.ts` `createMcpHandler`，對 `GET /mcp` 與 `DELETE /mcp` 立即回 `405` + `Allow: POST` header + JSON-RPC error body（`code: -32000`，`id: null`）
- [x] 3.1.1 MCP handler POST path enforces JSON response over SSE — 同檔案 POST 路徑 `new WebStandardStreamableHTTPServerTransport` 時加 `enableJsonResponse: true`，確保 response `Content-Type: application/json` 而非 SSE stream
- [x] 3.2 Stateless MCP handler preserves existing auth and rate-limit semantics — 確認 middleware（`mcpAuth` / rate-limit / role-gate）不需動，POST path 進 transport 前的 auth flow 沿用現況，rate-limit 窗口仍以 token 為 key
- [x] 3.3 不動 `nuxt.config.ts` `nitro.alias`、不動 `rehydrateMcpRequestBody`、不 wire up `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` flag

## 4. 防回歸測試

- [x] 4.1 Unit（`test/unit/mcp-agents-compat.spec.ts` 新或擴充）：
  - `GET /mcp` → `405` + `Allow: POST` + JSON-RPC error body
  - `DELETE /mcp` → `405`
  - `GET /unrelated` → `404`（route guard 仍運作）
  - `POST /mcp` 合法 initialize body（mock transport）→ `200`
- [x] 4.2 Integration（`test/integration/mcp-streamable-http.spec.ts` 新）：
  - 完整 handshake：`POST initialize` → `POST notifications/initialized` → `POST tools/list` 全綠
  - `GET /mcp` 響應時間 `<1s`（確認不再 hang 30s）
  - `POST tools/call { name: ListCategories }` → `200` + JSON 含 categories
  - 連續 3 次 tool call 不觸發 re-initialize
- [x] 4.3 `rehydrateMcpRequestBody` 既有 unit test 仍綠（前置 change 未被打破）
- [x] 4.4 `pnpm test:contracts` + `pnpm typecheck` + `pnpm lint` 全綠

## 5. 部署與驗證

- [ ] 5.1 `/commit`（含版本號升級 — `fix` 走 patch）→ auto deploy
- [ ] 5.2 wrangler tail 觀察 5 分鐘：
  - `GET /mcp` 立即 `405`，無 `"code had hung"` 錯誤
  - POST 全程 `200/202`，無 re-initialize 循環
- [ ] 5.3 Claude.ai 實測 `AskKnowledge` 連續 3 次不同 query，皆回真實答案 + citations
- [ ] 5.4 Claude.ai 實測 `ListCategories`，回真實 category 清單
- [ ] 5.5 ChatGPT Remote MCP（若有設定）重複 5.3 / 5.4

## 6. 人工檢查

- [ ] 6.1 使用者 Claude.ai 可穩定多輪 tool call（連續 3 次不同 query 無 error banner）
- [ ] 6.2 wrangler tail 觀察至少 5 分鐘，無 Worker hung、無 re-initialize 循環、無 SSE timeout
- [ ] 6.3 `fix-mcp-transport-body-consumed` 的 regression test 仍過（`rehydrateMcpRequestBody` 未被打破）
- [ ] 6.4 若 Claude.ai 對 `405` 有異常反應（不接受 / 誤判為網路錯誤）→ 不勾選本檢查，改開 fallback change `upgrade-mcp-to-durable-objects`（見 `design.md` Fallback Plan）

## 7. Archive

- [x] 7.1 寫 `docs/solutions/mcp-streamable-http-405-stateless.md` 沉澱 root cause + 方案決策（含拒絕 A/C 的理由，避免未來被誤導重做）
- [x] 7.2 `HANDOFF.md` 移除 `fix-mcp-streamable-http-session` 條目
- [ ] 7.3 `/spectra-archive fix-mcp-streamable-http-session`（delta spec sync 到 `openspec/specs/mcp-knowledge-tools/spec.md`）
