## Why

前置 change `fix-mcp-transport-body-consumed`（archived `v0.34.5`）修好了 `POST /mcp initialize` 回 400 的 transport body consumption 問題。Production tail 證實首次 handshake 成功：initialize → 200、notifications/initialized → 202、tools/list → 200。但 Claude.ai 端仍顯示「Error occurred during tool execution」/「Authorization with the MCP server failed」。

再看 tail 發現 **更深層的問題**：

```
POST /mcp initialize           200  (OK, tools list 成功送到 Claude)
POST /mcp notifications/initialized 202
POST /mcp tools/list           200
POST /mcp initialize           400   ← Claude 又 re-initialize
GET  /mcp                       Worker hung 30s (runtime cancel)
POST /mcp initialize           400
GET  /mcp                       hung
POST /mcp initialize           400
... 無限循環
```

Root cause：**MCP Streamable HTTP 協議需要 SSE long-lived session，但 server 走 stateless 模式**。

1. Claude.ai 收到首次 `initialize` 回應後，按 Streamable HTTP spec 發 `GET /mcp` 開 SSE stream 接收 server-initiated message
2. 我們走的是 `@nuxtjs/mcp-toolkit` 的 node provider stateless 分支（`sessionIdGenerator: undefined`）— 這條 path 對 GET 沒有快速回 405，而是讓 `WebStandardStreamableHTTPServerTransport.handleRequest(GET)` 掛著等 server push
3. Stateless transport 沒有 server-initiated event 要推，SSE 永遠不關 → Cloudflare Worker 30 秒後 `"code had hung and would never generate a response"` cancel
4. Claude.ai 看 SSE 連線斷，觸發 retry — 重新 `POST /mcp initialize`
5. Retry 時 body 可能不完整（重試 probe 的特殊 body 結構）→ transport.handleRequest 回 400
6. Claude 判定 server 有問題 → UI 顯示「Authorization failed」或「tool execution failed」

`fix-mcp-transport-body-consumed` 只能救 step 1 的首次 handshake，step 2–6 的死循環仍在。

## What Changes

### 方向 A：啟 Streamable HTTP session 模式（優先）

啟用 `@nuxtjs/mcp-toolkit` 的 session 支援：

- 首次 `POST initialize` 時 generate `Mcp-Session-Id` header 回 client
- `GET /mcp` 帶 session-id 開**真**的 SSE stream，接 server-initiated event
- 後續 `POST /mcp` 帶 session-id，重用 server + transport 實例
- Session 要 persist（Cloudflare Workers stateless 執行環境 → KV / Durable Objects / 或記憶體 + lazy revive）
- 超時 / GC 策略

要動的點（待 discuss 收斂）：

- `nuxt.config.ts` `nitro.alias` 是否仍把 `cloudflareProvider` 替換成 `nodeProvider`，還是改回 cloudflare（因為 cloudflare provider 用的 `agents/mcp` 透過我們自訂 `mcp-agents-compat.ts` shim，需要重新評估）
- `server/mcp/index.ts` middleware 要不要跟 session 互動（auth 建立在 session 建立時 or 每個 request？）
- session state 存哪：KV（跨 Worker instance 分享，但 latency 高）還是 globalThis cache（單 instance，fit-for-stateless-Workers）
- Token-to-session 綁定關係（一個 bearer token 能開幾個 session？）

### 方向 B：GET /mcp 快速回 405（fallback）

若方向 A 阻力太大（upstream 限制 / Workers runtime 不適合 long-lived SSE），改走：

- 偵測 `GET /mcp` + `Accept: text/event-stream` 時快速回 `405 Method Not Allowed`
- 讓 Claude 知道「這 server 不支援 SSE channel」，期待它 fallback 成「每個 tool call 都是獨立 POST / direct response」
- 問題：Claude 可能不接受這 fallback（MCP spec 2025-06-18 要求支援 SSE）；要實測

### 方向 C：MCP protocol version downgrade

- 改 `initialize` 回應的 `protocolVersion` 為 `2024-11-05`（舊版 JSON-RPC-only，無 SSE 要求）
- 若 Claude 尊重 server 宣告版本，會跳過 SSE handshake
- 但 Claude 可能依自己版本決定行為，不看 server protocol declaration

## Non-Goals

- 不改 `rehydrateMcpRequestBody`（前置 change 已處理且 working）
- 不改 middleware auth / rate-limit / role-gate 語義
- 不升級 `@nuxtjs/mcp-toolkit` major version（若需要，獨立 change 處理）
- 不處理 ChatGPT Remote MCP connector 差異（聚焦 Claude.ai；ChatGPT 先 observe，有 symptom 再開 change）

## Capabilities

### New Capabilities

_(none — 修復既有 `mcp-knowledge-tools` 的 Streamable HTTP 協議相容性)_

### Modified Capabilities

- `mcp-knowledge-tools`：MCP handler MUST 完整支援 Streamable HTTP session 流程（`Mcp-Session-Id` header、GET /mcp SSE channel、跨 request session reuse），避免 Claude.ai Remote MCP integration 因 SSE 連線失敗觸發 re-initialize 死循環

## Impact

- **Code（待 discuss）**: `server/mcp/index.ts`、`server/utils/mcp-agents-compat.ts`、`nuxt.config.ts`（alias 配置）、可能新增 session store util
- **Runtime**: Cloudflare Workers 是 stateless 執行環境，SSE long-lived 連線本來就不適合（30 秒 CPU 上限）。可能要 Durable Objects 或設計 per-request SSE heartbeat
- **External**: Claude.ai / ChatGPT / 其他 Remote MCP client 受益
- **Risk tier**: Tier 2-3（動 MCP protocol + auth path，要 full spec review）
- **前置依賴**: `fix-mcp-transport-body-consumed`（已 archive）

## Affected Entity Matrix

_(N/A — 不觸動 DB entity / enum / shared type。唯一新增的可能是 session store，若放 KV 則是 KV binding 的 value shape，discuss 階段收斂)_

## User Journeys

**No user-facing journey (backend-only)**

理由：純 MCP 協議層修復，沒有 UI。Journey 驗收由 Claude.ai（主）+ ChatGPT Remote MCP（副）兩個外部 integration 完成 tool call 作為 E2E 證據。

## Implementation Risk Plan

- **Truth layer / invariants**: MCP Streamable HTTP spec（2025-06-18）+ `@nuxtjs/mcp-toolkit` session 實作語意。Session 作為 auth scope / rate-limit token 的承載物，語意不能漂離 `mcpAuth` context
- **Review tier**: Tier 2-3（動 MCP protocol layer + auth lifecycle）
- **Contract / failure paths**:
  - 無 session-id 時第一次 request（預期行為：server 發新 session-id）
  - 無效 / 過期 session-id（預期：401 或 new session）
  - GET /mcp 帶不匹配 session-id（預期：404 或 410）
  - Worker cold start / eviction 後 session 還原（若用 memory cache 要 graceful）
  - Cloudflare Worker CPU 限制下 SSE 的 keepalive / 重連策略
- **Test plan**:
  - Unit：session-id generation、parse、lookup
  - Integration：完整 handshake flow（initialize → SSE GET → POST tools/list → POST tools/call）
  - Manual：Claude.ai / ChatGPT 實測 `AskKnowledge` + `ListCategories` 回真實結果
  - wrangler tail observe：多次 reconnect 後 POST 穩定 200、GET /mcp 不再 hung
- **Artifact sync**:
  - `openspec/specs/mcp-knowledge-tools/spec.md` 更新 session 相關 requirement
  - `docs/solutions/mcp-streamable-http-session.md` 沉澱 root cause + 解法
  - `docs/tech-debt.md` 若有 workaround 留下，登記 TD entry
  - `HANDOFF.md` 移除本 change 條目（接手完成）

## 起點：`/spectra-discuss`

建議先走 `/spectra-discuss fix-mcp-streamable-http-session` 收斂：

1. 方向 A vs B vs C 的 trade-off 選擇
2. Cloudflare Workers 的 SSE / session 實作可行性（是否要 Durable Objects？）
3. 與 `fix-mcp-transport-body-consumed` 的 rehydrate helper 如何並存 / 可否移除
4. Local dev 環境的 session 模擬
