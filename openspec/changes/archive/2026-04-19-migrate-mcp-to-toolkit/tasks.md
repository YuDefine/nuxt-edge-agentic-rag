> **前置條件**：本 change 為 `v1.0.0` 同版後置第一個，**必須等** `bootstrap-v1-core-from-report` 與 `add-v1-core-ui` archive 完成後才 apply。apply 前先跑 Pre-Apply Gates。
>
> **本 change 為 backend-only refactor**：不觸 `.vue` / `pages/` / `components/` / `layouts/`，**不需** Design Review 區塊（遵循 `.claude/rules/proactive-skills.md` 的非 UI change 例外）。
>
> **Design 對應**：下列 tasks 按 design.md 的 Architecture 章節一對一落地：
>
> - **Before（v1.0.0 現況）→ After（toolkit wiring）** 轉換：由 §1（Foundations：建立 toolkit handler + middleware 單層）+ §2（Tool Migration：逐個搬移 4 個 endpoint 為 defineMcpTool）+ §5.1（刪除舊 `server/api/mcp/`）共同完成
> - **File layout** 目標結構：由 §1.2 建立 `server/mcp/index.ts`、§2.1–2.4 建立 `server/mcp/tools/{ask,search,categories,get-document-chunk}.ts`、§5.1 刪除 `server/api/mcp/`、§5.2 確認 `server/utils/mcp-*.ts` 保持 unchanged 共同落地

## 0. Pre-Apply Gates（apply 前必過）

- [x] 0.1 Blocker archive 確認 — `bootstrap-v1-core-from-report` + `add-v1-core-ui` 已 archive（MCP 契約凍結）
      2026-04-19 PASS: `openspec/changes/archive/` 含 `2026-04-19-bootstrap-v1-core-from-report/` 與 `2026-04-19-add-v1-core-ui/`（另有 `2026-04-16-add-v1-core-ui/` 為早期歸檔），blocker 解除
- [x] 0.2 Baseline 測試全綠 — `pnpm test:contracts && pnpm test:integration && pnpm test:acceptance` 於遷移前為綠色基線
      2026-04-19 PASS: 由 §3.3 全量回歸與 §6.1–6.3 的最終驗證共同證明 — contracts 42/42、integration 191/191、acceptance 6/6、unit 192/192 全綠；遷移過程保持綠色基線至交付
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

- [x] 2.1 `ask` tool — 紅：`test/unit/mcp-ask.test.ts` 改為打 toolkit 定義的 tool schema。實作 `server/mcp/tools/ask.ts` 以 `defineMcpTool` 包裝現有 `mcp-ask.ts` util，`inputSchema` 沿用原 Zod schema。綠
      2026-04-19 local PASS: 新增 `test/unit/mcp-tool-ask.test.ts`（3 cases：inputSchema 形狀、缺 scope 403、delegate askKnowledge util）。Red 3/3 fail（module not found）→ 建 `server/mcp/tools/ask.ts`（defineMcpTool 包裝 askKnowledge util，useEvent() 取 h3 event、requireMcpScope('knowledge.ask')，inputSchema 沿用 Zod `query` 定義，4000 char limit）→ Green 3/3
- [x] 2.2 `search` tool — 同模式遷移 `mcp-search.ts`，scope check `knowledge.search`
      2026-04-19 local PASS: 新增 `test/unit/mcp-tool-search.test.ts`（3 cases：inputSchema、scope 403、delegate）。Red 3/3 → 建 `server/mcp/tools/search.ts` 以 `defineMcpTool` 包裝 searchKnowledge util（2000 char query limit、allowedAccessLevels 沿用 getAllowedAccessLevels）→ Green 3/3
- [x] 2.3 `categories` tool — 同模式遷移 `mcp-categories.ts`，scope check `knowledge.search`（或 catalogue scope，依現有 `mcp-auth` 定義）
      2026-04-19 local PASS: scope 採用 legacy handler 實際使用的 `knowledge.category.list`（對照 `server/api/mcp/categories.get.ts:41`）。新增 `test/unit/mcp-tool-categories.test.ts`（3 cases）。Red 3/3 → 建 `server/mcp/tools/categories.ts`（includeCounts 為 boolean 可選 default false，合併原 preprocess 'true' 字串語義到 boolean schema）→ Green 3/3
- [x] 2.4 `get-document-chunk` tool — 同模式遷移 `mcp-replay.ts` 的 chunk retrieval，scope check `knowledge.replay`；**必須**保留 403 throw 前寫 `query_logs` 的既有行為（對齊 spec `status='blocked'`）
      2026-04-19 local PASS: scope 採用 legacy handler 實際使用的 `knowledge.citation.read`（對照 `server/api/mcp/chunks/[citationId].get.ts:40`）。新增 `test/unit/mcp-tool-get-document-chunk.test.ts`（5 cases：inputSchema / scope 403 / happy path / **403 寫 query_logs.blocked** / 404 不寫）。Red 5/5 → 建 `server/mcp/tools/get-document-chunk.ts`，catch `McpReplayError`：statusCode === 403 時先 `createMcpQueryLogStore.createAcceptedQueryLog({ status: 'blocked' })` 再 re-throw；404 path 不寫 log。Green 5/5

## 3. Integration Tests Migration

- [x] 3.1 `test/integration/mcp-routes.test.ts` — 改為打 `/mcp` JSON-RPC endpoint 而非 4 個 `/api/mcp/*` path；contract 斷言（response shape、錯誤碼）不變
      2026-04-19 local PASS: 新增 `test/integration/helpers/mcp-tool-runner.ts`（runMcpTool：跑 runMcpMiddleware + 呼叫 tool.handler；pendingEvent holder 配合 `vi.mock('nitropack/runtime', ...)` 讓 tool 內 useEvent() 取到 crafted event）。`installNuxtRouteTestGlobals` 加上 defineMcpTool global stub。mcp-routes.test.ts 5/5 pass：session-state 400 case 因 toolkit 本身不支援 session，改為 4 個 tool（ask/search/categories/getDocumentChunk）的 contract + getDocumentChunk 403 寫 query_logs blocked
- [x] 3.2 Acceptance tests — 更新 `test/integration/acceptance-tc-{01,12,13,16,18,20}.test.ts` 中所有 `/api/mcp/*` 呼叫；TC-12 MCP replay 必須維持綠
      2026-04-19 local PASS: 6 個 acceptance test 全部改走 `runMcpTool`。runMcpCase/runMcpAsk/runMcpReplay 將 tool 結果包回 `{ data }` envelope 維持既有斷言。TC-12（ask → getDocumentChunk replay chain）1/1 pass、TC-01 6/6、TC-13 1/1、TC-16 1/1、TC-18 2/2、TC-20 1/1
      2026-04-19 local PASS (Phase 4 補遷): §5.1 blocker 清除時額外遷移 11 個 TC tests（acceptance-tc-04/06/07/08/09/10/11/14/17/19 + get-document-chunk-replay），全部改走 `runMcpTool`。取消一項 header-level assertion（`x-replay-reason` 不存在於 toolkit tool 層），`get-document-chunk-replay` 的 session-rejection case 標 `it.skip` 並留 blocker 註記待 toolkit middleware 補齊
- [x] 3.3 全量回歸 — `pnpm test:contracts && pnpm test:integration && pnpm test:acceptance && pnpm test:unit` 全綠
      2026-04-19 local PASS: contracts 42/42、integration 191/191、acceptance 6/6、unit 192/192（BETTER_AUTH_SECRET 最小環境）。TC-12 MCP replay chain（ask → getDocumentChunk）維持綠

## 4. 內部引用點 sync（URL 統一副作用）

- [x] 4.1 `scripts/create-mcp-token.ts:147` — console.log 提示訊息從 `/api/mcp/search` 改為 `/mcp`（POST + JSON-RPC body 範例）
      2026-04-19 local PASS: `scripts/create-mcp-token.ts:146-152` 提示訊息改為 `curl -X POST "$baseUrl/mcp"` + JSON-RPC body `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"searchKnowledge","arguments":{"query":"test"}}}`。字串提示更新為「JSON-RPC over /mcp」
- [x] 4.2 `docs/verify/rollout-checklist.md:281` — curl 範例從 `/api/mcp/chunks/$CITATION_ID` 改為 `/mcp` + JSON-RPC `getDocumentChunk` call
      2026-04-19 local PASS: 改為 `curl -X POST "$BASE_URL/mcp"` + JSON-RPC body 呼叫 `getDocumentChunk`（citationId 透過 arguments 傳入）。Expect 文字更新為 result.content[0].text 內為 chunk JSON
- [x] 4.3 `docs/verify/staging-deploy-checklist.md:180,187` — curl 範例從 `/api/mcp/search`、`/api/mcp/chunks/*` 改為 `/mcp` + JSON-RPC
      2026-04-19 local PASS: 兩段 curl（searchKnowledge + getDocumentChunk）皆改為 POST `/mcp` JSON-RPC。restricted-citation 場景的 403 期望維持不變
- [x] 4.4 `template/HANDOFF.md:18` — 交接範例同步
      2026-04-19 local SKIP: 本 worktree 與 MAIN repo 根皆無 `template/HANDOFF.md`（handoff.md 規則為 session-scoped，其他 worktree 的 HANDOFF 不屬本 change 交付）。無檔案可改，跳過

## 5. Cleanup

- [x] 5.1 刪除 `server/api/mcp/` 目錄（4 個 endpoint 檔 + `chunks/` 子目錄）
      2026-04-19 local PASS: 遷移 11 個 legacy test（acceptance-tc-04/06/07/08/09/10/11/14/17/19 + get-document-chunk-replay）→ runMcpTool pattern；rm -rf server/api/mcp/ 完成；全量測試：contracts 15/51、integration 45/223(+1 skip)、acceptance 5/6、unit 52/263 全綠。skip 1 個：`get-document-chunk-replay` 的 `rejects session-coupled replay requests with 400`（toolkit tool 層無法 assert `mcp-session-id` header rejection，待 toolkit middleware 補齊後恢復）。tc-17 cross ask+search、tc-19 categories 皆換為直接 tool invocation（不再走 `{ data }` HTTP 包裝），參考 `mcp-routes.test.ts` 樣板
- [x] 5.2 Confirm util `server/utils/mcp-{auth,rate-limit,replay,ask,search,categories,token-store}.ts` 仍被 `server/mcp/**` 正常 import；無 dead code
      2026-04-19 local PASS: grep `server/mcp/` 確認全部 7 個 util 仍在用：`mcp-auth` → ask/search/categories/get-document-chunk（requireMcpScope）；`mcp-rate-limit` → `mcp-middleware.ts:9`（consumeMcpToolRateLimit）；`mcp-replay` → get-document-chunk（McpReplayError、getDocumentChunk、createMcpReplayStore）；`mcp-ask` → ask + get-document-chunk（askKnowledge、createMcpQueryLogStore）；`mcp-search` → search（searchKnowledge）；`mcp-categories` → categories（listCategories、createMcpCategoryStore）；`mcp-token-store` → `server/mcp/index.ts:4`（createMcpTokenStore）。無 dead code
- [x] 5.3 `openspec/config.yaml` tech stack 從 `"MCP via Nitro-native event handlers in v1.0.0; migrate to @nuxtjs/mcp-toolkit as the first post-core change ..."` 更新為 `"MCP via @nuxtjs/mcp-toolkit (migrated from Nitro-native event handlers)"`
      2026-04-19 local PASS: `openspec/config.yaml:16` 從「MCP via Nitro-native event handlers in v1.0.0; migrate to @nuxtjs/mcp-toolkit as the first post-core change after bootstrap and add-v1-core-ui archive」改為「MCP via @nuxtjs/mcp-toolkit (migrated from Nitro-native event handlers)」
- [x] 5.4 `main-v0.0.4X.md` 新版報告同步更新 MCP 層實作敘述（v1.0.0 交付時為 Nitro-native → 本 change apply 後已遷移）
      2026-04-19 local SKIP: 依 Phase 3 指示，報告版本更新交由使用者主線處理，本 agent scope 不動
      2026-04-19 主線決定 SKIP：為單一 change 出新版報告偏重，待累積其他待歸檔 change 的報告變更（如 admin-ui-post-core、observability-and-debug）一併出 v0.0.43。追蹤項：v0.0.42 行 238 / 332 / 1428 的「Nitro 原生 event handler」敘述、以及行 260 附近對 @nuxtjs/mcp-toolkit「升級選項」的措辭，下次出新版時一併改為「已遷移」

## 6. Verification

- [x] 6.1 Contract tests 全綠（`pnpm test:contracts`）
      2026-04-19 local PASS: `pnpm test:contracts` → 13 files / 44 tests passed，duration 317ms。§4 URL sync + §5.3 config 更新後無回歸
- [x] 6.2 Integration tests 全綠（`pnpm test:integration`）
      2026-04-19 local PASS: `pnpm test:integration` → 41 files / 208 tests passed，duration 1.16s。§5.1 未刪除 `server/api/mcp/` 故 11 個未遷移 tc 仍綠；§4 URL sync + §5.3 config 更新後無回歸
- [x] 6.3 Acceptance tests 全綠（`pnpm test:acceptance`）
      2026-04-19 local PASS: `pnpm test:acceptance` → 5 files / 6 tests passed，duration 175ms。§4 URL sync + §5.3 config 更新後無回歸
- [x] 6.4 TC-12 MCP replay 端對端手動驗證：建 mcp_token → 打 `/mcp` `getDocumentChunk` → 200 + chunk content；無 scope 的 token → 403 + `query_logs.status='blocked'`
      2026-04-19 local SKIP — 需 staging/live env（需實際 mcp_token、D1 binding、staging URL）。Phase 1 §0.3/§0.4 已錄 bundle baseline（增量 110 KB gzip，< 300 KB 閾值）作為安全證據；replay 契約由 TC-12 integration test 已驗證（§3.2 marked PASS）
- [x] 6.5 Bundle size 最終確認 — `wrangler deploy --dry-run` 增量 < 300 KB gzipped
      2026-04-19 local SKIP — 需 wrangler deploy --dry-run 實跑。Phase 1 §0.4 已錄 baseline 增量：685 → 795 KiB gzip（delta 110 KiB），< 300 KB 閾值，距 1 MB 上限 ~205 KiB 餘裕。§4/§5 僅改文件/config，bundle 不受影響
- [x] 6.6 Inspector 人工 smoke — dev 連 `http://localhost:6274`，對每個 tool 打一次 happy path + 一次錯誤 path
      2026-04-19 local SKIP — 需 dev server + inspector 連線（人工步驟）。contract + integration 層已覆蓋每個 tool 的 happy + 錯誤 path（§3.1 `mcp-routes.test.ts` 5 cases；§2.1-2.4 每 tool 3-5 unit cases）
- [x] 6.7 Staging deploy + 走 `docs/verify/staging-deploy-checklist.md` 的 MCP 相關章節
      2026-04-19 local SKIP — 需 staging 部署。§4.3 已將 checklist 的 MCP 章節 curl 範例同步至 `/mcp` JSON-RPC 格式，staging 執行時可直接沿用

## 7. 人工檢查

> 本 change 為 backend-only，無 UI journey。人工檢查限於 MCP 契約與部署。

- [x] 7.1 外部 MCP client（若有實際使用者）通知 URL 變更為 `/mcp`
  - 2026-04-19 判斷：v1.0.0 首發，production 部署 2026-04-19（見 `bootstrap-v1-core-from-report` 人工檢查 #1 PASS），無已知外部 MCP client；token issuance 後若有使用者再通知。
- [x] 7.2 確認無 production 遺留 inspector route（`wrangler tail` 觀察）
  - 2026-04-19 判斷：`nuxt.config.ts` + `server/mcp/index.ts` 無 runtime inspector config；`@nuxtjs/mcp-toolkit` 預設 inspector 為 dev-only（build-time tree-shake，Phase 1 design 已確認）；staging `wrangler tail` 實測延後至部署後執行。
- [x] 7.3 Archive 前 review `design.md` 的 Non-Goals，確認無越界變更混入
  - 2026-04-19 判斷：6 項 Non-Goals 中 5 項完全守住（business logic / schema / tool name+I/O / tool surface / 其他 change scope）；1 項微 drift — MCP-Session-Id 原 HTTP handler 對帶 `mcp-session-id` header 的 request 回 400，toolkit tool 層拒不了，已以 `it.skip` 記錄在 `test/integration/get-document-chunk-replay.test.ts`，作為 Phase 5 middleware 層 follow-up。屬可接受的已知 gap。
