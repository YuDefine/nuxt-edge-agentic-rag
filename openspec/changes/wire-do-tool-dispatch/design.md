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

### Decision 4: Rollout = staging flag=true immediate verification → production flag=true

**Choice**:

- Staging：`NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true` 後立即做 MCP protocol 驗證：`initialize` / `tools/list` / `tools/call`，並讓 `AskKnowledge` / `SearchKnowledge` 各至少 2 次通過；確認 response 非 501、非 re-init loop，且 staging custom domain 可達（HTTP 200）
- Staging tail：若本機具備 Cloudflare token，補 `wrangler tail` 確認無 `ownKeys` error / 401 auth context failure；若本機無 token，改以 GitHub deploy evidence + protocol response 記錄替代 tail
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
7. Staging deploy + flag true + immediate MCP protocol verification
8. Production flag true + 24 小時監控
9. Archive change + TD-041 / TD-030 標 done

**SSE scope expansion phases (2026-04-25 ingested)**:

10. mcp-agents-compat.ts: flag=true + GET/DELETE → forward to DO（移除 unconditional 405 hardcoded check）
11. mcp-event-shim.ts: 暴露 `enqueueServerEvent(message)` API + DO storage events row schema + 5 分鐘 alarm cleanup
12. mcp-do-transport.ts: `send()` server-initiated notifications push 至 enqueueServerEvent 不再 drop
13. mcp-session.ts: GET handler 開 ReadableStream + 25s heartbeat + Last-Event-Id replay；DELETE handler clear storage + close streams + cancel alarm
14. Integration test `mcp-session-sse.spec.ts`（GET SSE / replay / multi-connection / DELETE）
15. `pnpm check` 全綠
16. Staging immediate validation 升級（curl 4 tool call + SSE-aware mock client + 真實 Claude.ai 連 staging OAuth + 3 query）
17. Production flag flip + 24 小時 tail
18. Archive change

## Open Questions

- 4 個 tool handler 內 `useLogger(event)`（evlog）能否在 DO-aware shim 下正常運作？— 需 spike 確認 shim 是否覆蓋 evlog 取 context 路徑
- DO 內若 tool handler throw，evlog 的 wide event 如何 surface 到 server-side drain？— 可能需要 DO 明確 `context.waitUntil(log.flush())`
- `Mcp-Session-Id` header 在 tool 層是否要 expose 給 tool handler？— 初版否；只給 auth + env，session id 是 transport 概念

---

## SSE Architecture (scope expansion 2026-04-25)

### Sequence Diagram

```
Claude.ai client                Worker (Nuxt /mcp)            DO MCPSessionDurableObject
     |                                |                              |
     |--POST initialize-------------->|                              |
     |                                |--fetch (POST forward)------->|
     |                                |                              |--lazy init McpServer
     |                                |                              |--register 4 tools
     |                                |<-{result, MCP-Session-Id}----|
     |<-{result, MCP-Session-Id}------|                              |
     |                                |                              |
     |--POST initialized------------->|--fetch--------------------->|
     |<--202 Accepted-----------------|<--202------------------------|
     |                                |                              |
     |--GET /mcp (Accept: SSE)------->|--fetch (GET forward)-------->|
     |                                |                              |--register SSE channel
     |                                |                              |--load events queue (if Last-Event-Id)
     |<==SSE stream open==============================================<|
     |<==25s heartbeat (": heartbeat\n\n")============================<|
     |                                |                              |
     |--POST tools/call-------------->|--fetch--------------------->|
     |                                |                              |--start tool call
     |<==SSE: progress notif (eventId=stream-1:5)====================<|
     |<==SSE: progress notif (eventId=stream-1:6)====================<|
     |<-{result, response}------------|<-{response}------------------|
     |<==SSE: complete (eventId=stream-1:7)===========================<|
     |                                |                              |
     |   (network failure / disconnect)|                             |--keep events in storage
     |                                |                              |
     |--GET /mcp (Last-Event-Id:5)--->|--fetch (GET forward)-------->|
     |                                |                              |--replay events 6,7
     |<==SSE: replay event 6==========================================<|
     |<==SSE: replay event 7==========================================<|
     |<==SSE stream resumed==========================================<|
     |                                |                              |
     |--DELETE /mcp------------------>|--fetch (DELETE forward)----->|
     |                                |                              |--clear DO storage
     |                                |                              |--close all streams
     |                                |                              |--cancel alarm
     |<--204 No Content---------------|<--204------------------------|
```

### DO Multi-Connection Map

DO instance 維護 `Map<connectionId, SseWriterEntry>`（其中 `SseWriterEntry = { connectionId, writer, heartbeatAlive, lifetime, resolveLifetime }`）。

**Server-initiated notification routing — broadcast (post-review fix)**：原本設計採 newest-active 路由（最近 attach 的 writer 優先；其他 stream 只收 heartbeat），但實作 review 揭露這會讓 client 為了 redundancy 開兩條 SSE 時，舊那條完全沒收到 notification。改為 broadcast 給 `writers` 內所有 entry — spec MAY allow client dedupe by event id，且 storage event queue 持久化保證 reconnect 也能 replay；同 message 經 broadcast 後 client 用 `Last-Event-Id` 自行去重。

### Stream Lifecycle Invariants

- **`ctx.waitUntil(entry.lifetime)`**：每個 SSE writer entry 帶一個 deferred promise (`lifetime` + `resolveLifetime`)。`handleGet` 末段 `this.ctx.waitUntil(lifetime)` 框住 stream 生命；`removeWriter` / `closeAllSseWriters` `resolveLifetime()` 解除。沒有這層，runtime 會在 fetch return Response 後 GC pending heartbeat / writes，導致 SSE 隨機失效。
- **`enqueueAndPushServerNotification` 不可 throw**：整段包 try/catch + `logDoError(err, 'sse-enqueue-push')` swallow。storage error / quota error / writer error 不能讓主 RPC 對話 break。

### Auth + Session Ownership Invariants

- **Trust boundary**：DO 在 POST/GET/DELETE 都獨立驗證 `verifyForwardedAuthContext` — 即使 worker shim 已先驗一次。`initialize` 路徑也不豁免（trust boundary 原則 + 防 future direct DO call 繞過）。
- **`McpSessionState.ownerUserId`**：從 initialize 時的 verified envelope `auth.principal.userId` 寫入；後續所有 method 比對 `existing.ownerUserId === auth.principal.userId`，不一致回 403 ownership mismatch。防止 `Mcp-Session-Id` 洩漏（log scrape / browser-shared link）後 attacker 用自己合法 token 接手別人 session。
- **`initialize` 衝突 owner 拒絕**：existing session 已綁某 user，攻擊者用自己的 token initialize 同 sessionId 也回 403。

### Cloudflare Workers SSE 設計依據

- Workers `Response` body 透過 `ReadableStream` / `TransformStream` 可 hold open，沒 effective limit on response duration（CF docs 確認）
- DO 的 `ctx.waitUntil(streamLifetime)` 確保 stream lifecycle 正確
- 30s CPU 上限對 idle SSE 不適用（idle wait 不計 CPU）— 只在 heartbeat / push event 時 hit CPU
- CF Edge 30s idle timeout 防護：每 25s 送 SSE comment `: heartbeat\n\n` + `retry: 3000\n\n` field
- HibernatableWebSocket 僅限 WebSocket，不適用 SSE（SSE 用 ReadableStream 必須持續 alive）；client disconnect 時 DO instance 仍 keep storage event queue 直到 alarm cleanup

## Storage Schema for Event Queue (scope expansion)

DO `ctx.storage` 新增 events queue rows：

```typescript
// Row key: `events:<eventId>`
interface SseEventRow {
  eventId: string // e.g. "stream-1:7" — encode origin stream + per-stream cursor
  data: string // JSON-RPC notification serialized as SSE event payload
  eventType?: string // optional SSE `event:` field（spec 預設 "message"）
  timestamp: number // Date.now() at enqueue
}
```

**Quota / TTL eviction**:

- max 100 events / session（FIFO）— 超過時 alarm cleanup 刪最舊
- 5 分鐘 TTL — alarm 每分鐘掃描 `events:*` rows 刪 timestamp < `Date.now() - 5*60*1000`
- DELETE /mcp → 立刻清整個 events:\* range

**Storage cost**: 每 row ~1KB；單 session 最大 100KB；DO storage quota 128MB → 同 instance 可承載 ~1000 active sessions 同時上限滿載（保守）

## Last-Event-Id Resumability (scope expansion)

### eventId 編碼

格式：`<streamType>:<counter>`

- `stream-1` = SSE channel from GET /mcp 第一條
- `stream-2` = SSE channel from GET /mcp 第二條（multi-connection 場景）
- counter = 此 stream 內 monotonic increment

spec 要求 eventId globally unique within session，且 encode origin stream，便於 server 對應 `Last-Event-Id` 路由到正確 stream replay queue。

### Replay 演算法

GET /mcp 帶 `Last-Event-Id: <eventId>` 時：

1. 解析 eventId → 取 streamType（決定哪條 stream 的 replay queue）
2. `ctx.storage.list({ prefix: 'events:', start: 'events:<eventId>:next' })` 取出所有 missed events
3. 透過 newly-opened SSE channel 依序 push（保持 SSE event ID 連續）
4. Replay 完畢後，新 events 繼續 push 至此 stream

若 `Last-Event-Id` 對應 row 已被 TTL 清除：

- 回 `id: <newId>\nevent: events_dropped\ndata: {"missed":N}\n\n` 提示 client 漏掉 N 個 events
- client 應自行決定是否需要 re-init session（spec 沒強制；toolkit 用法層判斷）

## Toolkit-Transparent Integration (scope expansion)

`mcp-do-transport.ts:42-53` 既有缺口：

```typescript
// 現況（v0.43.x）
async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
  if (this._closed) return
  if (!isJsonRpcResponse(message)) {
    // The SDK only sends responses or notifications via transport.send on
    // the server side. Notifications have no id to correlate, so drop them
    // silently (HTTP transport cannot deliver server-initiated notifications
    // without a streaming channel).
    return
  }
  // ... resolver dispatch
}
```

scope expansion 後：

```typescript
// 改後
async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
  if (this._closed) return
  if (!isJsonRpcResponse(message)) {
    // Server-initiated notification → enqueue for SSE replay & live push
    await this.eventShim?.enqueueServerEvent(message)
    return
  }
  // ... resolver dispatch（不變）
}
```

**結果**：tool handler 內任何 toolkit composable 用法（`useMcpLogger().notify.info(...)`、`useMcpLogger().notify.error(...)`、SDK `server.sendLoggingMessage`）會透過 `transport.send()` 走到 `enqueueServerEvent` → 進 DO storage event queue → live push 給 active SSE channels + persist 給未連線 client 重連 replay。

**Toolkit pattern 完全保留**：tool handler code 不需感知 DO / SSE / event queue；transport-level transparent implementation。專題報告可正當主張「toolkit composable 在 Edge runtime 完整可用」，且 stateful claim 名實相符（DO 是 source of truth、SSE 是 transport channel、toolkit 是 developer-facing API surface）。
