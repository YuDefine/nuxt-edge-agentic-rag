## Why

Production 的 Claude.ai MCP integration 目前完全無法 call tool。從 `wrangler tail`（2026-04-24 04:37 UTC）看到每次 `POST /mcp` `initialize` 都回 **400 / 1.6s**，Claude.ai host 看到 handshake 失敗後，把任何 `tools/call` 回 generic `"Error occurred during tool execution"` 給使用者。

Root cause：

1. `@nuxtjs/mcp-toolkit` `createMcpHandler`（node_modules/.../mcp/utils.js）在 middleware 之前會先跑 `tagEvlogContext(event)` → `await readBody(event)`，**把 Cloudflare Workers 原生 Request 的 body stream 消耗掉**
2. `server/mcp/index.ts:24` 傳給 middleware 的 `extractToolNames`（toolkit 內 util）也會 `await readBody(event)`（已命中 H3 cache，不再消耗，但加強了對 body 的依賴）
3. Middleware 結束後，toolkit 走到 node provider：`const request = toWebRequest(event); return transport.handleRequest(request)`。Workers 環境下 `toWebRequest` 直接返回同一個 `event.web.request` — body stream 已 disturbed
4. MCP SDK 的 `WebStandardStreamableHTTPServerTransport.handleRequest` 嘗試 `await request.json()` parse JSON-RPC → 拿到空 body → 回 400 JSON-RPC parse error

因此即使 bearer auth、role gate、rate limit 三層 middleware 都正確通過，後面的 MCP handshake 永遠炸。

### 佐證（wrangler tail）

```
POST /mcp - status 400, duration 1.62s  (mcp.method: initialize, request_id: 0)
GET  /mcp - Exception: Worker's code had hung and would never generate a response
POST /mcp - status 400, duration 368ms  (mcp.method: initialize, request_id: 0)
GET  /mcp - Exception: ...hung...
```

GET 的 hang 是次要症狀（Cloudflare provider alias 後 no-session 模式對 GET 未快速回 405，而是讓 transport 掛 SSE 等 push），不影響 Claude 的 POST 主路徑，但會吃 Worker CPU budget 與 log noise，本 change 會一併評估是否 fix。

## What Changes

### 主要修正：`server/mcp/index.ts`

在 middleware 結尾加 `rehydrateMcpRequestBody(event)`，用 H3 已 cache 的 parsed body 重建新的 `Request` 物件並塞回 `event.web.request`，讓後續 `toWebRequest(event) → transport.handleRequest(request)` 拿到 body 還沒被讀過的 Request。

- 讀取用 `readBody(event)`（命中 cache，不重複消耗 stream）
- 寫回 `event.web.request = new Request(url, { method, headers, body: bodyText, duplex: 'half' })`
- GET / HEAD 沒 body，跳過這步
- 如果之後升級 toolkit 修了這個 upstream bug，這個 helper 會變 no-op 且可安全移除

### 次要評估：GET /mcp hang

先 deploy POST fix 後用 tail 再看一次。若 Claude 不打 GET，只是其他 client 偶發，降為 observation；若持續在 tail 刷出 "hung" warning，另開 change 處理（可能要切 cloudflare provider 的 GET 快回 405 邏輯，或升級 toolkit）。

### 防回歸

`test/integration/mcp-routes.test.ts` 已存在 — 補一個 spec：真打 `POST /mcp` 帶一個完整 `initialize` JSON-RPC payload（bearer token 用 fixture mock），assert response 不是 `{ jsonrpc, error: { code: -32700, ... } }` 且不是 HTTP 400。

## Non-Goals

- 不升級 `@nuxtjs/mcp-toolkit`（這個 upstream bug 要升版本 + 可能 breaking change，非緊急修 scope 內）
- 不改 middleware 的 auth / rate-limit / role-gate 邏輯
- 不動 tool handler (`server/mcp/tools/*.ts`) 本身
- 不處理 `GET /mcp` hang 的 hard fix（本輪先 observe，若仍有另開 change）

## Capabilities

### New Capabilities

_(none — 純 bugfix，沒有新能力)_

### Modified Capabilities

- `mcp-knowledge-tools`：handler 的 middleware scope 擴張一個 body-rehydrate 責任；MCP protocol handshake（initialize / tools/call）必須能成功 parse JSON-RPC body

## Impact

- **Code**: `server/mcp/index.ts`（主要）、`test/integration/mcp-routes.test.ts`（regression test）
- **Specs**: `openspec/specs/mcp-knowledge-tools/spec.md` 需要補一條 requirement：MCP handler middleware MUST 保證 request body stream 在 transport 層可重讀
- **Runtime**: Cloudflare Workers production (`agentic.yudefine.com.tw`) 與 staging
- **External**: Claude.ai Remote MCP integration 恢復可用；ChatGPT Remote MCP connector 同樣受益
- **Risk tier**: Tier 2（動到 MCP auth path 週邊，但不改 auth 語義）

## Affected Entity Matrix

_(N/A — 本 change 不觸動任何 DB entity / enum / shared type)_

## User Journeys

**No user-facing journey (backend-only)**

理由：本 change 只修 MCP server handler 的 HTTP request body 處理路徑，沒有 UI 變更。Journey 驗收改由 Claude.ai / ChatGPT 兩個 remote MCP integration 的 E2E 實測（由使用者本人在 production 觸發 tool call 確認回傳正常）。

## Implementation Risk Plan

- **Truth layer / invariants**: MCP JSON-RPC body 是一次性可讀的 source of truth；middleware 讀完必須重建 Request 供 transport 重讀。middleware 的 auth / scope / role-gate 語義不變，不能因為 body rehydrate 順手改任一條。
- **Review tier**: Tier 2（動到 MCP auth path 的 handler 包裝層，不改 auth 判斷本身；會有單元 / integration test 覆蓋）
- **Contract / failure paths**:
  - GET/HEAD: 不改，跳過 rehydrate
  - POST 無 body: `readBody` 回 null/undefined，rehydrate 寫空 body（不 crash）
  - POST 大 body（MCP 有 tools list response 可能較大，但 request 通常小）: 一次全讀，OK
  - H3 cache key 未來變動: 用 `readBody(event)` 命中 cache 而非手摸 `_requestBody`，較穩
  - Upstream toolkit 未來 fix: helper 變 no-op，但 `event.web.request` 被替換成新 Request 可能對其他 middleware 造成行為差異 — 以 Non-Goals 排除深度重構
- **Test plan**:
  - Unit: 對 `rehydrateMcpRequestBody` 寫純函式測試（mock event with web.request, 呼叫後驗證新 request.text() 可讀）
  - Integration: `test/integration/mcp-routes.test.ts` 補真打 `POST /mcp` `initialize` 的 case，assert 非 400 / 非 parse_error
  - Manual: deploy 後 `wrangler tail` 確認 `POST /mcp` status 200，Claude.ai 觸發 `AskKnowledge` / `ListCategories` 兩個 tool 都回真實結果
- **Artifact sync**:
  - `openspec/specs/mcp-knowledge-tools/spec.md` 補 request body invariant
  - `docs/solutions/` 寫一篇 `mcp-body-stream-consumption.md` 把這個 root cause + 解法沉澱，避免日後升級 toolkit 時踩回去
  - `HANDOFF.md` 不更動（本 change 預計單一 session 內收斂）
  - `openspec/ROADMAP.md` 會由 hook auto-sync
