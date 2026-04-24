## Context

`upgrade-mcp-to-durable-objects`（Pivot C, 2026-04-24）將 MCP 基建分成兩層：

- **session lifecycle**（create / touch `lastSeenAt` / alarm GC / 404 on missing）— 屬於 DO change，已完成
- **tool dispatch**（`McpServer` lazy init + `DoJsonRpcTransport.dispatch` + auth/env plumbing）— 屬於本 change

DO change 的 non-initialize path 目前刻意回 HTTP 501 + `TD-041` error payload，一方面驗 lifecycle、另一方面防止 flag=true 誤 flip 時 silent degradation。本 change 把那條 path 替換為真實 tool dispatch。

技術生態：Cloudflare Workers + Durable Objects + `@modelcontextprotocol/sdk` + `@nuxtjs/mcp-toolkit`。專案 MCP 層有兩個關鍵 util：`server/utils/current-mcp-event.ts`（用 Nitro `useEvent()` 拿 H3Event）、`server/utils/mcp-middleware.ts`（Nuxt layer 做 bearer token 驗證寫入 `event.context.mcpAuth`）。Tool handler 全部透過 `getCurrentMcpEvent()` 拿 auth + env，這在 DO runtime 不可用（DO 沒 Nuxt event）。

## Goals / Non-Goals

### Goals

- DO 內可完整執行 4 個 knowledge tool（askKnowledge / searchKnowledge / getDocumentChunk / listCategories）
- Auth context 從 Nuxt 安全 forward 到 DO（不被偽造 / 不被 replay）
- Tool handler 同時能在 stateless path（既有 Nuxt event）與 DO path 跑；兩路徑 response shape 完全一致
- `pnpm eval`（add-mcp-tool-selection-evals 之後）分數在 flag=true 與 flag=false 之間 ≤ 2% 差異（行為等價）

### Non-Goals

- 不改 session lifecycle 管理邏輯（create / touch / alarm GC）
- 不改 4 個 tool 的 retrieval 邏輯、scope 檢查、response format
- 不改 Nuxt middleware 的 bearer token 驗證 / rate limit / audit log
- 不實作 token → sessionId 索引（TD-040 獨立 change）
- 不引入 MCP prompt / elicitation / sampling / resource

## Decisions

### Decision 1: Tool handler context 介面 = 建 DO-aware H3Event shim

**Choice**: 在 DO 內建一個 minimal `H3Event`-shape shim object，attach `event.context.cloudflare.env = doEnv` + `event.context.mcpAuth = reconstructedAuth`，以 `useEvent()` 替代機制讓 tool handler 不用改介面。

**Rationale**:

- 4 個 tool handler 的 contract 保持不變，後續新 tool 加 register 也不用知道 DO / stateless 差異
- Stateless path 完全不受影響（既有 Nuxt event 照走）
- Shim 用 `nitropack/runtime` 的 AsyncLocalStorage 或類似機制注入（DO 內 `runInContext` 包住 tool handler 執行）

**Alternatives considered**:

- **改 handler signature 為 `(args, context) => ...`**：乾淨但 breaking change，4 檔 + 既有 test 都要改
- **Nuxt `useEvent()` monkey-patch**：脆、難 debug、與 AsyncLocalStorage 互動不清

**Risks**: Shim 需要與 `nitropack/runtime.useEvent()` 實作相容；若未來 nitro 改動，需追蹤。

### Decision 2: Auth context 跨 boundary = HMAC 簽章 + short TTL

**Choice**: Nuxt middleware 驗完 bearer token 後，建 `McpAuthContextEnvelope = { auth, issuedAt }`，以 `NUXT_MCP_AUTH_SIGNING_KEY` HMAC-SHA256 簽章，Base64URL 編碼，塞進 request header `X-Mcp-Auth-Context`。DO 驗簽 + 驗 issuedAt 在 60 秒內。

**Rationale**:

- 簽章避免偽造（DO 內可信 context）
- TTL 60 秒防 replay + token revoke 後舊 envelope 很快失效
- Shared secret via runtime config，不 hardcode
- 對稱簽章夠用（只有自己的 Nuxt ↔ DO），不需非對稱

**Alternatives considered**:

- **Cookie / Durable Object session state 存 auth context**：state leak 風險、session 清除時 race
- **Re-validate bearer token inside DO**：重複 DB query 浪費，且 middleware 已驗過
- **JWT**：過度設計，只有自己 produce + consume

**Risks**: Shared secret 洩漏 → 任何人可偽造 DO request；MUST rotate 流程（docs 交代），MUST 不寫進 logs。

### Decision 3: McpServer lazy init = per-DO-instance, cache in JS heap

**Choice**: DO instance 首次 non-initialize request（`initialize` 不需 McpServer）時 lazy `new McpServer(...)` + register 4 個 tool + `server.connect(new DoJsonRpcTransport())`。Instance 存成 DO class private field；alarm 清 storage 時 call `transport.close()`。

**Rationale**:

- 每 session 一個 McpServer instance，隔離乾淨
- Lazy = 省 cold start 成本（initialize 只建 session 不 init server）
- 4 個 tool 的 registration 邏輯從 `server/mcp/tools/*.ts` module default export 直接讀（toolkit 的 auto-register 也是讀這些 module）

**Alternatives considered**:

- **Per-request McpServer**：每個 tool call 都重建 server，浪費
- **Global singleton**：跨 session 共享 state 不乾淨

### Decision 4: Rollout = staging flag=true soak 3 次 → production flag=true

**Choice**:

- Staging：`NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`，連續 3 天 Claude.ai 實測 `AskKnowledge` / `SearchKnowledge` 各至少 2 次，tail 無 `ownKeys` error + 無 re-init loop
- Production：staging 通過後 flag flip true，24 小時 wrangler tail 密切監控；任一異常即 flag false（不需 redeploy）

**Rationale**:

- 本 change archive 前不動 production flag（由 DO change 保留為 false）
- Kill switch 保留為 stateless path

## Risks / Trade-offs

- **Shim 與 nitro 未來版本耦合** → **Mitigation**: docs 註明依賴版本；upgrade nitro 時 regression test
- **Auth signing key 外洩** → **Mitigation**: runtime config only；`.env.example` 標記為 secret；deploy workflow 校驗非 default value
- **DO 內 `Reflect.ownKeys(env)` bug 重現** → **Mitigation**: implementation 時先寫 micro-spike 驗證；必要時 install `enumerableSafeEnv` 同步
- **Tool handler context shim 行為偏離 Nuxt event** → **Mitigation**: 加 integration test 同時驗兩路徑（flag=true / flag=false）response shape byte-level 一致
- **Production flag flip 後意外 regression** → **Mitigation**: flag 是 kill switch，不需 redeploy；24 小時密集 tail

## Migration Plan

1. 實作 auth context codec + unit test
2. 實作 DO-aware H3Event shim + 驗證 tool handler 可接
3. DO 內 lazy init McpServer + tool registration
4. DO non-initialize path 從 501 改為 `transport.dispatch`
5. Integration test（DO 內 tool dispatch end-to-end）
6. `pnpm check` 全綠
7. Staging deploy + flag true + soak 3 天
8. Production flag true + 24 小時監控
9. Archive change + TD-041 / TD-030 標 done

## Open Questions

- 4 個 tool handler 內 `useLogger(event)`（evlog）能否在 DO-aware shim 下正常運作？— 需 spike 確認 shim 是否覆蓋 evlog 取 context 路徑
- DO 內若 tool handler throw，evlog 的 wide event 如何 surface 到 server-side drain？— 可能需要 DO 明確 `context.waitUntil(log.flush())`
- `Mcp-Session-Id` header 在 tool 層是否要 expose 給 tool handler？— 初版否；只給 auth + env，session id 是 transport 概念
