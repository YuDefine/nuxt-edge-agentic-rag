## 1. Auth context codec（簽章 + 驗證；支援 Goals「auth context 從 Nuxt 安全 forward 到 DO」；Non-Goals 明確排除「改 Nuxt middleware 的 bearer token 驗證」）

- [x] 1.1 新增 `server/utils/mcp-auth-context-codec.ts`：`signAuthContext(auth, key)` → Base64URL 編碼的簽章 envelope（帶 `issuedAt`）；`verifyAuthContext(header, key, nowMs)` → `McpAuthContext | null`（失敗回 null 並指明原因）；HMAC-SHA256 via `crypto.subtle.importKey` + `crypto.subtle.sign`；TTL = 60 秒；對齊 Decision 2: Auth context 跨 boundary = HMAC 簽章 + short TTL
- [x] 1.2 新增 `NUXT_MCP_AUTH_SIGNING_KEY` runtime config 讀取 helper；`.env.example` 加 sample 含警語「production 必設，>= 32 bytes random」；加 dev default 只在 `NUXT_ENV_DEV=true` 時生效，避免 prod 漏設 silent degradation
- [x] 1.3 [P] `test/unit/mcp-auth-context-codec.test.ts`：sign + verify round-trip；篡改 payload 後 verify 失敗；signature 正確但 issuedAt > 60s 失敗；malformed Base64 失敗；missing header 失敗

## 2. Tool handler context shim（DO-aware H3Event）

- [x] 2.1 新增 `server/durable-objects/mcp-event-shim.ts`：`createDoMcpEventShim({ doEnv, auth, request })` 回傳 minimal `H3Event` shape（至少 `context.cloudflare.env` / `context.mcpAuth` / `web.request` / `node.req` stub）；支援 `getCurrentMcpEvent()` 的現有呼叫路徑（透過 AsyncLocalStorage / nitropack runContext 注入）；實作 Decision 1: Tool handler context 介面 = 建 DO-aware H3Event shim
- [x] 2.2 驗證 `useLogger(event)` / `getRequiredD1Binding(event, ...)` / `getRequiredWorkersAiBinding(event)` / `getRequiredKvBinding(event, ...)` 在 shim event 上皆可正常 resolve；列出 Open Question「evlog wide event 在 DO 如何 flush」的 follow-up 驗證結果
- [x] 2.3 實測 `Reflect.ownKeys(doEnv)` 是否觸發 Cloudflare proxy TypeError；若是，套用 `installEnumerableSafeEnv(doEnv)`（同 shim 層做法）；若否，註明測試結果並省略

## 3. Nuxt layer：auth context 注入

- [x] 3.1 `server/utils/mcp-middleware.ts`：驗完 bearer token 後呼叫 `signAuthContext(auth, key)`，把結果暫存到 `event.context.mcpAuthEnvelope`（供後續 shim 層 forward 用）
- [x] 3.2 `server/utils/mcp-agents-compat.ts` flag=true 分支：forward request 時把 `event.context.mcpAuthEnvelope` 寫進 forwarded Request 的 `X-Mcp-Auth-Context` header；header 不存在則 fallback 回 stateless path（middleware 未跑時不應該走 flag=true，但多一層 safety）

## 4. DO 內 McpServer lazy init + tool dispatch

- [x] 4.1 `server/durable-objects/mcp-session.ts` non-initialize path 實作 MCP Tool Dispatch Via Durable Object requirement：移除 501 `TD-041` error（解除 @followup[TD-041]）；改為：(a) verify auth context header；(b) 實作 Decision 3: McpServer lazy init = per-DO-instance, cache in JS heap — lazy `new McpServer(...)` + register 4 tool + `server.connect(new DoJsonRpcTransport())`；(c) 用 shim event 在 AsyncLocalStorage context 下 call `transport.dispatch(envelope, { authInfo, requestInfo })`；(d) await response → HTTP JSON response
- [x] 4.2 DO instance 管理 McpServer + transport lifecycle：首次 non-initialize 建；session 清除時（`alarm()` / 外部 revoke）呼叫 `transport.close()` 釋放 pending resolvers
- [x] 4.3 4 個 tool handler 回應 shape 核對：對同一組 input，DO path 與 stateless path response 除 `Mcp-Session-Id` / `Date` 外完全一致；必要時 tool handler 內部改用 `useEvent()`（Nitro）以同時相容兩路徑

## 5. Integration tests

- [x] 5.1 [P] 新增 `test/integration/mcp-session-tool-dispatch.spec.ts`：假 MCP_SESSION binding + 假 DO → 真 McpServer + 真 4 tool registration + 假 retrieval backend；驗 `tools/list` 回 4 個 tool metadata；驗 `tools/call askKnowledge` 經 DO path 回與 stateless 等價 response
- [x] 5.2 [P] 擴充 `test/integration/mcp-session-handshake.spec.ts`：flag=true + `tools/call` 經 DO 後回真實結果（非 501）；同 query 對 flag=false 比對 response shape byte-level 等價
- [x] 5.3 [P] 新增 `test/integration/mcp-auth-context-forwarding.spec.ts`：驗 middleware 產 envelope → shim forward → DO verify 全鏈路；篡改 header 時 DO 401；無 header 時 DO fallback / 400

## 6. 驗證與品質閘門

- [x] 6.1 `pnpm check` 全綠（format + lint + typecheck + test）；既有 `test/integration/mcp-*.test.ts` + `mcp-agents-compat.spec.ts` **未改動**仍全綠（證明 stateless fallback 未破壞）
- [x] 6.2 `pnpm spectra:followups` 確認 TD-041 marker 已於 `upgrade-mcp-to-durable-objects/tasks.md` 與 `server/durable-objects/mcp-session.ts` comment 都清除
- [x] 6.3 Micro-benchmark：DO path tool call latency vs stateless path；差異 ≤ 100ms 否則回頭檢查 cold start

## 7. Rollout

- [ ] 7.1 Staging: `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true` 後立即驗證 `AskKnowledge` / `SearchKnowledge` 各 2+ 次；確認 response 非 501、非 re-init loop，且 staging custom domain 可達（HTTP 200）。若可用 `wrangler tail`，同步確認無 `ownKeys` error / 401 auth context failure；若本機無 Cloudflare token，需以 GitHub deploy evidence + protocol response 記錄替代 tail（對齊 Decision 4: Rollout = staging flag=true immediate verification → production flag=true）
  - **Staging v0.42.2 (2026-04-25, Deploy run 24905096791)** protocol-layer 驗證通過：
    - `initialize`、`notifications/initialized`、`tools/list` 皆 HTTP 200；`Mcp-Session-Id` 正確傳回
    - `askKnowledge` x2、`searchKnowledge` x2 皆 HTTP 200
    - 無 JSON-RPC `-32603 a16.ownKeys`（ownKeys root cause 已在 `ef6d59c` 修復：`build/nitro/rollup.ts` 把 `reflect-metadata/Reflect.js` polyfill 包進 IIFE）、無 501、無 `TD-041`、無 `Server already initialized` re-init loop；`agentic-staging.yudefine.com.tw` 可達
  - **Caveat（7.1 checkbox 尚未勾選）**：4 個 tool call body 都是 `{"result":{"content":[{"type":"text","text":"Tool execution failed. Please retry later."}],"isError":true}}` — tool handler 內部仍 throw（非 SDK parse 層），由 `normalizeErrorToResult` fallback 成 isError result。真正的 handler error stack 被 DO `createDoNoopLogger` 吞掉；需要再一輪 debug patch 抓 handler error 並修根因才能勾選 7.1、flip production flag。見 `HANDOFF.md` wire-do-tool-dispatch 區塊的「下一步」。
- [ ] 7.2 Production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true` flip；24 小時 wrangler tail 密集監控；任一 anomaly 立刻 flag=false（無需 redeploy）
- [ ] 7.3 Production 正常運作 7 天後 `docs/tech-debt.md` 把 TD-030 + TD-041 Status 標 `done`，各附一句 one-liner

## 8. 人工檢查

- [ ] 8.1 使用者於 Claude.ai production 連續 3 次 `AskKnowledge` 不同 query，確認 UI 看到正確回答（非 "Error occurred during tool execution"）
- [ ] 8.2 使用者以 MCP Inspector / Claude Desktop 連線 production，驗 `tools/list` 回 4 個 tool（包含 `enhance-mcp-tool-metadata` 完成的 metadata）
- [ ] 8.3 使用者 wrangler tail 24 小時觀察，無 `Reflect.ownKeys` error / 無 401 auth context failure（代表簽章機制正常）
- [ ] 8.4 使用者確認 `NUXT_MCP_AUTH_SIGNING_KEY` 在 staging / production 為**不同**的 high-entropy 值，並不出現在 repo / logs / error messages 中
