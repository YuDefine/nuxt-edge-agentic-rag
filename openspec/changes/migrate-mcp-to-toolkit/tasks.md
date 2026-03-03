> **前置條件**：本 change 為 `v1.0.0` 同版後置第一個，**必須等** `bootstrap-v1-core-from-report` 與 `add-v1-core-ui` archive 完成後才 apply。apply 前先跑 Pre-Apply Gates。
>
> **本 change 為 backend-only refactor**：不觸 `.vue` / `pages/` / `components/` / `layouts/`，**不需** Design Review 區塊（遵循 `.claude/rules/proactive-skills.md` 的非 UI change 例外）。
>
> **Design 對應**：下列 tasks 按 design.md 的 Architecture 章節一對一落地：
>
> - **Before（v1.0.0 現況）→ After（toolkit wiring）** 轉換：由 §1（Foundations：建立 toolkit handler + middleware 單層）+ §2（Tool Migration：逐個搬移 4 個 endpoint 為 defineMcpTool）+ §5.1（刪除舊 `server/api/mcp/`）共同完成
> - **File layout** 目標結構：由 §1.2 建立 `server/mcp/index.ts`、§2.1–2.4 建立 `server/mcp/tools/{ask,search,categories,get-document-chunk}.ts`、§5.1 刪除 `server/api/mcp/`、§5.2 確認 `server/utils/mcp-*.ts` 保持 unchanged 共同落地

## 0. Pre-Apply Gates（apply 前必過）

- [ ] 0.1 Blocker archive 確認 — `bootstrap-v1-core-from-report` + `add-v1-core-ui` 已 archive（MCP 契約凍結）
- [ ] 0.2 Baseline 測試全綠 — `pnpm test:contracts && pnpm test:integration && pnpm test:acceptance` 於遷移前為綠色基線
- [x] 0.3 Bundle size baseline — `wrangler deploy --dry-run` 記錄遷移前 Workers bundle 大小（KB gzipped），作為增量基準
      2026-04-19 local PASS/RESULT: baseline Total Upload 3071.13 KiB / gzip 685.00 KiB（nuxt build + wrangler deploy --dry-run）
- [x] 0.4 安裝 `@nuxtjs/mcp-toolkit` 最新穩定版（0.13.x）並跑 `wrangler deploy --dry-run` 測增量，**增量 ≥ 300 KB gzipped 或逼近 1 MB 時停下評估**，不得直接硬上
      2026-04-19 local PASS/RESULT: 安裝 @nuxtjs/mcp-toolkit@0.13.4 + peerDep agents（Q1 要求）；nuxt.config.ts modules 加入 '@nuxtjs/mcp-toolkit'；rebuild 後 Total Upload 3559.53 KiB / gzip 794.99 KiB；delta = 488.40 KiB raw / **109.99 KiB gzip**（<300 KB 閾值；距 1 MB 上限 ~205 KB 餘裕）→ 繼續 §1

## 1. Foundations

- [x] 1.1 Module 註冊 — `nuxt.config.ts` 的 `modules` 陣列加入 `'@nuxtjs/mcp-toolkit'`；`devtools` dev-only gate 確認（toolkit build-time 處理，無需 runtime flag）
      2026-04-19 local PASS/RESULT: nuxt.config.ts modules 陣列尾端加入 '@nuxtjs/mcp-toolkit'；未動 devtools 區塊，toolkit 內部以 `if (nuxt.options.dev)` build-time gate 處理 inspector（module.mjs:261-265），production bundle 自然 tree-shake
- [x] 1.2 Handler 骨架 — 建立 `server/mcp/index.ts` 以 `defineMcpHandler({ middleware })`，middleware 只放 TODO stub，tool list 為空；`pnpm dev` 啟動確認 `/mcp` endpoint 可回空 `tools/list` JSON-RPC 回應、inspector 可連線
      2026-04-19 local PASS/RESULT: `server/mcp/index.ts` 建立並以 `defineMcpHandler({ middleware })` 包裝 `runMcpMiddleware`；`server/mcp/tools/` 空目錄就位；`nuxt build` 成功，nitro.mjs 內註冊 `/mcp`、`/mcp/deeplink`、`/mcp/badge.svg` 三條路由；toolkit peerDep `agents` 已安裝。dev server 人工 smoke 將於 §6.6 inspector 人工檢查階段執行，此階段僅確認 wiring / bundle OK
- [x] 1.3 Middleware 實作（TDD）— test red：request 無 Bearer → 401；過量請求 → 429。實作：middleware 呼叫 `requireMcpAuth(event)` + `checkMcpRateLimit(event, tokenId, toolName)`（用既有 `server/utils/mcp-{auth,rate-limit}.ts`）。test green
      2026-04-19 local PASS/RESULT: TDD red → green。Red：`test/unit/mcp-middleware.test.ts` 新增 4 個 case（missing Bearer → 401、unknown token → 401、rate limit 超限 → 429、成功 path 寫入 event.context.mcpAuth），import `#server/utils/mcp-middleware` 模組不存在 → 4/4 fail。Implement：建立 `server/utils/mcp-middleware.ts`（放在 utils 而非 server/mcp/ 以避免 toolkit loadHandlers 誤掃為 handler；toolkit 只把 `server/mcp/` 非 index / 非 tools|resources|prompts 子目錄的檔案當 custom handler）。包裝 `requireMcpBearerToken` + `consumeMcpToolRateLimit`，tool name → rate preset map（askKnowledge / searchKnowledge / listCategories / getDocumentChunk；未知 tool 回退 askKnowledge）；throw 時轉 `createError({ statusCode })` 以符合 MCP spec。Green：4/4 pass

## 2. Tool Migration（逐個 TDD：red → implement → green）

- [ ] 2.1 `ask` tool — 紅：`test/unit/mcp-ask.test.ts` 改為打 toolkit 定義的 tool schema。實作 `server/mcp/tools/ask.ts` 以 `defineMcpTool` 包裝現有 `mcp-ask.ts` util，`inputSchema` 沿用原 Zod schema。綠
- [ ] 2.2 `search` tool — 同模式遷移 `mcp-search.ts`，scope check `knowledge.search`
- [ ] 2.3 `categories` tool — 同模式遷移 `mcp-categories.ts`，scope check `knowledge.search`（或 catalogue scope，依現有 `mcp-auth` 定義）
- [ ] 2.4 `get-document-chunk` tool — 同模式遷移 `mcp-replay.ts` 的 chunk retrieval，scope check `knowledge.replay`；**必須**保留 403 throw 前寫 `query_logs` 的既有行為（對齊 spec `status='blocked'`）

## 3. Integration Tests Migration

- [ ] 3.1 `test/integration/mcp-routes.test.ts` — 改為打 `/mcp` JSON-RPC endpoint 而非 4 個 `/api/mcp/*` path；contract 斷言（response shape、錯誤碼）不變
- [ ] 3.2 Acceptance tests — 更新 `test/integration/acceptance-tc-{01,12,13,16,18,20}.test.ts` 中所有 `/api/mcp/*` 呼叫；TC-12 MCP replay 必須維持綠
- [ ] 3.3 全量回歸 — `pnpm test:contracts && pnpm test:integration && pnpm test:acceptance && pnpm test:unit` 全綠

## 4. 內部引用點 sync（URL 統一副作用）

- [ ] 4.1 `scripts/create-mcp-token.ts:147` — console.log 提示訊息從 `/api/mcp/search` 改為 `/mcp`（POST + JSON-RPC body 範例）
- [ ] 4.2 `docs/verify/rollout-checklist.md:281` — curl 範例從 `/api/mcp/chunks/$CITATION_ID` 改為 `/mcp` + JSON-RPC `getDocumentChunk` call
- [ ] 4.3 `docs/verify/staging-deploy-checklist.md:180,187` — curl 範例從 `/api/mcp/search`、`/api/mcp/chunks/*` 改為 `/mcp` + JSON-RPC
- [ ] 4.4 `template/HANDOFF.md:18` — 交接範例同步

## 5. Cleanup

- [ ] 5.1 刪除 `server/api/mcp/` 目錄（4 個 endpoint 檔 + `chunks/` 子目錄）
- [ ] 5.2 Confirm util `server/utils/mcp-{auth,rate-limit,replay,ask,search,categories,token-store}.ts` 仍被 `server/mcp/**` 正常 import；無 dead code
- [ ] 5.3 `openspec/config.yaml` tech stack 從 `"MCP via Nitro-native event handlers in v1.0.0; migrate to @nuxtjs/mcp-toolkit as the first post-core change ..."` 更新為 `"MCP via @nuxtjs/mcp-toolkit (migrated from Nitro-native event handlers)"`
- [ ] 5.4 `main-v0.0.4X.md` 新版報告同步更新 MCP 層實作敘述（v1.0.0 交付時為 Nitro-native → 本 change apply 後已遷移）

## 6. Verification

- [ ] 6.1 Contract tests 全綠（`pnpm test:contracts`）
- [ ] 6.2 Integration tests 全綠（`pnpm test:integration`）
- [ ] 6.3 Acceptance tests 全綠（`pnpm test:acceptance`）
- [ ] 6.4 TC-12 MCP replay 端對端手動驗證：建 mcp_token → 打 `/mcp` `getDocumentChunk` → 200 + chunk content；無 scope 的 token → 403 + `query_logs.status='blocked'`
- [ ] 6.5 Bundle size 最終確認 — `wrangler deploy --dry-run` 增量 < 300 KB gzipped
- [ ] 6.6 Inspector 人工 smoke — dev 連 `http://localhost:6274`，對每個 tool 打一次 happy path + 一次錯誤 path
- [ ] 6.7 Staging deploy + 走 `docs/verify/staging-deploy-checklist.md` 的 MCP 相關章節

## 7. 人工檢查

> 本 change 為 backend-only，無 UI journey。人工檢查限於 MCP 契約與部署。

- [ ] 7.1 外部 MCP client（若有實際使用者）通知 URL 變更為 `/mcp`
- [ ] 7.2 確認無 production 遺留 inspector route（`wrangler tail` 觀察）
- [ ] 7.3 Archive 前 review `design.md` 的 Non-Goals，確認無越界變更混入
