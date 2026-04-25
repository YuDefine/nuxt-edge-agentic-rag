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

## 4.x SSE on DO（scope expansion 2026-04-25）

- [x] 4.x.1 `server/utils/mcp-agents-compat.ts`：flag=true + GET/DELETE → forward to DO；移除 unconditional 405 hardcoded check（保留 stateless path 對 GET/DELETE 仍 405 的既有行為）
- [x] 4.x.2 `server/durable-objects/mcp-event-shim.ts`：暴露 `enqueueServerEvent(message)` API；DO storage events row schema (`{ eventId, data, eventType, timestamp }`)；alarm cleanup helper（5 分鐘 TTL + max 100 events FIFO eviction）
- [x] 4.x.3 `server/durable-objects/mcp-do-transport.ts`：`send()` server-initiated notifications push 至 `enqueueServerEvent`（不再 silently drop），保留 response correlation 路徑不變
- [x] 4.x.4 `server/durable-objects/mcp-session.ts`：依 design.md `## SSE Architecture` sequence diagram 實作 — 新增 GET handler 開 ReadableStream + 25s heartbeat + Last-Event-Id replay；新增 DELETE handler clear storage + close streams + cancel alarm；DO multi-connection map（spec round-robin / newest-active routing；見 design.md `## SSE Architecture > DO Multi-Connection Map`）
- [x] 4.x.5 SSE infrastructure：依 design.md `## SSE Architecture > Cloudflare Workers SSE 設計依據` 實作 — 25s heartbeat（`: heartbeat\n\n`）+ retry hint（`retry: 3000`）+ CF Edge 30s idle timeout 防護；eventId 編碼 `<streamType>:<counter>` 確保 globally unique within session（依 design.md `## Last-Event-Id Resumability > eventId 編碼`）

## 5. Integration tests

- [x] 5.1 [P] 新增 `test/integration/mcp-session-tool-dispatch.spec.ts`：假 MCP_SESSION binding + 假 DO → 真 McpServer + 真 4 tool registration + 假 retrieval backend；驗 `tools/list` 回 4 個 tool metadata；驗 `tools/call askKnowledge` 經 DO path 回與 stateless 等價 response
- [x] 5.2 [P] 擴充 `test/integration/mcp-session-handshake.spec.ts`：flag=true + `tools/call` 經 DO 後回真實結果（非 501）；同 query 對 flag=false 比對 response shape byte-level 等價
- [x] 5.3 [P] 新增 `test/integration/mcp-auth-context-forwarding.spec.ts`：驗 middleware 產 envelope → shim forward → DO verify 全鏈路；篡改 header 時 DO 401；無 header 時 DO fallback / 400

## 5.x SSE Tests（scope expansion 2026-04-25）

- [x] 5.x.1 [P] 新增 `test/integration/mcp-session-sse.spec.ts`：GET /mcp 帶 valid SID 開 SSE → server 回 `Content-Type: text/event-stream` + 初始 `: connected\nretry: 3000`；server-initiated push 經 `enqueueAndPushServerNotification` 進 SSE 順序正確、frame 格式 `id: e-<padded>\ndata: <json>\n\n`；多次 push 取得單調 counter（toolkit `useMcpLogger().notify.info` 端對端 wire 由 §7.1 acceptance 覆蓋，本 spec 聚焦 channel mechanics）
- [x] 5.x.2 [P] Last-Event-Id replay test（依 design.md `## Last-Event-Id Resumability > Replay 演算法`）：建 SSE channel → 收 N events → disconnect → reconnect with `Last-Event-Id: e-<padded N-2>` → 驗收到 N-1, N（不重複收）；invalid header 回 `notifications/events_dropped` reason `invalid_last_event_id`；TTL 過期時 silent skip（不 emit events_dropped，由 client 端視 connected 為 reset 點）
- [x] 5.x.3 [P] Multi-connection test：同 session 開兩條 SSE channel → server-initiated push 依實作 **broadcast 至每條 writer**（impl 拒絕 design.md 早期的 newest-active routing，理由：clients with multiple streams would silently miss events）；eventId 為單一 session-wide counter（`e-<16 padded>`），無 design.md notional 的 `stream-1:N` / `stream-2:M` 編碼
- [x] 5.x.4 [P] DELETE test：DELETE /mcp 帶 valid SID → 驗 SSE stream 收 `notifications/stream_closed` reason `session_deleted` 後 close；DO storage `sse-event:*` range 全清；alarm cancelled；後續 GET /mcp 帶 same SID 回 404；DELETE 對 unknown SID idempotent 回 204

## 6. 驗證與品質閘門

- [x] 6.1 `pnpm check` 全綠（format + lint + typecheck + test）；既有 `test/integration/mcp-*.test.ts` + `mcp-agents-compat.spec.ts` **未改動**仍全綠（證明 stateless fallback 未破壞）
- [x] 6.2 `pnpm spectra:followups` 確認 TD-041 marker 已於 `upgrade-mcp-to-durable-objects/tasks.md` 與 `server/durable-objects/mcp-session.ts` comment 都清除
- [x] 6.3 Micro-benchmark：DO path tool call latency vs stateless path；差異 ≤ 100ms 否則回頭檢查 cold start
- [x] 6.x SSE-specific 驗證：新 `mcp-session-sse.spec.ts` 13 tests 全綠；既有 stateless path test (`mcp-session-handshake`、`mcp-session-tool-dispatch`、`mcp-auth-context-forwarding`) 未動仍綠；DO storage event queue 在 alarm cleanup 後正確空（5.x.4 第二個 case 驗 `sse-event:*` range size === 0）。Production-side fix：`TransformStream` readable hwm 從預設 0 改為 `Number.POSITIVE_INFINITY`（mcp-session.ts:469-481）以避免 backpressure deadlock 於 fetch handler return 前的初始 `: connected` primer write，同時改善 prod 慢 client 韌性。Note：`pnpm check` 全套（format + lint + typecheck + 整套 test）尚未跑完，留 §7.1 升級實測前 final gate 確認

- [x] 6.4 **Worker → DO Routing Wiring**（§7.1 (b) probe 2026-04-25 揭露的 wire-up gap）— **v0.45.1 staging acceptance 12/12 全綠收尾**。Layer-by-layer trace + fix：
  - **Layer 1（worker shim 注入 envelope）** v0.44.0: `mcp-rehydrate-request-body.ts` GET/HEAD/DELETE early return 跳過 envelope 注入 → mcp-agents-compat:139 找不到 X-Mcp-Auth-Context → 405。修：對 GET/HEAD/DELETE 在 envelope 存在時也 install replay 注入 header
  - **Layer 2（workerd 拒收 Infinity HWM）** v0.44.1: workerd 對 `TransformStream` `highWaterMark` 做 internal integer conversion 拒收 `Number.POSITIVE_INFINITY`（vitest 接受所以 §5.x 全綠）。修：改 `Number.MAX_SAFE_INTEGER`
  - **Layer 3（nitro toNodeListener buffer）** v0.45.0: nitropack cloudflare-module preset 用 `toNodeListener` + `fetchNodeRequestHandler` (node-mock-http) 把 H3 app 包成 emulated Node listener，必須等 `res.end()` 才 resolve。SSE long-lived stream 永不 end → fetch hang。修：自訂 cloudflare-module entry (`build/nitro/cloudflare-mcp-sse-entry.mjs`) hooks.fetch 攔截 GET/DELETE /mcp，bypass `nitroApp.localFetch`。配套 `server/utils/mcp-streaming-bypass.ts` (env.DB raw query verify token + envelope sign + DO `stub.fetch` forward) + plugin 暴露 handler 給 entry
  - **Layer 4（DO writer.write hang on workerd）** v0.45.1: DO `handleGet` `await writer.write()` 在 workerd hang（readable side 必須等 client 拉才釋放，但 client 拉發生在 fetch 回 Response 後）。修：mirror SDK `webStandardStreamableHttp.js handleGetRequest` pattern，用 plain `ReadableStream({ start(controller) })` + 同步 `controller.enqueue()`，所有 `writeSseFrame` 改 sync

  **Acceptance 證據**：v0.45.1 staging acceptance (`pnpm mcp:acceptance:staging`, 2026-04-25T20:54+0800) 12/12 step 全綠 in 29.5s — initialize / notifications/initialized / tools/list 4 tools / GET /mcp opens SSE channel ✓ / 4 tool call (askKnowledge x2 + searchKnowledge x2) `isError=false` / collect frames / reconnect with Last-Event-Id / DELETE 204 / subsequent GET 404

  **History note** — 原本 G1 / G2 trace 描述（G1: nuxt.config.ts `mcp.sessions: true` 漏設；G2: GET 0 byte hang）已被 v0.44.x → v0.45.1 trace 取代。實際 production 走的不是 toolkit node/cloudflare provider 而是我們的 mcp-agents-compat shim（受 `agents/mcp` alias 接管），所以 G1 描述的 toolkit `sessions.enabled` 路徑與 staging 行為不直接相關；真實 root cause 為上述 4 個 layer。Reference probe `scripts/probe-mcp-sse-mock-client.sh` 仍可作為 local debug 工具。

## 7. Rollout

- [ ] 7.1 Staging: `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true` 後立即驗證 `AskKnowledge` / `SearchKnowledge` 各 2+ 次；確認 response 非 501、非 re-init loop，且 staging custom domain 可達（HTTP 200）。若可用 `wrangler tail`，同步確認無 `ownKeys` error / 401 auth context failure；若本機無 Cloudflare token，需以 GitHub deploy evidence + protocol response 記錄替代 tail（對齊 Decision 4: Rollout = staging flag=true immediate verification → production flag=true）。**SSE scope expansion 升級**：新增 (a) SSE-aware mock client（ReadableStream consume + Last-Event-Id replay simulation）通過；(b) 真實 Claude.ai 連 staging 走 OAuth flow + 3 個 askKnowledge query UI 顯示真實答案（非 "Authorization failed" / "Tool execution failed"）。
  - **Staging v0.42.2 (2026-04-25, Deploy run 24905096791)** protocol-layer 驗證通過：
    - `initialize`、`notifications/initialized`、`tools/list` 皆 HTTP 200；`Mcp-Session-Id` 正確傳回
    - `askKnowledge` x2、`searchKnowledge` x2 皆 HTTP 200
    - 無 JSON-RPC `-32603 a16.ownKeys`（ownKeys root cause 已在 `ef6d59c` 修復：`build/nitro/rollup.ts` 把 `reflect-metadata/Reflect.js` polyfill 包進 IIFE）、無 501、無 `TD-041`、無 `Server already initialized` re-init loop；`agentic-staging.yudefine.com.tw` 可達
  - **Tool-handler fallback root cause (2026-04-25, v0.43.1 debug instrumentation)**: 4 個 tool call 一開始都回 `{"text":"Tool execution failed. Please retry later.","isError":true}` fallback。`c20971e` debug patch 把 DO `createDoNoopLogger` 改 `console.*` + 在 `normalizeErrorToResult` 前 dump stack。Wrangler tail (`nuxt-edge-agentic-rag-staging`, 2026-04-25T21:46) 抓到所有 4 條 throw 都同源：
    ```
    AutoRAGNotFoundError: AutoRAG not found
        at parseError (cloudflare-internal:autorag-api:32:16)
        at async AutoRAG.search (cloudflare-internal:autorag-api:74:23)
        at async retrieveVerifiedEvidence (...) / answerKnowledgeQuery (...)
        at async McpServer.executeToolHandler (...)
        at async wrappedHandler (...)
    ```
    Root cause = TD-046（staging Cloudflare 帳號內未建 `agentic-rag-staging` AutoRAG instance），非 wire-do-tool-dispatch bug。DO dispatch chain 已全綠 — auth context、DO instance、McpServer lazy init、tool registration、handler 全部運作至 binding 層。
  - **Resolution (2026-04-25, post-v0.43.1)**: 透過 CF API 建 staging `agentic-rag-staging` AutoRAG instance（複製 production config，source = `agentic-rag-documents-staging`，AI Gateway = `agentic-rag-staging`，embedding = `@cf/qwen/qwen3-embedding-0.6b`）+ AI Gateway。重跑 4 個 tool call 全部 `isError: false`：
    - `askKnowledge` x2 → `{"citations":[],"refused":true}`（staging R2 空，無 evidence 而 refused 是正確行為）
    - `searchKnowledge` x2 → `{"results":[]}`（empty index，正確 empty response）
    - SID `e9dcb3b4-224e-47ef-8120-8323b5fdf3e5`，無 throw、無 fallback、無 `Server already initialized`
  - **Standalone follow-up @followup[TD-050]**: staging R2 仍為空 / 無 sync schedule active；TD-046 binding 層已修，但 staging 真實 RAG content 取得（seed sample docs 或 daily sync from production）拆 TD-050 處理，不阻擋本 change archive。
  - **SSE scope expansion 重新驗證 (2026-04-25, post v0.43.3)**: v0.43.3 production flag flip 揭露 stateful DO transport 缺 GET /mcp SSE channel — Claude.ai client 對 stateful server (回 `Mcp-Session-Id`) 試 GET /mcp 開 server-initiated channel，被 hardcoded 405 → 解讀 self-contradicting → 重新 OAuth 循環 → "Authorization with the MCP server failed (ofid_59a379970d736495)"。MCP spec 2025-11-25 確認 405 對 GET 是 spec-compliant，但 Claude.ai client fallback 行為不是 POST-only 而是重 OAuth；且 stateful server 缺 SSE = stateful 名實不符（專題 Edge-native Agentic RAG 的 stateful claim self-contradicting）。
  - **Acceptance 升級**：原「curl 4 tool call」標準不足（curl 不發 GET re-connect）。新標準：(a) curl 4 tool call 全綠；(b) SSE-aware mock client（ReadableStream consume + Last-Event-Id replay simulation）通過；(c) 真實 Claude.ai 連 staging 走 OAuth flow + 3 個 askKnowledge query 全部成功（UI 顯示真實答案，非 "Authorization failed" / "Tool execution failed"）。**§7.1 checkbox 因新標準暫退回 in-progress 狀態**，待 §4.x SSE 實作 + §5.x SSE tests + 升級 acceptance 全部通過後重新勾選。
  - **Wire-up gap dependency (2026-04-25 apply session 揭露)**：(b) / (c) 必須先解 §6.4 G1 + G2。已確認 G1 (mcp-toolkit `mcp: { sessions: true }` 漏設) 是 v0.43.3 production flip 失敗 root cause 同源；G2 (GET /mcp 0 byte hang) 在 G1 fix 後仍存在，需要追 nitro/h3 streaming response wrap 或 SDK transport 行為。詳見 §6.4。本輪 (a) 已通過（POST 路徑），(b) / (c) 全 deferred 直到 §6.4 解。
  - **(a)+(b) acceptance 全綠 (2026-04-25, v0.45.1, Deploy run 24931403722)**：§6.4 4-layer fix 全部上線後，`pnpm mcp:acceptance:staging` 12/12 step 通過 in 29.5s — initialize / notifications/initialized / tools/list 4 tools / **GET /mcp opens SSE channel ✓** / 4 tool call (askKnowledge x2 + searchKnowledge x2) `isError=false` / collect server-initiated frames / **reconnect SSE with Last-Event-Id ✓** / DELETE 204 / subsequent GET 404. SID `e5c994bb-e08f-40e5-a226-eae52abd05f3`. (a)+(b) 同源工具 `scripts/mcp/staging-sse-acceptance.mts` 通過代表兩項 acceptance 同步達成；(c) 真實 Claude.ai UI 端到端仍待使用者人工驗證。
- [ ] 7.2 Production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true` flip；24 小時 wrangler tail 密集監控；任一 anomaly 立刻 flag=false（無需 redeploy）。**SSE scope expansion caveat**：production flag flip 前 MUST 完成 §7.1 升級的全部 SSE 驗證（含真實 Claude.ai 連線 + 3 query UI 顯示真實答案）。**v0.43.3 已實測過早 flip 會踩 GET /mcp 405 → Claude.ai OAuth 循環，於 2026-04-25 透過 v0.43.4 stop-gap commit 把 `wrangler.jsonc` flag 改回 `false` 重新 deploy 完成 rollback；下次 flip true 必須等 §4.x（已完成）+ §5.x SSE tests + §6.4 G1 + G2 wire-up gap 解 + §7.1 升級 acceptance 全綠後再做。** §6.4 G1 (mcp.sessions: true) 是 v0.43.3 失敗 root cause 同源，G2 (GET /mcp hang) 是 G1 解後仍存在的 streaming response gap；兩者都是 production-side wire-up 必須先補完。
- [ ] 7.3 Production 正常運作 7 天後 `docs/tech-debt.md` 把 TD-030 + TD-041 Status 標 `done`，各附一句 one-liner

## 8. 人工檢查

- [ ] 8.1 使用者於 Claude.ai production 連續 3 次 `AskKnowledge` 不同 query，確認 UI 看到正確回答（非 "Error occurred during tool execution"）
- [ ] 8.2 使用者以 MCP Inspector / Claude Desktop 連線 production，驗 `tools/list` 回 4 個 tool（包含 `enhance-mcp-tool-metadata` 完成的 metadata）
- [ ] 8.3 使用者 wrangler tail 24 小時觀察，無 `Reflect.ownKeys` error / 無 401 auth context failure（代表簽章機制正常）
- [ ] 8.4 使用者確認 `NUXT_MCP_AUTH_SIGNING_KEY` 在 staging / production 為**不同**的 high-entropy 值，並不出現在 repo / logs / error messages 中
