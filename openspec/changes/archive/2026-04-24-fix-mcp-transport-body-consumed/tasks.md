## 1. 實作 body rehydrate

- [x] 1.1 滿足 Requirement: MCP handler middleware preserves request body for transport — 實作 `rehydrateMcpRequestBody(event)` helper 於 `server/utils/mcp-rehydrate-request-body.ts`（抽獨立 util 以便 unit test）
- [x] 1.2 在 `server/mcp/index.ts` 的 `defineMcpHandler({ middleware })` 結尾 `await rehydrateMcpRequestBody(event)`，確保於 `runMcpMiddleware` 之後、handler 回傳前執行
- [x] 1.3 TypeScript 型別處理：以 `WebRequestEventShape` interface + cast 處理 `event.web.request` 讀寫
- [x] 1.4 `pnpm typecheck` 無新錯 — 確認通過

## 2. 防回歸測試

- [x] 2.1 Scope 調整：`test/integration/mcp-routes.test.ts` 透過 `runMcpTool` 繞過 HTTP transport（不適合測 transport-level body parsing）。改採 unit test + 外部 wrangler tail 作為 evidence 雙層覆蓋。
- [x] 2.2 新增 `test/unit/mcp-rehydrate-request-body.test.ts`，共 7 個 case：
  - JSON body 可被 replay Request 讀回
  - string body 原樣保留
  - undefined / null cached body 產生空 body
  - GET / HEAD 跳過 rehydrate
  - `event.web` 缺失時 no-op
  - authorization / content-type / accept header 被保留
- [x] 2.3 `pnpm test:contracts` 通過：80/80（含新 7 個 case）
- [x] 2.4 Production wrangler tail 驗收：本 change scope（body rehydrate）已通過 — 首次 `POST /mcp initialize` 由 400 → 200，`notifications/initialized` 202，`tools/list` 200（tail requestId `9f108c77...` / `9f1091b5...`）

## 3. Spec 同步

- [x] 3.1 ADDED requirement「MCP handler middleware preserves request body for transport」已寫入 `openspec/changes/fix-mcp-transport-body-consumed/specs/mcp-knowledge-tools/spec.md`（archive 階段才寫入主 spec）
- [x] 3.2 新增 `docs/solutions/mcp-body-stream-consumption.md`，涵蓋 Problem / What Didn't Work / Solution / Prevention
- [x] 3.3 `pnpm exec spectra validate fix-mcp-transport-body-consumed` 通過；`pnpm exec spectra analyze` ✓ No issues found

## 4. 部署與驗證

- [x] 4.1 `/commit` 提交所有改動（server/mcp/index.ts、test、spec、solutions doc）— commit `bf6a07e`
- [x] 4.2 `pnpm tag` 推新 patch 版本（v0.34.4 → v0.34.5）— deploy commit `8fd5665`
- [x] 4.3 GitHub Actions production deploy 完成（run `24857942870`，re-run 後 success；首次失敗原因是 `CLOUDFLARE_API_TOKEN` secret 權限不足，使用者編輯權限後過）
- [x] 4.4 `pnpm exec wrangler tail nuxt-edge-agentic-rag --format pretty` 開 tail（background task `bc0ooh5h7`）觀察完畢
- [x] 4.5 Claude.ai 觸發 `AskKnowledge`：tail 證實 `POST /mcp` initialize **200** + `tools/list` 200 — body rehydrate 的 transport-level 修復有效。但 Claude.ai 端 tool/call 仍失敗，根因非 body consumption（見 task 4.7 scope 收斂）
- [x] 4.6 Claude.ai 觸發 `ListCategories`：同上 — tools list 成功發到 Claude，但 tool/call 失敗症狀同 4.5
- [x] 4.7 GET /mcp hang 仍存在。tail pattern 分析：首次 handshake 成功後，Claude.ai 嘗試開 Streamable HTTP SSE long-lived session（`GET /mcp`），stateless transport（`sessionIdGenerator: undefined`）不快速回 405 → Worker 30 秒 hung cancel → Claude 判定連線斷 → retry `POST /mcp initialize`（body 不完整）→ 400 → 死循環。

      **Scope 收斂**：tool/call 失敗根因是 **MCP Streamable HTTP session 模式未啟用**，**非** body consumption。已另開 change `fix-mcp-streamable-http-session` 處理，本 change 不擴張。

## 5. 人工檢查

- [x] 5.1 ~~使用者本人在 Claude.ai 實測 `AskKnowledge` 回傳正常答案 + citations~~ → 延後到 `fix-mcp-streamable-http-session` change 完成後再跑（本 change scope 之外）
- [x] 5.2 ~~使用者本人在 Claude.ai 實測 `ListCategories` 回傳正確 category 清單~~ → 同 5.1
- [x] 5.3 ~~使用者確認 ChatGPT Remote MCP connector 也能 call tool（若有設定）~~ → 同 5.1
- [x] 5.4 wrangler tail 觀察：本 change scope 的 initialize → 200 穩定可重現（多次 reconnect 測試均看到首次 handshake 成功），POST body rehydrate 層面無 regression
