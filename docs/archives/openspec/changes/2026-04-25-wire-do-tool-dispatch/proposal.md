## Why

`upgrade-mcp-to-durable-objects`（Pivot C）完成 MCP session lifecycle（`MCPSessionDurableObject` + `DoJsonRpcTransport` class + alarm GC + 404 on missing），但 DO 對 **non-initialize JSON-RPC request**（`tools/list` / `tools/call` / ...）目前回 HTTP 501 + `-32601 TD-041` error。這是 C-path scope trim 2026-04-24 的明確選擇：DO change 只做 lifecycle，tool dispatch 留給獨立 change 處理，因為 wire-up 需要幾個非 trivial 的架構決策（event / auth / env plumbing）。

本 change 接手完成 **tool dispatch via DO**，讓 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true` 在 production 真正可用（解決 Claude.ai re-init 迴圈根因 TD-030 的最後一哩）。

## What Changes

- **DO 內 lazy init `McpServer`**：首次 `initialize` 時建 `McpServer` instance、register 4 個 knowledge tool、`server.connect(new DoJsonRpcTransport())`；instance 與 session 同生命週期（存活於 DO JS heap，session 清除時 close transport）
- **Tool handler 解耦 `getCurrentMcpEvent()`**：把 4 個 tool 的 `handler` 從「呼叫 `getCurrentMcpEvent()` 拿 event」重構為「接 context 參數」形式（例如 `McpToolRequestContext = { env, auth, runtimeConfig, ... }`），或在 DO 內建 shim 提供相容 `event.context.cloudflare.env` / `event.context.mcpAuth` 介面
- **Auth context plumbing**：Nuxt `/mcp` middleware 驗完 bearer token 後，將 `McpAuthContext` 序列化（帶 HMAC 簽章，避免偽造）成特殊 header（例如 `X-Mcp-Auth-Context`），forward 時加入 DO request；DO 內 verify + deserialize 重建 context；簽章用 runtime config 的 shared secret
- **Env / binding 注入**：DO env 已有 D1 / KV / AI / BLOB binding（同 worker 共用），但 tool handler 原本期待 `event.context.cloudflare.env`；需建 shim 或改 handler 介面
- **`Reflect.ownKeys` workaround 同步到 DO**：shim 層的 `installEnumerableSafeEnv` 邏輯要確保 DO runtime 的 env proxy 也套用（若 DO 的 env 直接來自 Cloudflare 同一 source，bug 可能重現）
- **DO `fetch()` non-initialize path**：把目前的 501 error 替換為 `await transport.dispatch(envelope, extra)` + HTTP response 組裝；extra 帶 reconstructed `authInfo` / `requestInfo`
- **Rollout flag flip**：`NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` 可從 staging soak 通過後推 production（解除 DO change 的 rollout 6.3 gate）
- `mcp-knowledge-tools` spec 新增 Requirement：MCP Tool Dispatch Via Durable Object 描述 DO 內完整 tool flow 要求
- **GET /mcp SSE on DO（scope expansion 2026-04-25）**：v0.43.3 production flip 揭露 stateful DO transport 缺 GET /mcp SSE channel — Claude.ai client 對回 `Mcp-Session-Id` 的 stateful server 試 GET /mcp 開 server-initiated channel，被 hardcoded 405 → 解讀 self-contradicting → 重新 OAuth 循環 → "Authorization with the MCP server failed"。本 change 補完 SSE on DO：DO 提供 GET /mcp `text/event-stream` 回應、ReadableStream + TransformStream multi-connection、Last-Event-Id resumability、DELETE /mcp 主動結束 session。`mcp-do-transport.ts:42-53` 既有「server-initiated notifications silently drop」缺口同步修復 — `transport.send()` push 至 DO event queue，使 `useMcpLogger().notify.*` 與 SDK `server.sendLoggingMessage` 在 Edge runtime 透明運作。詳細 architecture / storage schema / replay 演算法見 design.md `## SSE Architecture` / `## Storage Schema for Event Queue` / `## Last-Event-Id Resumability` / `## Toolkit-Transparent Integration`。

## Non-Goals

- **NEVER** 改 session lifecycle 管理（create / touch / alarm GC / 404 on missing）— 屬於 `upgrade-mcp-to-durable-objects` scope，本 change 只消費 session state
- **NEVER** 改 Nuxt `/mcp` middleware 的 bearer token 驗證 / rate limit / audit log 邏輯 — 仍在 Nuxt 層完成，只新增 auth context serialization
- **NEVER** 改 4 個 tool 的 retrieval 邏輯、scope 檢查、response shape — 僅重構 handler 的 context 取得方式
- **NEVER** 引入 MCP prompt / elicitation / sampling / resource 能力（DO 雖可 push notification，但本 change 聚焦 knowledge tool 4 個方法）
- **NEVER** 改 `mcp-agents-compat.ts` 的 stateless fallback path — 保留為 kill-switch
- 不實作 token → sessionId 索引（TD-040 由獨立 change 處理；本 change 依賴 TTL alarm 自然清理 session）

## Capabilities

### New Capabilities

(none — extend existing)

### Modified Capabilities

- `mcp-knowledge-tools`：新增 Requirement 描述「DO 內 tool dispatch 完整流程」（lazy init McpServer、auth context reconstruction、tool handler 在 DO context 可跑完整 retrieval 並回正確 JSON-RPC response）

## Affected Entity Matrix

本 change 不觸動 DB schema、enum、shared types、或 migration；純 MCP 協議層重工。

**SSE scope expansion 補**：DO storage 新增 event queue rows（用於 SSE replay）：

### Entity: DO `MCPSessionDurableObject` storage `events:<eventId>` rows

| Dimension      | Values                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------- |
| Storage entity | `events:<eventId>` row in DO `ctx.storage`（每 session 獨立）                               |
| Row schema     | `{ eventId, data, eventType, timestamp }`（JSON-RPC notification 編碼為 SSE event payload） |
| Quota          | max 100 events / session（FIFO eviction）+ 5 分鐘 alarm cleanup                             |
| Reads          | GET /mcp with `Last-Event-Id` header → replay missed events                                 |
| Writes         | `transport.send()` server-initiated notification → enqueueServerEvent                       |
| Surfaces       | `mcp-do-transport.ts` 寫、`mcp-session.ts` GET handler 讀、alarm cleanup 刪                 |
| States         | empty queue / active stream attached / disconnected with backlog / TTL evicted              |

## User Journeys

**No user-facing journey (backend-only — extends MCP protocol layer)**

理由：純 MCP 協議層 wire-up，無 UI。E2E 驗收由 Claude.ai Remote MCP 連線 + tool call 完成（production flag flip true 後 3 次 AskKnowledge 回正確答案 + wrangler tail 看到 `tools/call` 完整執行）。

**SSE scope expansion — Backend integration journey**：

- **MCP Client（Claude.ai / Inspector / Cursor）→ Stateful Session lifecycle with SSE**：
  1. POST `/mcp` `initialize` → server 回 `Mcp-Session-Id` header（SID）
  2. POST `/mcp` `notifications/initialized` 帶 SID → 202 Accepted
  3. GET `/mcp` 帶 SID + `Accept: text/event-stream` → server 開 SSE channel + 25s heartbeat keep-alive
  4. POST `/mcp` `tools/call askKnowledge` 帶 SID → 同步回 `application/json` response
  5. tool handler 內呼 `useMcpLogger().notify.info({...})` → DO `transport.send()` push 至 event queue → 即時推 SSE event 給 client
  6. （Network failure / CF Edge 30s idle timeout）client 斷線 → DO 保留 event queue
  7. Client 重連 GET `/mcp` 帶 `Last-Event-Id: <last-received>` → DO 從 queue replay 漏掉的 events + 繼續 push 新 events
  8. Client 主動 DELETE `/mcp` 帶 SID → DO clear storage + close streams + cancel alarm

## Implementation Risk Plan

- Truth layer / invariants: Auth context 的 HMAC 簽章 shared secret 必須走 runtime config（`NUXT_MCP_AUTH_SIGNING_KEY` 之類），絕不 hardcode；Nuxt middleware 是 auth 驗證唯一來源，DO 只 verify + consume serialized context；tool handler 行為（成功 / 失敗 / 404 / scope violation）response shape 必須與 stateless path 完全一致（既有 integration test 要同時綠）；`Reflect.ownKeys` workaround 需在 DO runtime 實測驗證是否必要；**SSE scope expansion — DO event queue（`events:<eventId>` rows）是 SSE replay 的 single source of truth；eventId 必須 globally unique within session 且 encode origin stream（spec 要求 per-stream cursor）；server-initiated notifications 走 `transport.send()` → `enqueueServerEvent()` 不得 silently drop；多 SSE connection 的 push routing 必須 spec-compliant（同一 message 不重複跨 stream）**
- Review tier: **Tier 3** — 碰 auth plumbing（簽章 secret + context forgery 防護）+ MCP protocol layer + 跨 runtime boundary（Nuxt → DO）；MUST code review 特別檢查 (a) 簽章實作無 timing attack、(b) 反序列化不吃 untrusted input、(c) DO 內重建的 `McpAuthContext` 與 stateless path 行為一致、(d) 改 tool handler signature 時不破壞 stateless path
- Contract / failure paths: 簽章失敗 → DO 回 401（不是 404）；auth context 格式錯誤 → DO 回 400；Tool handler throw 保留既有 `createError` contract；DO init failure → fall through 到 stateless fallback 或明確 500；Network error between Nuxt and DO → DO 層 timeout + retry（最多 1 次）；**失敗路徑不得靜默**；**SSE scope — GET /mcp 缺 SID → 400（spec 要求）；GET /mcp 帶 expired/unknown SID → 404 + re-init guidance；DELETE /mcp 帶 valid SID → 立刻 close 全部 SSE streams + clear DO storage events queue + cancel alarm；CF Edge 30s idle timeout → 25s heartbeat (`: heartbeat\n\n`) + retry hint；client disconnect → DO 保留 event queue 直到 5 分鐘 alarm cleanup 或 session expire**
- Test plan: Unit — auth context sign/verify helper、tool handler context shim；Integration — `mcp-session-durable-object.spec.ts` 擴充 tool dispatch end-to-end 假 McpServer + 假 tool handler 驗證路徑、`mcp-session-handshake.spec.ts` 擴充 flag=true + tool call → 回真實結果；E2E — Playwright 不適合（需 real Claude / Cursor / MCP Inspector），以 manual staging tail 驗證；Regression — 既有 `test/integration/mcp-*.test.ts` + `mcp-agents-compat.spec.ts` 必須全綠（證明 stateless fallback 未變）；**SSE scope — Integration `mcp-session-sse.spec.ts`（GET 開 SSE / tool call 觸發 server-initiated notification 順序 / Last-Event-Id replay / multi-connection round-robin / DELETE 結束 session）；Staging immediate validation 升級為 curl 4 tool call + SSE-aware mock client (ReadableStream consume + Last-Event-Id replay simulation) + 真實 Claude.ai 連 staging 驗證 connector OAuth + 3 query**
- Artifact sync: `openspec/specs/mcp-knowledge-tools/spec.md`（spec delta 合併）、`docs/tech-debt.md` TD-041 / TD-030 Status → `done`（archive 時）、`docs/solutions/mcp-streamable-http-session-durable-objects.md` 補一段「Phase 7：tool dispatch wire-up」、`HANDOFF.md`（若跨 session 則更新）、`openspec/ROADMAP.md` Next Moves 移除對應項

## Impact

- Affected specs: `mcp-knowledge-tools`（Modified — 新增 Requirement）
- Affected code:
  - Modified:
    - server/durable-objects/mcp-session.ts（non-initialize path 從 501 error 改為 `transport.dispatch` + McpServer lazy init + auth/env context rebuild；**SSE scope — 新增 GET handler 開 ReadableStream + Last-Event-Id replay + DELETE handler clear storage**）
    - server/durable-objects/mcp-do-transport.ts（**SSE scope — `send()` server-initiated notifications push 至 enqueueServerEvent 不再 drop**）
    - server/durable-objects/mcp-event-shim.ts（**SSE scope — 暴露 `enqueueServerEvent` API + DO storage events row schema + alarm cleanup helper**）
    - server/utils/mcp-agents-compat.ts（**SSE scope — flag=true + GET/DELETE → forward to DO；移除 unconditional 405 hardcoded check**）
    - server/mcp/tools/ask.ts, server/mcp/tools/search.ts, server/mcp/tools/get-document-chunk.ts, server/mcp/tools/categories.ts（handler 介面改為接 context 參數、或維持同介面但內部 getCurrentMcpEvent 可在 DO context fallback；具體由 apply 決定）
    - server/utils/mcp-middleware.ts（新增 auth context serialization 並寫入 request header）
    - server/utils/mcp-agents-compat.ts（forward request 時帶入簽章後的 auth context header）
    - server/utils/current-mcp-event.ts（可能需要 DO-aware fallback 或廢棄，由 apply 決定）
  - New:
    - server/utils/mcp-auth-context-codec.ts（sign + verify helpers for auth context forwarding）
    - test/unit/mcp-auth-context-codec.test.ts
    - test/integration/mcp-session-tool-dispatch.spec.ts（DO 內 tool dispatch end-to-end）
    - test/integration/mcp-session-sse.spec.ts（**SSE scope — GET SSE / Last-Event-Id replay / multi-connection / DELETE**）
  - Removed: (none)
- Dependencies / bindings: 新增 env var `NUXT_MCP_AUTH_SIGNING_KEY`（shared secret，production / staging 必設，local dev 有 default）；無新套件、無新 wrangler binding、無 migration
- Parallel change coordination:
  - **依賴**：`upgrade-mcp-to-durable-objects` archive（本 change unpark 後以該 change 的 DO class + session lifecycle 為前提）
  - 與 `enhance-mcp-tool-metadata` / `add-mcp-tool-selection-evals` / `fix-delete-account-dialog-google-reauth` 獨立
