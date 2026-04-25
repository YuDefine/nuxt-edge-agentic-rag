---
date: 2026-04-25
status: accepted
related-change: wire-do-tool-dispatch
supersedes: —
---

# Cloudflare Workers SSE streaming bypass for `/mcp` GET / DELETE

## Decision

`/mcp` GET 與 DELETE 不走 nitropack 預設的 cloudflare-module entry → `nitroApp.localFetch` 路徑。改在自訂 cloudflare-module entry (`build/nitro/cloudflare-mcp-sse-entry.mjs`) 的 `hooks.fetch` 攔截，直接 forward 到 MCP session Durable Object，把 DO 回的 `Response`（含 `ReadableStream` body）原封不動回傳給 workerd。

DO 端 `handleGet` 用 `new ReadableStream({ start(controller) })` + `controller.enqueue()` 同步推 frame，不用 `TransformStream` + `await writer.write()`。

POST `/mcp` 不變，仍走 nitroApp.localFetch + 既有 `mcp-toolkit` + `mcp-agents-compat` shim 路徑。

## Context

`wire-do-tool-dispatch` v0.43.3 production flag flip true 後 5 分鐘內失敗：Claude.ai client 對 stateful server 試 `GET /mcp` 開 server-initiated channel，被 `mcp-agents-compat` 回 `405`，client 解讀為 self-contradicting state（stateful server 卻無 SSE）→ 觸發 OAuth 循環 → "Authorization with the MCP server failed"。stop-gap rollback v0.43.4 把 flag 改回 false。

接下來 4 個版本 (v0.44.0 → v0.45.1) 各揭露一層 root cause，每層的 fix 都是 production-side 必要但不夠：

| 版本        | GET 行為                                                 | Root cause                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.43.4     | 405                                                      | `mcp-rehydrate-request-body.ts` GET/HEAD/DELETE early return → forward request 沒注入 `X-Mcp-Auth-Context` header → `mcp-agents-compat:139` 條件不成立掉到 stateless 405                                                                                                  | GET/HEAD/DELETE 在 `event.context.mcpAuthEnvelope` 存在時也 install replay request 注入 header                                                                                                                                                  |
| v0.44.0     | 500 `TypeError: not an integer. cause: { remote: true }` | workerd runtime 對 `TransformStream` `highWaterMark` 做 internal integer conversion，拒收 `Number.POSITIVE_INFINITY`                                                                                                                                                      | 改 `Number.MAX_SAFE_INTEGER`                                                                                                                                                                                                                    |
| v0.44.1     | hang 30s                                                 | DO `handleGet` `await writer.write(initial connected primer)` 在 workerd backpressure deadlock：`TransformStream` readable HWM 即使大，`writer.write` 仍要等 readable side 被 client 拉才釋放，但 client 拉發生在 fetch handler return Response 後 — 經典 deadlock        | （不修，留 v0.45.1 一起改架構）                                                                                                                                                                                                                 |
| v0.45.0     | fetch failed 5 min timeout                               | nitropack cloudflare-module preset 用 `toNodeListener` + `fetchNodeRequestHandler` (node-mock-http) 把 H3 app 包成 emulated Node listener，必須等 `res.end()` 才 resolve fetch；SSE long-lived stream 永不 end → fetch 永不 resolve → workerd 永不 send headers 給 client | 自訂 cloudflare-module entry hooks.fetch 攔截 GET/DELETE /mcp，bypass `nitroApp.localFetch`；配 `server/utils/mcp-streaming-bypass.ts` (env.DB raw query verify token + envelope sign + DO `stub.fetch` forward) + plugin 暴露 handler 給 entry |
| **v0.45.1** | **200 streaming**                                        | DO writer.write hang 餘下                                                                                                                                                                                                                                                 | DO `handleGet` 改 `ReadableStream({ start(controller) })` + 同步 `controller.enqueue()`（mirror SDK `webStandardStreamableHttp.js handleGetRequest` pattern），所有 `writeSseFrame` 改 sync                                                     |

`pnpm mcp:acceptance:staging` 12/12 step 全綠 in 29.5s（v0.45.1, Deploy run 24931403722）。Production v0.46.0 flip 後 worker fetch handler 正常運作。

## Alternatives Considered

### A. 全程走 nitroApp.localFetch（不 bypass）

- 嘗試把 `evlog/nuxt` plugin 的 `/mcp` include 拿掉、把 mcp-toolkit alias 拿掉、用 H3 `createEventStream` 自帶 SSE primitive
- 但 root cause 是 `node-mock-http` 的 `callNodeRequestHandler` 必須 `await n(t, r)`（要 res.end()），不論 H3 內部用什麼 SSE helper 最終都會被這個 emulated NodeRes 收集
- nitro 的 cloudflare-module preset v2.13.x 沒有暴露「streaming response 直 forward」的 hook
- 結論：在 nitro localFetch 框架內無法解 long-lived SSE response

### B. 換 framework（純 Cloudflare Worker fetch handler，不用 Nuxt Nitro）

- 大改動、scope explosion、丟掉 mcp-toolkit + 既有 evlog / auth middleware 整合
- 不採用

### C. 不實作 SSE，server 永遠 stateless POST-only 回 GET 405

- MCP spec 2025-11-25 允許 stateless server 對 GET 回 405
- 但 v0.43.3 實測證明 Claude.ai client 對 stateful server (回 `Mcp-Session-Id`) 收 GET 405 會解讀為 self-contradicting → 重 OAuth；不適合 stateful Worker scope
- 不採用

### D. 自訂 cloudflare-module entry `hooks.fetch` bypass（採用）

- 只攔截 GET / DELETE `/mcp`，POST 不變
- 用 `nitro.alias` 把 nitropack 內部 `cloudflare-module.mjs` path 替換為自訂 entry
- nitroApp plugin (`server/plugins/register-mcp-streaming-bypass.ts`) 在 entry 階段把 bypass handler 暴露到 `nitroApp.mcpStreamingBypass`
- bypass handler 自己用 env.DB raw `prepare/bind/first` 驗 bearer token + crypto.subtle 簽 envelope + `namespace.idFromName().get().fetch()` forward to DO
- DO `handleGet` 改 ReadableStream pattern 同步 enqueue → fetch handler 立刻 return Response，client 立刻收 headers，後續 frame 透過 controller.enqueue() 同步推

## Reasoning

- 解決 v0.43.3 production flip 失敗的根因（不是單一 bug，是 4 層）
- 不破壞 POST 路徑既有設計（toolkit + shim + DO dispatch 全保留）
- 不依賴 framework upgrade / vendor patch — nitropack v2.13.x 的內部 path 用 alias 替換，後續升級 nitro 時若 path 改變，build error 會明確指向 alias 失效
- bypass handler 邏輯獨立（只用 env binding + crypto.subtle + 自家 helpers），不依賴 nitroApp internals 中的 unsafe assumption
- DO ReadableStream pattern 跟 SDK `webStandardStreamableHttp.js handleGetRequest` 對齊，後續 SDK 升級時行為一致

## Trade-offs Accepted

1. **與 nitro 內部 path 耦合**：`nitro.alias[...cloudflare-module.mjs]` 用 absolute path 字串。nitro 升級可能改 path → 需重對齊。緩解：alias 失效時 nitro build 會立刻 fail，不會 silent regression
2. **bypass handler 自寫 D1 token verify**：複製了 `mcp-token-store` + `mcp-auth` 的部分邏輯（hashMcpToken + raw SQL）。不直接 import 因 entry 階段 nitroApp scope 不夠 ready 引 server/utils 的 drizzle helpers。緩解：bypass 與 mcp-token-store 都依賴同一個 SQL schema (`mcp_tokens` table)，schema migration 時兩處都要對齊
3. **DO ReadableStream cancel callback**：client 取消時 `cancel()` 會 call removeWriter；舊 TransformStream pattern 是寫 failure 才觸發 cleanup。新 pattern 略不同但行為等價（兩條路都會 resolveLifetime + 清 writers Map）

## Supersedes

無 — 本 ADR 是 §6.4 G2 trace 後的首個架構決策。`mcp-rehydrate-request-body` GET/DELETE inject + `mcp-session.ts` HWM 修都是 production-side fix，不是架構決策。
