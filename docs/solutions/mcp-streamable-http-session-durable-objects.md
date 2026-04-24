---
category: mcp-transport
tags: [mcp, cloudflare, durable-objects, sdk, proxy, ownkeys]
date: 2026-04-24
change: upgrade-mcp-to-durable-objects
spike: phase-1-q6
---

# MCP Streamable HTTP re-init 循環 — 真因為 SDK 碰 Cloudflare env proxy 的 `Reflect.ownKeys`

## Problem

前置 change `fix-mcp-streamable-http-session`（v0.37.0）把 `GET /mcp` 改為 `405 Allow: POST` 後，Claude.ai 首次 handshake 成功（`initialize 200 → initialized 202 → tools/list 200`），但**每次 tool call 前 Claude 自發 re-initialize，第二次 `POST /mcp initialize` 回 400**，`tools/call` 從未抵達 server，UI 顯示 "Error occurred during tool execution"。

Wrangler tail 觀察：每 3 秒循環 `POST 400` + `GET 405` 至少 5 筆，`tools/call` method 從未出現在 log。TD-030 `high` 登記此 gap。

## What Didn't Work（兩輪推論都錯）

### Round 0（proposal 靜態分析假設）

讀 `@modelcontextprotocol/sdk` 的 `webStandardStreamableHttp.js`，`POST initialize` 只可能走 3 條 400 path：

- `line 402` → `-32700 Parse error: Invalid JSON`（`req.json()` 失敗）
- `line 417` → `-32700 Parse error: Invalid JSON-RPC message`（Zod schema parse 失敗）
- `line 427` → `-32600 Invalid Request: Server already initialized`（`_initialized && sessionId !== undefined` guard）

推論：shim 傳 `sessionIdGenerator: undefined`，line 427 結構上不會命中，剩下兩個 Parse error path 是問題。

### Round 1 spike（diag patch 版 1）

加 `[MCP-DIAG]` log 在 `transport.handleRequest` 回傳後，status ≥ 400 時 log response body + request body + 選定 headers（不 log Authorization）。Deploy 到 production，Claude.ai 重現 re-init 循環。

**結果**：tail 完全沒有 `[MCP-DIAG]` log。Toolkit observability 看得到 400，但 shim 的 `console.log` 沒跑到。

推論：shim guard `if (server.transport !== undefined) throw` 在 `transport.handleRequest` 之前就 throw，log 因此不執行。

### Round 2 spike（diag patch 版 2）

加 `[MCP-DIAG-ENTRY]` log 在 shim 函數入口（route check 之後、GET/DELETE 405 與 guard 之前），記錄 `hasExistingTransport: server.transport !== undefined`，驗證 guard 假設。

**結果 1**：`hasExistingTransport: false` — **guard 從未命中**。`server` 不是 singleton（toolkit 每 request 給 fresh instance），上面兩輪推論都錯。

**結果 2**：`[MCP-DIAG]` 這次有 log，response body 露出真正錯誤：

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32700,
    "message": "Parse error",
    "data": "TypeError: a16.ownKeys is not a function or its return value is not iterable"
  },
  "id": null
}
```

## Solution（Root cause）

**真正的 400 來源**：SDK 在 JSON-RPC parse path 某處呼叫 `Reflect.ownKeys()`，對象是 Cloudflare env binding proxy（`a16` 是 minified 變數名），該 proxy 不支援 `ownKeys` trap → throw TypeError → SDK 外層 catch 包成 `-32700 Parse error`。

這與 `server/utils/mcp-agents-compat.ts:78-85` 註解記錄的同家族問題一致——當初 shim 存在的理由，正是因為 `agents/mcp` 的 `WorkerTransport` 在 production `tools/call` 爆 `ownKeys` error。

**新發現**：shim 改用的 `WebStandardStreamableHTTPServerTransport` **也爆同樣的 `ownKeys` error**，只是時機點不同：

- 第一次 handshake（200 OK）：`installEnumerableSafeEnv(env)` 設好 `globalThis.__env__` 的 enumerable-safe 鏡像，SDK 沒走到 env proxy。
- 第二次以後的 initialize：SDK 某段（`a16`）直接碰原生 env proxy 而非 `__env__`，`installEnumerableSafeEnv` 繞不到。

### 意義

原 proposal 以為 DO + per-session server 架構能解決 re-init 循環。**實證證明 DO 方案本身不充分**：

- Re-init 循環不是 session state 問題，是 Cloudflare env binding proxy 與 MCP SDK 不相容的問題。
- 把 `WebStandardStreamableHTTPServerTransport`（或 `McpAgent`）搬進 DO 不會改變 SDK 碰 env proxy 的事實——每次 initialize 仍會觸發 ownKeys TypeError。

DO 仍可能是終局架構（給 session state / SSE push），但**必須先修 env proxy 相容問題**。

## Pivot Options（進 Phase 2 前評估）

| 選項                              | 方法                                                                                                                                                                                     | 成本                                   | 風險                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A 加強 `installEnumerableSafeEnv` | grep SDK dist 找 `a16` 對應的 env access pattern，把那個 access point 也 shim                                                                                                            | 低；不動 SDK；相容性風險低             | 下次 SDK 升級可能又引入新 `Reflect.ownKeys` 位置，shim 變脆弱                                  |
| B Fork / monkey-patch SDK         | 把 SDK 所有 `Reflect.ownKeys` / `Object.keys(env)` 取用改成 safe iteration                                                                                                               | 中；要 maintain patch 跟 upstream 同步 | 每次 SDK 升版都要重 diff                                                                       |
| C 自寫 minimal JSON-RPC transport | 不用 SDK 的 `WebStandardStreamableHTTPServerTransport`，在 DO 內直接實作 MCP Streamable HTTP（handshake / tool call routing / session id），只在必要處呼叫 MCP `McpServer.invoke` 類 API | 高；要吃 MCP spec 細節                 | 長期維護成本最低；但功能 completeness 要逐個手工實作（prompt / elicitation / sampling 暫時缺） |

## Pivot Decision — C（2026-04-24）

**決定**：Pivot C — 自寫 minimal Transport shim（不用 SDK 的 `WebStandardStreamableHTTPServerTransport`）。

### 關鍵 surface 評估

MCP SDK 的 `Transport` interface（`node_modules/@modelcontextprotocol/sdk/dist/esm/shared/transport.d.ts:40-90`）極簡：

- `start(): Promise<void>` — no-op 即可
- `send(message, options?): Promise<void>` — 把 response message 寫回（我們用 promise resolver 模式）
- `close(): Promise<void>` — no-op 即可
- `onclose?` / `onerror?` / `onmessage?` — SDK 會設定
- `sessionId?` / `setProtocolVersion?` — 可選

SDK 的 `Protocol` 基類（`shared/protocol.js:215-247`）在 `connect(transport)` 時綁定 `_onmessage` callback；request 解析 / handler 派遣 / response 組裝都在 SDK 內完成。因此我們的 shim 只需做 **HTTP request ↔ JSONRPCMessage 橋接**，不碰 MCP 語義細節。

### 為何此設計繞開 ownKeys bug

`WebStandardStreamableHTTPServerTransport` 在 `handlePostRequest` 內呼叫 `Reflect.ownKeys(env)`（間接經 SDK minified code `a16`），碰 Cloudflare env proxy 即 throw。我們的 shim **從未讀取或反射 `env` object**——只處理 plain JSON payload。`McpServer.connect(ourShim)` 後，SDK 所有 request handler 走 `Protocol._onrequest` → `_requestHandlers.get(method)` → 我們註冊的 tool handler；這條 path 不接觸 env proxy。

### 最小實作 surface

1. `server/mcp/do-transport.ts`：`DoJsonRpcTransport` class（~30 lines）
   - `send(msg)` 把 response 收進 per-request promise resolver
   - `onmessage` / `onclose` / `onerror` 是 SDK 設的 callbacks
2. `server/mcp/durable-object.ts`：`MCPSessionDurableObject` class
   - `fetch(request)`：parse body → `transport.onmessage(msg, {...})` → await `send` callback 收到 response → 回 HTTP JSON response
   - 首次 `initialize` 簽發 `Mcp-Session-Id` header；state `this.state.storage` 持久化
   - `alarm()` 驅動 TTL GC
3. Worker 層 `server/mcp/index.ts`：依 `features.mcpSession` flag 路由：
   - true → 抽 / 生成 `Mcp-Session-Id` → `env.MCP_SESSION.idFromName(sessionId).fetch(request.clone())`
   - false → 保留現行 stateless shim path
4. `wrangler.jsonc` 加 `durable_objects` binding + migration tag v1

### 放棄 Pivot A/B 的理由

- **A（加強 `installEnumerableSafeEnv`）**：Round 2 實證第一次 handshake 的 `installEnumerableSafeEnv` 有效，第二次失效——SDK 的 env access pattern 不穩定，每次 SDK 升版可能引入新位置。Shim 變脆弱。
- **B（fork / monkey-patch SDK）**：每次 SDK 升版要重 diff，長期維護成本高；且相容性風險仍存在（patch 可能 miss 新路徑）。

Pivot C 根除問題：我們的 transport 根本不碰 env proxy，SDK 怎麼 import env 都不影響。維護表面從「追 SDK ownKeys 漏洞」變成「維護 ~30 line transport shim」。

### 後續 (Phase 3+)

詳見 `openspec/changes/upgrade-mcp-to-durable-objects/tasks.md` Phase 4 起（已依 Pivot C 重新 scope）。

## Prevention

- **下次面對 production 400 的第一動作**：加 diag patch 捕 response body，不要只靠靜態分析推論。兩輪 spike 省下一個 pivot 錯方向的 change cycle。
- **MCP SDK 升級**：每次 bump 後先檢查 `Reflect.ownKeys` / `Object.keys(env)` / `for...in (env)` 等訪問 pattern 是否有新增。
- **Cloudflare Workers + 第三方 SDK 通則**：第三方 SDK 預期 env 是 plain object，但 Cloudflare 給的是 proxy。若 SDK 任何地方做 `Reflect.*` 反射，就有風險。應該在 worker 入口就把 env 深複製成 plain object 再傳給 SDK。

## Related

- `openspec/changes/upgrade-mcp-to-durable-objects/` — 本 change；本 spike 是 Phase 1
- `openspec/changes/archive/2026-04-24-fix-mcp-streamable-http-session/` — 前置 change
- `docs/solutions/mcp-streamable-http-405-stateless.md` — 前置 change 的 405 決策
- `docs/solutions/mcp-body-stream-consumption.md` — rehydrate helper（另一個 SDK 相容問題）
- `docs/tech-debt.md` TD-030 — 本議題 follow-up entry
- `server/utils/mcp-agents-compat.ts:78-85` — shim 註解記錄同家族 `ownKeys` error
