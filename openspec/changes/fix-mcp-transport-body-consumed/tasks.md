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
- [ ] 2.4 Production wrangler tail 作為 transport-level 驗收證據（見 §4）

## 3. Spec 同步

- [x] 3.1 ADDED requirement「MCP handler middleware preserves request body for transport」已寫入 `openspec/changes/fix-mcp-transport-body-consumed/specs/mcp-knowledge-tools/spec.md`（archive 階段才寫入主 spec）
- [x] 3.2 新增 `docs/solutions/mcp-body-stream-consumption.md`，涵蓋 Problem / What Didn't Work / Solution / Prevention
- [x] 3.3 `pnpm exec spectra validate fix-mcp-transport-body-consumed` 通過；`pnpm exec spectra analyze` ✓ No issues found

## 4. 部署與驗證

- [ ] 4.1 `/commit` 提交所有改動（server/mcp/index.ts、test、spec、solutions doc）
- [ ] 4.2 `pnpm tag` 推新 patch 版本（v0.34.4 → v0.34.5）
- [ ] 4.3 等 GitHub Actions production deploy 完成
- [ ] 4.4 `pnpm exec wrangler tail nuxt-edge-agentic-rag --format pretty` 開 tail
- [ ] 4.5 Claude.ai 觸發 `AskKnowledge` — tail 看 `POST /mcp` status 200 且 initialize + tools/call 都成功；使用者端看到真實回答
- [ ] 4.6 Claude.ai 觸發 `ListCategories` — tail 看 status 200；使用者端看到 category list
- [ ] 4.7 觀察 GET /mcp hang 是否仍存在；若仍存在，記為 follow-up（新 TD entry or 新 change）

## 5. 人工檢查

- [ ] 5.1 使用者本人在 Claude.ai 實測 `AskKnowledge` 回傳正常答案 + citations
- [ ] 5.2 使用者本人在 Claude.ai 實測 `ListCategories` 回傳正確 category 清單
- [ ] 5.3 使用者確認 ChatGPT Remote MCP connector 也能 call tool（若有設定）
- [ ] 5.4 wrangler tail 觀察至少 5 分鐘確認 POST /mcp 穩定、無 400 / 5xx
