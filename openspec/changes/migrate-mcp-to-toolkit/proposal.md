## Summary

將 `v1.0.0` 已上線的 Nitro 原生 MCP 實作（4 個 endpoint + 6 支 util）遷移至 `@nuxtjs/mcp-toolkit`，以換取 file-based discovery、Zod schema 統一、內建 inspector 與 toolkit 後續升級空間。遷移範圍僅限 transport / wiring 層，不動 ask / search / categories / chunks 的業務邏輯與治理行為。

> Status: **Draft** — 本 change 為 `v1.0.0` 同版後置工作。**實際 `/spectra-apply` 需等 `bootstrap-v1-core-from-report` 與 `add-v1-core-ui` archive 後才啟動**，避免與正在進行的人工驗收重疊。

## Motivation

`v1.0.0` 為了趕核心閉環 deadline（2026-04-22），MCP 採 Nitro 原生 event handler 手刻。目前已驗證可行，但三個結構性代價需在同版階段處理：

1. **Tool schema 與 runtime 行為分散** — 每個 endpoint 各自 parse / 驗 Bearer / 驗 scope / rate limit / replay，`server/utils/mcp-*.ts` 6 支 util 彼此只靠 convention 串接，新增 tool 需複製樣板。
2. **無 inspector，debug 仰賴 log** — `@nuxtjs/mcp-toolkit` 內建 inspector 可直接打 tool、看 request/response，縮短 MCP 整合問題定位時間。
3. **tech stack 宣告與實作已偏離** — `openspec/config.yaml` tech direction 本就指向 `@nuxtjs/mcp-toolkit`，長期維持 Nitro 手刻會持續欠下技術債。

## Scope

### In-Scope

- **Transport 遷移**：將 `server/api/mcp/{ask.post,categories.get,search.post}.ts` 與 `server/api/mcp/chunks/[citationId].get.ts` 改寫為 `defineMcpTool({...})` 單檔 default export，放至 `server/mcp/tools/`
- **URL surface 決策**：toolkit 預設把所有 tool 聚合到單一 `/mcp` JSON-RPC endpoint — 需於 apply 前決定是否用 `mcp:definitions:paths` hook 保留 `/api/mcp/*` alias（取決於既有 MCP client 的綁定方式）
- **Middleware 串接**：`server/mcp/index.ts` 以 `defineMcpHandler({ middleware })` 集中掛 `requireAuth + rateLimit`（順序保證：middleware 早於 tool handler + transport 連接）
- **Util 沿用**：`server/utils/mcp-{auth,rate-limit,replay,token-store,ask,search,categories}.ts` 不改，middleware 與 tool handler 直接 import
- **Zod schema 統一**：各 endpoint 現有 schema 移到對應 tool 檔案的 `inputSchema` / `outputSchema`
- **Inspector 啟用**：dev 環境自動開（toolkit build-time gate，無需額外 config）；production 不影響 bundle
- **Contract / integration tests 套用至新 wiring**：`test:contracts` 全綠，TC-12 MCP replay 保持通過
- **Bundle size gate**：apply 前 `wrangler deploy --dry-run` 實測 Workers bundle 增量（預估 150–300 KB gzipped），若逼近 1 MB 上限需重新評估

### Non-Goals

- **NOT** 變更 ask / search / categories / chunks 的 business logic（retrieval、信心分流、拒答、遮罩、replay 行為全部保留）
- **NOT** 變更 `mcp_tokens` schema 或 Bearer token 發放 / 撤銷流程
- **NOT** 變更 MCP 契約的語義層（tool 名稱、input / output shape、錯誤碼、Bearer scope 行為保留）
  - ⚠️ **Note on URL surface**：toolkit 將 4 個 endpoint 統一為單一 `/mcp` JSON-RPC endpoint，原 `/api/mcp/{ask,search,categories,chunks/[id]}` URL 會消失。若需保留舊 URL 給既有 MCP client（reverse-compat），需在 `mcp:definitions:paths` hook 加 alias — 此項列為 In-Scope 的研究決策點
- **NOT** 引入 `MCP-Session-Id` 或 stateful session（維持 v1.0.0 的 stateless 定義，`features.mcpSession` 仍預設 false）
- **NOT** 擴充 MCP tool surface（searchKnowledge、listCategories 細節擴充等仍屬同版後置獨立 change）
- **NOT** 動 admin-ui-post-core / observability / governance 的既有 scope

## Impact

### Affected Capabilities

- `mcp-knowledge-tools`：**Modified** — 僅實作層，spec behavior 不變

### Affected Code（預估）

- `server/api/mcp/**` — 4 個 endpoint 改為 toolkit tool 定義
- `server/utils/mcp-auth.ts`、`server/utils/mcp-rate-limit.ts` — 接 toolkit hook
- `server/utils/mcp-{ask,categories,search,replay,token-store}.ts` — business logic 保留，僅調整簽章對接 toolkit
- `nuxt.config.ts` — 註冊 `@nuxtjs/mcp-toolkit` module + inspector dev flag
- `package.json` — 新增 `@nuxtjs/mcp-toolkit` 依賴
- `test/unit/mcp-*.test.ts`、`test/integration/mcp-routes.test.ts` — 更新 mock / setup，**契約斷言不變**

### Affected Systems

- Cloudflare Workers runtime — 確認 `@nuxtjs/mcp-toolkit` 0.13.x 與 `cloudflare_module` preset 相容
- `features.mcpSession` 仍預設 false，不啟用 toolkit 的 session 功能

### Truth Source / Environment / Governance

- **NO** truth-source 變更（`normalized_text_r2_key` + `source_chunks` 仍為 replay 來源）
- **NO** model role 變更
- **NO** 環境隔離變更（Preview / Staging / Production D1/R2/KV 獨立）
- **NO** governance 行為變更（query_logs redaction、retention、rate limit 行為保留）

## User Journeys

**No user-facing journey (backend-only)**

理由：本 change 僅為 MCP transport / wiring 層重構，外部 MCP client 看到的 tool 名稱、input/output shape、錯誤碼、Bearer scope 行為**完全不變**。Web UI、Admin UI 皆不受影響（不碰 `.vue` / `pages/` / `components/` / `layouts/`）。驗證由 contract tests（`test:contracts`）與 integration tests（`test/integration/mcp-routes.test.ts`）把關，不需 staging manual acceptance。

## Affected Entity Matrix

**No DB entity touched (transport-only refactor)**

理由：本 change 不新增 / 不修改任何 D1 table、enum 或 column。`mcp_tokens`、`query_logs`、`citation_records` schema 完全不變。

## Dependencies

- **Blocker**：`bootstrap-v1-core-from-report` + `add-v1-core-ui` 必須先 archive — 確認 v1.0.0 MCP 契約已凍結，避免遷移中途 business logic 還在變動
- **Regression net**：`test:contracts` + `test/integration/mcp-routes.test.ts` + TC-12 MCP replay 必須全綠
- **Nice-to-have**：`test-coverage-and-automation` 的 TC-12/15/18 若已自動化，遷移後回歸更穩

## Resolved Questions（2026-04-18 研究結果）

### Q1 — Cloudflare Workers 相容性：✅ 官方一等公民 preset

`module.ts:246-285` 偵測 `preset.includes('cloudflare')` → alias 至 `providers/cloudflare.ts`（用 `agents/mcp` 處理 transport，全 Web Standard，無 Buffer / fs / net）。`secure-exec`（Code Mode）在 CF preset 被 externalize。Bundle **預估 150–300 KB gzipped 增量**，對 1 MB 上限有壓力但可接受，**apply 前必須 `wrangler deploy --dry-run` 實測**。
**Source**: `packages/nuxt-mcp-toolkit/src/module.ts:246-285, 343-347`; `src/runtime/server/mcp/providers/cloudflare.ts:50`; peerDep `agents >= 0.9.0`

### Q2 — Inspector 隔離：✅ Build-time gate，production 零洩漏

`module.ts:343` `if (nuxt.options.dev) await import('./runtime/server/mcp/devtools')` — devtools 及其 `node:child_process` spawn `@modelcontextprotocol/inspector` 的 code 由 rollup 在 production build 被 tree-shake。無需 runtime NODE_ENV check。
**Source**: `src/module.ts:343-347`; `src/runtime/server/mcp/devtools/index.ts:1-28`

### Q3 — Rate limit hook execution order：✅ 單層 middleware，順序保證

`McpHandlerOptions.middleware: (event, next) => Promise<Response | void>`（`definitions/handlers.ts:48`）在 tool invoke + MCP server 連接 transport 之**前**執行。順序：`middleware → resolveDynamicDefinitions → createMcpServer → handleMcpRequest`。**做法**：middleware 內依序 `await requireAuth(event); await checkRateLimit(event, tokenId)`，throw 429 直接短路。per-tool rate limit 可用 `extractToolNames(event)` 讀 JSON-RPC body 判斷。
**Source**: `src/runtime/server/mcp/utils.ts:144-183`; `definitions/handlers.ts:21-51, 112`; `apps/docs/content/3.advanced/2.middleware.md`

### Q4 — File-based discovery 與現有目錄對接：⚠️ 需搬檔 + 統一端點

預設 `server/mcp/{tools,resources,prompts}/`，`dir` option 可改 base，`mcp:definitions:paths` hook 可 push 額外路徑。**Export 格式**：必須 `export default defineMcpTool({...})`（只認 default export），name 可省略由 filename 自動產生，子目錄自動變 `group`。現有 `server/api/mcp/*.ts` **不能直接沿用** — 要：
1. 每個 tool 拆成一檔丟進 `server/mcp/tools/`
2. `server/mcp/index.ts` 以 `defineMcpHandler({ middleware })` 集中掛 auth + rate-limit
3. `server/utils/mcp-*.ts` 不動，middleware / tool handler 直接 import
4. ⚠️ **URL 從 `/api/mcp/*` 統一變 `/mcp`** — 若需保留舊 URL 需加 alias path

**Source**: `src/module.ts:162-168`; `src/runtime/server/mcp/constants.ts`; `apps/docs/content/3.advanced/1.custom-paths.md`; `2.core-concepts/2.tools.md:38-74`

## Remaining Open Questions（需在 apply 前處理）

- [ ] 既有 MCP client（若已分發給外部 AI client）是否綁定 `/api/mcp/*` URL？決定是否需加 alias
- [ ] Workers bundle 實測增量（須在 apply 前 `wrangler deploy --dry-run` 驗證）

## Rollout Plan

1. Archive blocker changes 確認 MCP 契約凍結
2. 本 change 走 `/spectra-apply`，TDD 每個 tool 遷移一個、contract test 先紅後綠
3. 遷移完成後跑完整 `pnpm test:contracts` + `test:integration` + `test:acceptance` 三線綠
4. 無 user-facing journey，archive 前不需 staging manual acceptance，但需 design review 例外：**純 backend，無 Design Review**
