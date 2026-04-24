---
category: mcp
tags:
  - cloudflare-workers
  - mcp-toolkit
  - streamable-http
  - transport
  - sse
date: 2026-04-24
---

# MCP Streamable HTTP stateless mode: reject GET with 405

## Problem

After `fix-mcp-transport-body-consumed`（archived `v0.34.5`）修好 `POST /mcp initialize` 的 body consumption 問題，Claude.ai Remote MCP integration 首次 handshake 已能成功（`initialize → 200`、`notifications/initialized → 202`、`tools/list → 200`）。但 UI 仍顯示「Error occurred during tool execution」/「Authorization with the MCP server failed」。

`wrangler tail` 顯示死循環：

```text
POST /mcp initialize               200
POST /mcp notifications/initialized 202
POST /mcp tools/list               200
POST /mcp initialize               400   ← Claude re-initialize
GET  /mcp                           Worker hung 30s (runtime cancel)
POST /mcp initialize               400
...
```

Root cause：`server/utils/mcp-agents-compat.ts` shim 的 `createMcpHandler` 沒有對 `GET /mcp` 做特殊處理，讓 `WebStandardStreamableHTTPServerTransport.handleRequest(GET)` 掛著等 server-initiated SSE event。Stateless transport 沒有 push 來源，Cloudflare Worker 30 秒 CPU 上限到期自動 cancel（`"code had hung and would never generate a response"`）。Claude.ai 端看 SSE 連線斷，觸發 retry → 死循環。

## What didn't work

1. **方向 A（拒絕）：真 session + SSE（Durable Objects）**
   - 過度設計：knowledge tools 本質 stateless，無跨 request state 需求
   - Workers 契合度差：純 Worker 不支援 long-lived connection（30s CPU 上限），要上 SSE 需 Durable Objects — 新 binding、新 class、deploy pipeline 複雜化
   - 違反 Cloudflare 官方推薦（stateless 才是 Workers 預設路徑）
   - 維護成本高：session store / lifecycle / TTL / GC / auth 綁定全都要做
2. **方向 C（拒絕）：protocol downgrade 到 2024-11-05**
   - `2024-11-05` 是 deprecated HTTP+SSE 舊 transport，不是 JSON-only 輕量版；路徑更重（要 GET SSE → `endpoint` event → POST）
   - Anthropic beta header 已升級到 `mcp-client-2025-11-20`，舊版 `mcp-client-2025-04-04` 已 deprecated
   - Downgrade 不解決 GET hang，反而讓 client 期待 SSE

## Solution

**方向 B：shim 對 `GET /mcp` / `DELETE /mcp` 直接回 `405`，POST 路徑強制 `enableJsonResponse: true`。**

修改 `server/utils/mcp-agents-compat.ts` `createMcpHandler`：

```ts
// GET / DELETE 立即 405（MCP spec 2025-11-25 第一類合規回應）
if (request.method === 'GET' || request.method === 'DELETE') {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message:
          'Method Not Allowed. This MCP server uses stateless POST-only transport per MCP spec 2025-11-25.',
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        Allow: 'POST',
      },
    },
  )
}

// POST 路徑：強制 JSON response 而非 SSE stream
const transport = new WebStandardStreamableHTTPServerTransport({
  enableJsonResponse: options.enableJsonResponse ?? true,
  sessionIdGenerator: undefined,
})
```

Key points：

- **MCP spec 2025-11-25 明文允許 405**：「The server MUST either return `Content-Type: text/event-stream` in response to this HTTP GET, or else return HTTP 405 Method Not Allowed, indicating that the server does not offer an SSE stream at this endpoint.」（[modelcontextprotocol.io/specification/2025-11-25/basic/transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)）
- **Cloudflare 官方推薦 stateless**：「For most use cases, a stateless implementation requires no Durable Objects—just a Worker with `createMcpHandler` handling Streamable HTTP transport.」
- **`enableJsonResponse: true`** 讓 `WebStandardStreamableHTTPServerTransport` 每個 POST 回完整 JSON-RPC payload（或 notification 回 `202`），不會開 SSE mini-stream 耗 CPU 預算
- **`@nuxtjs/mcp-toolkit@0.14.0` 的 node provider 在 `sessionsEnabled=false` 時本來就回 405**（`dist/runtime/server/mcp/providers/node.js:61-64`）—shim 繞過 provider 時漏了這塊，這次補回等於對齊 toolkit 內建行為
- **不動 auth / middleware**：shim 只改 GET/DELETE 分支 + POST transport options；`mcpAuth` / rate-limit / role-gate middleware 仍在 `defineMcpHandler` 的 `middleware` 階段執行，token-scoped 語義不變
- **`NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` flag 保留**：為未來真要上 Durable Objects + server-initiated push（prompt / elicitation / sampling）時的升級開關，但本 change 不 wire up

## Prevention

- **升級路徑保留但不啟用**：`NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` runtime config 不移除，未來若真有 prompt / elicitation / sampling 需求再另開 change 走 `McpAgent` + Durable Objects
- **Unit test**：`test/unit/mcp-agents-compat.spec.ts` 鎖住 GET/DELETE 405 回應 + POST 建 transport 時帶 `enableJsonResponse: true`
- **Integration test**：`test/integration/mcp-streamable-http.spec.ts` 跑完整 handshake（`initialize` → `notifications/initialized` → `tools/list` → `tools/call`）+ 連續 3 次 tool call 不回歸
- **Monitor signals**：`wrangler tail --format pretty` 後 MCP-layer 改動，確認 `GET /mcp` 回 `405` 而非 `"code had hung"`；POST 全程 `200/202`
- **Fallback plan**：若 Claude.ai 對 `405` 仍有異常行為（違反 spec 不接受），觀察 Claude UI + tail log，另開 change `upgrade-mcp-to-durable-objects` 走方向 A（Tier 3 重工）

## References

- `openspec/changes/fix-mcp-streamable-http-session/` — the fix change（本解法實作 + decision context）
- `openspec/specs/mcp-knowledge-tools/spec.md` — ADDED requirements：
  - MCP handler rejects GET and DELETE with 405
  - MCP handler POST path enforces JSON response over SSE
  - Stateless MCP handler preserves existing auth and rate-limit semantics
- MCP spec 2025-11-25 Streamable HTTP transport：[modelcontextprotocol.io/specification/2025-11-25/basic/transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- Cloudflare stateless MCP guidance：[developers.cloudflare.com/agents/model-context-protocol/transport](https://developers.cloudflare.com/agents/model-context-protocol/transport/)
- `docs/solutions/mcp-body-stream-consumption.md` — 前置 change（body consumption fix），本解法不動其行為
- AWS Q CLI 不接受 405 的 client bug 範例：[aws/amazon-q-developer-cli#3182](https://github.com/aws/amazon-q-developer-cli/issues/3182)
