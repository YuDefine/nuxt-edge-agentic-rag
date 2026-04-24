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

**`/spectra-discuss` 收斂結果（2026-04-24）：採用方向 B，A/C 拒絕。** 完整決策依據見 `design.md`。

### 方向 B（採用）：shim 加 `GET /mcp → 405` + `enableJsonResponse: true`

- `server/utils/mcp-agents-compat.ts` `createMcpHandler`：
  - `GET /mcp` 與 `DELETE /mcp` → 立即回 `405 Method Not Allowed` + `Allow: POST` header + JSON-RPC error body
  - `POST /mcp` 路徑的 `WebStandardStreamableHTTPServerTransport` 加 `enableJsonResponse: true`，強制 JSON response 而非 SSE mini-stream
- 不動 `nuxt.config.ts` `nitro.alias`、不動 `rehydrateMcpRequestBody`、不 wire up `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION`

**依據**：MCP spec 2025-11-25 明文把 `405` 列為 GET `/mcp` 的第一類合規回應；Cloudflare 官方推薦 stateless 為 Workers 預設路徑；knowledge tools（AskKnowledge / ListCategories / Search / GetDocumentChunk）本質 stateless，無 session / server-initiated push 需求。

### 方向 A（拒絕）：真 session + SSE（Durable Objects）

- 過度設計：knowledge tools 無跨 request state 需求
- Workers 契合度差：純 Worker 不支援 long-lived connection，要上需 Durable Objects（新 binding / 新 class / deploy pipeline 複雜化）
- 違反 Cloudflare 官方推薦
- 升級路徑保留：`NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` flag 不移除；未來若真有 prompt / elicitation / sampling（真正需要 server push 的功能）再另開 change 用 `McpAgent` + DO

### 方向 C（拒絕）：protocol downgrade 到 2024-11-05

- `2024-11-05` 是 deprecated HTTP+SSE **舊** transport，不是 JSON-only 輕量版；路徑更重（要 GET SSE → `endpoint` event → POST）
- Anthropic beta header 已升級到 `mcp-client-2025-11-20`，舊版 `mcp-client-2025-04-04` 已 deprecated
- Downgrade 不解決 GET hang，反而讓 client 期待 SSE

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

- **Code**: 只動 `server/utils/mcp-agents-compat.ts`（shim 的 `createMcpHandler` 加 GET/DELETE → 405 分支 + `enableJsonResponse: true`）。不動 `server/mcp/index.ts`、`nuxt.config.ts`、middleware
- **Runtime**: Cloudflare Workers stateless 路徑，無 long-lived connection；POST 走 JSON response，避開 30s CPU 限制
- **External**: Claude.ai / ChatGPT / 其他 Remote MCP client 受益
- **Risk tier**: Tier 2（動 MCP protocol layer 入口但 session-less，不動 auth / DB / migration）
- **前置依賴**: `fix-mcp-transport-body-consumed`（已 archive，rehydrate helper 本 change 不動）

## Affected Entity Matrix

_(N/A — 不觸動 DB entity / enum / shared type。B 方向不引入 session store，無 KV / DO binding 改動。)_

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

## 起點：`/spectra-apply`

Discuss 已收斂（2026-04-24），設計細節在 `design.md`，tasks 在 `tasks.md`。可直接走 `/spectra-apply fix-mcp-streamable-http-session` 進 phase 3 實作。
