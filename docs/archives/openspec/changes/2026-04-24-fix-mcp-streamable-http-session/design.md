# Design: fix-mcp-streamable-http-session

## Context

前置 change `fix-mcp-transport-body-consumed`（archived `v0.34.5`）修好 `POST /mcp initialize` body parsing，首次 handshake 成功（`initialize → 200`、`notifications/initialized → 202`、`tools/list → 200`）。但 `wrangler tail` 顯示 Claude.ai 接著發 `GET /mcp`，觸發死循環：

```
POST /mcp initialize           200
POST /mcp notifications/initialized 202
POST /mcp tools/list           200
POST /mcp initialize           400   ← Claude 又 re-initialize
GET  /mcp                      Worker hung 30s (runtime cancel)
POST /mcp initialize           400
...
```

Root cause 不是 session 缺失，而是 **shim `server/utils/mcp-agents-compat.ts:62-85` 的 `createMcpHandler` 對 `GET /mcp` 沒回應，讓 `WebStandardStreamableHTTPServerTransport.handleRequest(GET)` 掛著等 server-initiated event，Cloudflare Worker 30 秒 CPU 上限到期自動 cancel**。Claude 端看 SSE 斷線觸發 retry，進入循環。

Discuss 階段透過 `/spectra-discuss` + 上網查文檔與社群，收斂到以下決策。

## Decision

**採用方向 B：shim 直接對 `GET /mcp` 回 `405 Method Not Allowed`，POST 路徑加 `enableJsonResponse: true` 強制 JSON response 而非 SSE stream。**

方向 A（真 session + SSE）與方向 C（protocol downgrade 到 2024-11-05）**拒絕採用**，理由見 Alternatives。

### 依據

1. **MCP spec 2025-11-25 明文允許 405 為第一類合規回應**

   > "The server **MUST** either return `Content-Type: text/event-stream` in response to this HTTP GET, or else return **HTTP 405 Method Not Allowed**, indicating that the server does not offer an SSE stream at this endpoint."

   來源：[modelcontextprotocol.io/specification/2025-11-25/basic/transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

2. **Cloudflare 官方推薦 stateless 為 Workers 預設路徑**

   > "For most use cases, a stateless implementation requires no Durable Objects—just a Worker with `createMcpHandler` handling Streamable HTTP transport."

   來源：[developers.cloudflare.com/agents/model-context-protocol/transport](https://developers.cloudflare.com/agents/model-context-protocol/transport/)

3. **Knowledge tools 本質 stateless**：`AskKnowledge` / `ListCategories` / `Search` / `GetDocumentChunk` 每次 tool call 皆為獨立 request-response，無跨 request state 或 server-initiated push 需求。

4. **`@nuxtjs/mcp-toolkit@0.14.0` 的 node provider 在 `sessionsEnabled=false` 時本來就回 405**（`dist/runtime/server/mcp/providers/node.js:61-64`）—只是 shim 繞過 provider 自建 transport 時漏了此邏輯。補回等於對齊 toolkit 內建行為。

## Implementation

### 改動點：`server/utils/mcp-agents-compat.ts` `createMcpHandler`

```ts
export function createMcpHandler(server: McpConnectableServer, options: McpHandlerOptions = {}) {
  return async (request: Request, env?: CloudflareEnv): Promise<Response> => {
    const route = options.route ?? '/mcp'
    if (route) {
      const url = new URL(request.url)
      if (url.pathname !== route) {
        return new Response('Not Found', { status: 404 })
      }
    }

    // 新增：GET /mcp → 405（MCP spec 2025-11-25 第一類合規回應）
    // DELETE 也不支援（本 server 不做 client-initiated session termination）
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

    if (server.transport !== undefined) {
      throw new Error('Server is already connected to a transport')
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true, // 新增：強制 JSON response，不開 SSE mini-stream
      sessionIdGenerator: undefined, // 保持 stateless
    })

    installEnumerableSafeEnv(env)
    await server.connect(transport)
    return transport.handleRequest(request)
  }
}
```

### 不改動項

- **`nuxt.config.ts` `nitro.alias`**：保持 `agents/mcp → mcp-agents-compat.ts` 自訂 shim。不切回 cloudflare provider、不改 node provider alias。shim 已涵蓋我們需要的 stateless 行為，且整合 `mcpAuth` context 與 middleware auth 的工作已跑過實測。
- **`NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` feature flag**：保留為 runtime config，但本 change 不 wire up。保留給未來真要上 Durable Objects 時的開關。
- **`rehydrateMcpRequestBody` helper**：前置 change 已 ship 且通過 wrangler tail 實測，本 change 不動。
- **Middleware（`server/utils/mcp-middleware.ts`、`mcp-auth.ts`、`mcp-rate-limit.ts`、`mcp-role-gate.ts`）**：Session-less path 下與既有語義一致，每個 POST request 自帶 `Authorization: Bearer <token>`，auth / rate-limit 仍以 token 為窗口。

## Contracts

| Method | Path                           | Response                                    | Notes                                                           |
| ------ | ------------------------------ | ------------------------------------------- | --------------------------------------------------------------- |
| POST   | `/mcp`                         | `200` + `Content-Type: application/json`    | JSON-RPC response（`initialize` / `tools/list` / `tools/call`） |
| POST   | `/mcp` (notification/response) | `202 Accepted`（no body）                   | transport 內部處理                                              |
| GET    | `/mcp`                         | `405` + `Allow: POST` + JSON-RPC error body | **新**；不再 hang                                               |
| DELETE | `/mcp`                         | `405` + `Allow: POST` + JSON-RPC error body | **新**；無 session 可終止                                       |

### Failure paths

- **Client 發 GET /mcp**：立即 `405`。Claude 接到後按 spec 應走 POST-only 模式。
- **Client 不接受 405（違反 spec）**：已知 AWS Q CLI 有此 bug（[aws/amazon-q-developer-cli#3182](https://github.com/aws/amazon-q-developer-cli/issues/3182)）。若 Claude.ai 同樣不接受 → 進入 fallback 備案（見下節），另開 change 處理。
- **Client 發 POST 但 body 不完整**：`WebStandardStreamableHTTPServerTransport.handleRequest` 回 `400`；前置 change 的 `rehydrateMcpRequestBody` 仍在保護。
- **POST 超出 Workers 30s CPU**：tool call（如 AskKnowledge 走 AI Gateway）可能逼近上限。Knowledge tool 應自律（current 實作中），非本 change scope。

## Test Plan

### Unit（Vitest）

- `test/unit/mcp-agents-compat.spec.ts`（新或擴充）：
  - `GET /mcp` → `405`，`Content-Type: application/json`，`Allow: POST` header
  - `GET /unrelated` → `404`（route guard 生效）
  - `DELETE /mcp` → `405`
  - `POST /mcp` 帶合法 initialize body → `200` + JSON response（mock transport）
  - `POST /mcp` 帶非法 body → 400（透過 transport 既有路徑）

### Integration（Vitest + fetch against Nitro dev server）

- `test/integration/mcp-streamable-http.spec.ts`（新）：
  - 完整 handshake：`POST initialize` → `200` → `POST notifications/initialized` → `202` → `POST tools/list` → `200`
  - `GET /mcp` 立即 `405`，response `<1s`（非 timeout）
  - `POST tools/call { name: ListCategories }` → `200` + JSON 含 categories
  - 連續 3 次 tool call 不觸發 re-initialize 循環

### Manual（production 實測）

- wrangler tail 觀察：`GET /mcp` 立即 `405`，POST 全程 `200/202`
- Claude.ai 連續 `AskKnowledge` 3 次不同 query，每次回真實答案 + citations
- Claude.ai `ListCategories` 回真實 category 清單
- ChatGPT Remote MCP（若有設定）相同行為

## Alternatives（被拒絕）

### 方向 A：真 session + SSE（Durable Objects）

**拒絕**。

- **過度設計**：knowledge tools 無跨 request state 需求，不需要 session ID、不需要 server push、不需要 SSE stream
- **Workers 契合度差**：純 Worker 不支援 long-lived connection（30s CPU 上限），真要上需 Durable Objects — 新 binding、新 class、deploy pipeline 複雜化
- **違反 Cloudflare 官方推薦**：stateless 是官方 Workers 推薦路徑，DO 是「持久狀態需求明確」時才上
- **維護成本高**：session store、lifecycle、TTL、GC、auth 綁定、cold-start revive 全部要做
- **升級路徑仍保留**：本 change 不移除 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` flag；未來若有 prompt / elicitation / sampling 需求（這些才真正需要 server-initiated push），再另開 change 用 `McpAgent` + DO 重寫 MCP layer

### 方向 C：Protocol downgrade 到 2024-11-05

**拒絕**。

- **2024-11-05 是 deprecated HTTP+SSE 舊 transport**，不是 JSON-only 輕量版
- 舊 transport 路徑更重：要 server 先 `GET` → 開 SSE → 發 `endpoint` event → client 才能 POST
- **Downgrade 等於走到更糟的地方**，不解決 GET hang，反而讓 client 期待 SSE
- **Anthropic beta header 已升級**：`mcp-client-2025-11-20` 是現行，`mcp-client-2025-04-04` 已 deprecated — 強行 downgrade 只會讓 Claude 忽略 server 宣告或走不相容路徑

## Fallback Plan

若 deploy 後 wrangler tail 觀察到 Claude.ai 對 `405` 仍有異常行為（例如不接受 405、視為網路錯誤 retry），按序處理：

1. **確認 405 response 完整度**：含 `Allow: POST` header + JSON-RPC error body（spec 建議格式）
2. **觀察 Claude 具體錯誤**：tail log + Claude UI 錯誤訊息定位問題
3. **升級到方向 A**：另開 change `upgrade-mcp-to-durable-objects`，用 `@agents/mcp` 的 `McpAgent` + WorkerTransport + Durable Objects 重寫 MCP layer（Tier 3 重工）
4. **同時向 Anthropic 回報 MCP client bug**：若 Claude 違反 spec 不接受 405，是 Anthropic 端 bug

備案不在本 change scope；本 change 交付 B 方向，fallback 成立才另開 change。

## Post-deploy Observation (2026-04-24 Asia/Taipei, v0.37.0)

Deploy 後實測 Claude.ai Remote MCP，結果混合：

**本 change 的修正項目 — 確認生效：**

- `GET /mcp` → `405 Allow: POST`，duration ~390ms（30s hang 消失，Cloudflare runtime 不再 cancel）
- 首次 handshake 全綠：`POST initialize 200 → notifications/initialized 202 → tools/list 200`
- Claude.ai UI 顯示 "Loaded 4 Nuxt Edge Agentic RAG tools"，tool 清單正確

**Fallback Plan 觸發條件成立 — Claude.ai 仍不接受純 stateless：**

- 使用者按 `AskKnowledge` / `SearchKnowledge` / `ListCategories`，UI 一律顯示 "Error occurred during tool execution"
- `wrangler tail` 中**完全沒有** `tools/call` method log
- 使用者按 tool 後的實際 pattern：`POST initialize 400` → `GET /mcp 405` → 每 3 秒循環，tools/call 從未送達
- Claude 顯然將 `GET 405` 視為「stream 不可用 → 必須重建 session」，每次 tool call 前自發 re-initialize，但第二次 initialize 被 MCP SDK 判為 invalid（wrangler tail 只有 status 400 無 error body；推測為 Zod JSON-RPC schema parse fail 或 `Server already initialized` 類 guard，具體 error code 留到 fallback change 的 `/spectra-discuss` 階段 spike 驗證）→ 400 → 放棄 tool call

因此本 change 交付的 B 方向**部分成功**：

- 解決了 30s Worker hang 造成的 runtime cancel（GET 路徑）
- **未解決**使用者原始痛點（tool call 成功率 = 0%）

**已知限制 → fallback 採取行動：**

符合 `tasks.md 6.4` 與本 design Fallback Plan #3 的條件：

- 登記 **TD-030**（`docs/tech-debt.md`），`high` priority，open
- 開新 change `upgrade-mcp-to-durable-objects` 走方向 A（Durable Objects + SSE，Tier 3 重工）
- `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` flag 保留作為 DO path 漸進啟用開關
- 本 change archive 時保留 GET 405 + `enableJsonResponse: true` — 它不是回歸（原本就 30s hang），而是 forward progress 的一部分
- tasks.md 5.2–5.5 / 6.1 / 6.2 不勾，6.3 勾（rehydrate regression 仍綠），6.4 按其定義不勾（405 異常反應成立）

## Artifact Sync

本 change archive 時應同步：

- `openspec/specs/mcp-knowledge-tools/spec.md` ← delta spec 應用（405 requirement + enableJsonResponse requirement）
- `docs/solutions/mcp-streamable-http-405-stateless.md`（新）← 沉澱 root cause（shim 繞過 provider 漏 405）+ 解法 + 與方向 A 的 trade-off
- `HANDOFF.md` ← 移除 `fix-mcp-streamable-http-session` 條目
- `docs/tech-debt.md` ← 不新增 TD（本 change 無 workaround 遺留）

## Review Tier

**Tier 2**（動 MCP protocol layer 入口，但 session-less、不動 auth / DB）。

- Code review 重點：shim 的 405 分支（method 判定 + response format + Allow header）、`enableJsonResponse: true` 的副作用（確認 transport 不降回 SSE）
- 無 migration、無 schema 改動、無 RLS 影響
