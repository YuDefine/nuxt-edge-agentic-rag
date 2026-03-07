## Context

`v1.0.0` 的 MCP 層以 Nitro 原生 event handler 手刻，4 個 endpoint（`ask.post`、`search.post`、`categories.get`、`chunks/[citationId].get`）各自 parse JSON-RPC、驗 Bearer、驗 scope、檢查 rate limit、呼叫 business util、寫 query_logs、組回應。共用邏輯分散在 `server/utils/mcp-{auth,rate-limit,replay,ask,search,categories,token-store}.ts` 7 支 util，靠 convention 串接。

此結構讓 v1.0.0 得以準時交付，但有三個長期代價：tool schema 與 runtime 行為分散、無 inspector、tech stack 宣告（`openspec/config.yaml`）與實作已長期偏離。`@nuxtjs/mcp-toolkit` 0.13.x 以 file-based discovery + `defineMcpTool` + `defineMcpHandler` middleware 模式可直接對接，且官方已支援 `cloudflare_module` preset（`agents/mcp` + Web Standard，詳見 proposal Resolved Q1）。

本 change 以 **transport 層單層重構** 為主軸：語義層（tool 名稱、input/output shape、錯誤碼、Bearer scope 行為）完全不變，只重新接線。

## Goals / Non-Goals

**Goals:**

- 把 4 個 endpoint 改寫為 `defineMcpTool` 單檔 default export，集中至 `server/mcp/tools/`
- 把 auth + rate-limit 集中為單層 `defineMcpHandler({ middleware })`，順序保證 `auth → rate-limit → tool handler`
- 讓現有 contract / integration / TC-12 MCP replay 測試**斷言不變**，僅改 wiring 與 URL base
- 在 dev 啟用 inspector；production bundle 零洩漏（build-time tree-shake，無 runtime flag 需要）

**Non-Goals:**

- **NOT** 變更 ask / search / categories / chunks 的 business logic、信心分流、拒答、遮罩、replay 行為
- **NOT** 變更 `mcp_tokens`、`query_logs`、`citation_records` schema
- **NOT** 變更對外的 tool 名稱、input/output shape、錯誤碼、Bearer scope 語義
- **NOT** 引入 `MCP-Session-Id` / stateful session（`features.mcpSession` 仍預設 false）
- **NOT** 擴充 MCP tool surface（新 tool / resource / prompt 屬獨立 change）
- **NOT** 動 admin-ui-post-core / observability / governance 的既有 scope

## Architecture

### Before（v1.0.0 現況）

```
Client (MCP JSON-RPC POST)
  → /api/mcp/ask        → handler → parse + requireAuth + checkRateLimit + mcp-ask util → 寫 query_logs
  → /api/mcp/search     → handler → parse + requireAuth + checkRateLimit + mcp-search util → 寫 query_logs
  → /api/mcp/categories → handler → parse + requireAuth + checkRateLimit + mcp-categories util
  → /api/mcp/chunks/[id]→ handler → parse + requireAuth + checkRateLimit + mcp-replay util
```

每個 endpoint 各自重複 auth + rate-limit + parse 樣板，分散 ~4 份。

### After（toolkit wiring）

```
Client (MCP JSON-RPC POST /mcp)
  → nuxt-mcp-toolkit handler
    → middleware (single layer)
        1. requireAuth(event)    ← from server/utils/mcp-auth.ts (unchanged)
        2. checkRateLimit(event) ← from server/utils/mcp-rate-limit.ts (unchanged)
        3. (throw 401/403/429 → short-circuit)
    → resolveDynamicDefinitions (tool discovery from server/mcp/tools/)
    → createMcpServer → handleMcpRequest → invoke tool
        server/mcp/tools/ask.ts         → imports mcp-ask util (unchanged) → 寫 query_logs
        server/mcp/tools/search.ts      → imports mcp-search util (unchanged) → 寫 query_logs
        server/mcp/tools/categories.ts  → imports mcp-categories util (unchanged)
        server/mcp/tools/get-document-chunk.ts → imports mcp-replay util (unchanged)
```

Auth + rate-limit 從 4 份樣板收斂為 1 份 middleware。Business util 完全不動。

### File layout

```
server/
├── mcp/
│   ├── index.ts              ← defineMcpHandler({ middleware })
│   └── tools/
│       ├── ask.ts            ← defineMcpTool({ inputSchema, outputSchema, handler })
│       ├── search.ts
│       ├── categories.ts
│       └── get-document-chunk.ts
├── utils/
│   ├── mcp-auth.ts           ← unchanged
│   ├── mcp-rate-limit.ts     ← unchanged
│   ├── mcp-replay.ts         ← unchanged
│   ├── mcp-ask.ts            ← unchanged
│   ├── mcp-search.ts         ← unchanged
│   ├── mcp-categories.ts     ← unchanged
│   └── mcp-token-store.ts    ← unchanged
└── api/
    └── mcp/                  ← DELETED after migration（URL 統一為 /mcp）
```

## State Transitions / Truth Sources

**無變更**。保留：

- Replay 真相來源：`normalized_text_r2_key` + `source_chunks`
- 正式回答資格：`documents.status = active` + `document_versions.index_status = indexed` + `document_versions.is_current = true`
- Audit 真相：`query_logs`（遮罩後）+ `citation_records`
- Auth 真相：`mcp_tokens.scopes` + runtime `ADMIN_EMAIL_ALLOWLIST`

## Middleware 設計

單層 `middleware: (event, next) => Promise<Response | void>` 在 `server/mcp/index.ts`：

```ts
export default defineMcpHandler({
  middleware: async (event, next) => {
    // 1. Bearer + scope resolution
    const token = await requireMcpAuth(event) // throws 401 on missing/bad Bearer
    event.context.mcpToken = token

    // 2. Per-token rate limit (pre-tool-invoke gate)
    const toolName = extractToolNames(event)[0]
    await checkMcpRateLimit(event, token.id, toolName) // throws 429 on exceed

    // 3. Scope check deferred to tool（每個 tool 知道自己需要什麼 scope）
    return next()
  },
})
```

**順序保證**（來自 toolkit 原始碼 `utils.ts:144-183`）：
`middleware → resolveDynamicDefinitions → createMcpServer → tool.handler`。
middleware throw → tool handler 絕不執行 → business logic 不會被未授權 / 過量請求觸發。

Scope check 留在 tool 內（由 `event.context.mcpToken.scopes` 判斷），理由：每個 tool 需要的 scope 不同（`ask` 需 `knowledge.ask`、`get-document-chunk` 需 `knowledge.replay`），集中在 middleware 反而難維護。

## URL Surface 決策

Proposal Q5 盤點結果：**無外部 MCP client 綁定 `/api/mcp/*` URL**。

決定：**不加 alias path**。URL 從 4 個路徑統一為單一 `/mcp`（MCP JSON-RPC 標準形式）。連帶更新：

- `scripts/create-mcp-token.ts:147` console.log 提示訊息
- `docs/verify/rollout-checklist.md:281` + `docs/verify/staging-deploy-checklist.md:180,187` curl 範例
- `template/HANDOFF.md:18` 交接樣板

## 測試策略

- **Contract tests**（`test/unit/mcp-*.test.ts`）：斷言 tool name / input schema / output shape / 錯誤碼 — **不變**，僅改測試 setup 的 URL + request shape
- **Integration tests**（`test/integration/mcp-routes.test.ts`、`test/integration/acceptance-tc-{01,12,13,16,18,20}.test.ts`）：打 `/mcp` 而非 `/api/mcp/*`，JSON-RPC body 改走 toolkit 標準格式
- **Regression gate**：`pnpm test:contracts` + `pnpm test:integration` + `pnpm test:acceptance` 三線全綠才 archive
- **Bundle gate**：`wrangler deploy --dry-run` 增量 < 300 KB gzipped（Workers 1 MB 上限安全邊界）
- **Inspector 驗證**：dev 環境人工連 `http://localhost:6274` 跑一次每個 tool，確認 input/output + 錯誤碼顯示正確

## Risks

| Risk                                                       | Mitigation                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Bundle 超過 Workers 1 MB 限制                              | Pre-apply `wrangler deploy --dry-run` gate；超標則回檔、探索更窄 toolkit 子集或維持現狀            |
| `agents/mcp` peerDep 在 CF runtime 出非預期錯誤            | 遷移第一支 tool 就跑 staging smoke，早發現早回檔                                                   |
| File-based discovery 與現有 server/api routing 衝突        | `server/mcp/` 是獨立命名空間，不與 `server/api/` 路徑撞；移除 `server/api/mcp/` 後無殘留           |
| Middleware throw 形態與 toolkit 預期不符（如 status code） | 遷移過程以 contract test 先紅後綠，若 toolkit 吞掉自訂 statusCode 需改用 toolkit 定義的 error type |
