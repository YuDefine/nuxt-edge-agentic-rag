## Context

前置 change `fix-mcp-streamable-http-session`（v0.37.0）實測後，MCP stateless 路徑雖符合 MCP spec 2025-11-25（`GET /mcp → 405`），但 Claude.ai 在每次 tool call 前自發 re-initialize，第二次 `POST /mcp initialize` 回 400，`tools/call` 從未抵達 server。TD-030 `high` 登記此 gap。

discuss 階段（2026-04-24）透過 MCP SDK `webStandardStreamableHttp.js` 靜態分析原以為得出兩個關鍵結論：

1. **視角翻轉**（原）：Claude re-init 的真因是「沒拿到 `Mcp-Session-Id`」，而非 400 本身。400 只是 re-init 後的 SDK 防守副作用。
2. **SDK 400 路徑壓縮**（原）：POST initialize 只可能觸發 3 條 400 path（`-32700 Invalid JSON` / `-32700 Invalid JSON-RPC message` / `-32600 Server already initialized`）。

**Phase 1 diag spike（2026-04-24）兩輪實證推翻上述推論**：

- `hasExistingTransport` 恆為 false — toolkit per-request 給 fresh `server`，guard 從未命中
- SDK 實際回傳的 400 是 `-32700 Parse error`，但 `data` 欄位露出真因 = `TypeError: a16.ownKeys is not a function or its return value is not iterable`
- 真正 root cause 是 **Cloudflare env binding proxy 在 `Reflect.ownKeys` 的不相容**；SDK 在 parse path 呼叫 `Reflect.ownKeys(env)`，proxy 不支援該 trap → TypeError → SDK 外層 catch 包成 Parse error
- 這與 `server/utils/mcp-agents-compat.ts:78-85` 註解記錄的 `agents/mcp` `WorkerTransport` `ownKeys` 問題**同家族**；實證 `WebStandardStreamableHTTPServerTransport` **也爆同樣錯誤**
- DO 架構**本身不解決**此問題——把任何 SDK transport 搬進 DO，每次 initialize 仍會觸發 ownKeys TypeError

完整記錄見 [`docs/solutions/mcp-streamable-http-session-durable-objects.md`](../../../docs/solutions/mcp-streamable-http-session-durable-objects.md)。

既有元件現況：

- `server/mcp/index.ts`：`defineMcpHandler({ middleware, ... })`，middleware 負責 auth + rate-limit + rehydrate；tool 定義在 `server/mcp/tools/*.ts`
- `server/utils/mcp-agents-compat.ts`：shim 取代 `@nuxtjs/mcp-toolkit` 的 cloudflare provider（後者走 `agents/mcp` WorkerTransport，production `tools/call` 爆 Cloudflare proxy `ownKeys` error）。shim 固定 `sessionIdGenerator: undefined` + `enableJsonResponse: true`，並在 GET/DELETE 回 405
- `nuxt.config.ts`：feature flag `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` 已預留但未 wire
- `wrangler.jsonc`：目前無 `durable_objects` binding

## Goals / Non-Goals

**Goals:**

- MCP handler 升級為 session-aware：首次 `initialize` 由 server 簽發 `Mcp-Session-Id`，後續 request 驗證並延長 session
- 保留 stateless shim 作為 kill-switch，透過 `features.mcpSession` flag 切換
- Cloudflare Durable Object 承載 per-session state（protocol version、capabilities、last-seen timestamp、可選 SSE stream）
- Phase 1 / Phase 2 兩個 spike gate 驗證關鍵假設（Q6 400 root cause / Q4 `McpAgent` on DO 可行性）再決定最終 transport 實作
- Staging-first + feature flag rollout，production 一週 soak 後降級 stateless fallback 為 kill-switch

**Non-Goals:**

- 不改 MCP 四個 knowledge tool（`askKnowledge` / `searchKnowledge` / `getDocumentChunk` / `listCategories`）對外介面
- 不引入 MCP prompt / elicitation / sampling capability（DO 有 server-initiated push 能力，本 change 聚焦 tool call 穩定性）
- 不升級 `@nuxtjs/mcp-toolkit` major version
- 不在本 change 驗 ChatGPT Remote MCP 差異（Claude.ai 穩定後另起 follow-up）
- 不動 `rehydrateMcpRequestBody`（前置 change 產物，保留）

## Decisions

### Phase 2 Pivot decision required before DO implementation

**2026-04-24 Phase 1 spike 後新增的首要決策**。在做任何 DO code 之前必須決定 Pivot 方向：

| 選項 | 方法                                                                                                                                                                   | 成本 | 風險                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------- |
| A    | 加強 `installEnumerableSafeEnv`：grep SDK dist 找 `a16` 對應的 env access pattern，把那個點也 shim（或深複製 env 成 plain object 傳 SDK）                              | 低   | 下次 SDK 升級可能引入新的 `Reflect.ownKeys` 位置，shim 變脆弱 |
| B    | Fork / monkey-patch SDK：把 SDK 所有 `Reflect.ownKeys` / `Object.keys(env)` 改成 safe iteration                                                                        | 中   | 每次 SDK 升版都要重 diff                                      |
| C    | 自寫 minimal JSON-RPC transport：不用 SDK 的 `WebStandardStreamableHTTPServerTransport`，直接在 DO 內實作 MCP Streamable HTTP（handshake + tool routing + session id） | 高   | 長期維護成本最低；功能 completeness 要逐個手工實作            |

**預設傾向 C**（最徹底解決、可同時建立 DO 架構），但若 Pivot A 的 grep 結果顯示只要改 2-3 個點就能穩，可以先走 A 作為短期修復，Pivot C 留作未來方向。決策記入 `docs/solutions/mcp-streamable-http-session-durable-objects.md`。

下面其他 Decisions 仍成立但**建立在 Pivot 已完成的假設上**。

### 採用獨立 Durable Object class MCPSessionDurableObject 搭配 binding MCP_SESSION

- Class: `MCPSessionDurableObject`（新增於 `server/mcp/durable-object.ts`）
- Wrangler binding name: `MCP_SESSION`；migration tag: `v1`（class 名 `MCPSessionDurableObject`）
- DO id 來源：server 在首次 `initialize` 用 `crypto.randomUUID()` 生成，以 `idFromName(sessionId)` 作 DO stub lookup
- DO 內部狀態（存於 `this.state.storage`）：`{ sessionId, protocolVersion, capabilities, createdAt, lastSeenAt, initializedServer: boolean }`
- 替代方案：共用一個 singleton DO 做 session multiplexing → rejected，per-session DO 更符合 Cloudflare DO 設計哲學（single-instance 一致性）且 GC 簡單

### 預設採用自寫 DO-backed transport

- DO 內部直接 `new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator, enableJsonResponse: true })`
- Per-session `McpServer` 實例在 DO 內 lazy init（只在 DO 首次收 `initialize` 時 `server.connect(transport)`）
- Worker 層收到 `/mcp` request：抽 `Mcp-Session-Id` → 若無則 `crypto.randomUUID()` 生成 → `env.MCP_SESSION.idFromName(sessionId)` → `stub.fetch(request.clone())` 轉給 DO
- 替代方案：`McpAgent` on DO → 由 Phase 2 PoC spike 驗證；若 PoC 通過且維護成本低則換掉自寫路徑
- 理由：`agents/mcp` WorkerTransport 在 shim 註解明示是 Cloudflare env proxy `ownKeys` broken，拖到 DO context 並無結構性理由認為 env access pattern 會變

### Session ID 由 server 在首次 initialize 生成並回傳 Mcp-Session-Id header

- 首次 `initialize` response header 必含 `Mcp-Session-Id: <uuid>`；後續 request 若缺 header → 404 提示「session missing, re-initialize」
- SDK 行為：`sessionIdGenerator` 設為 `() => crypto.randomUUID()` 即可讓 SDK 自動在 response 附 header
- Client 策略：Claude.ai / ChatGPT 均遵循 MCP spec，收到 header 後會在後續 request 攜帶

### Session TTL 30 分鐘 idle 並由 DO alarm 驅動 GC

- `NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS` 預設 `1800000`（30 min）；每次 DO fetch 觸發時更新 `lastSeenAt`
- DO `alarm()` 排程於 `lastSeenAt + TTL`，觸發時清空 storage 並 `this.state.acceptWebSocket(null)`（若有 SSE stream）
- 替代方案：lazy cleanup on next access → rejected，無法回收已無 activity 的 session，長期 storage 佔用
- 替代方案：15 min / 60 min TTL → 30 min 折衷 Claude 使用者思考間隔（5-10 min）與 rate-limit 日窗口（避免 token 續命但 session 失效）

### Phase 1 diag spike：patch shim log 400 response body

- 目的：捕 Claude re-init 後第二次 `POST initialize` 的實際 JSON-RPC error code/message
- 位置：`server/utils/mcp-agents-compat.ts` 在 `transport.handleRequest(request)` 回傳前 clone response（+必要時 clone request body），status ≥ 400 時 `console.log('[MCP-DIAG]', ...)`
- 流程：apply diag patch → `/commit` → deploy → Claude.ai 重現 re-init 循環 → `wrangler tail` 抓 log → 把 `resBody.error.code` / `resBody.error.message` 對照 SDK 400 路徑表記錄到 spike task
- 結束即 revert patch（不留 diagnostic code 在 main）；產出物：spike log 貼進 task note 或 `docs/solutions/mcp-streamable-http-session-durable-objects.md` 草稿
- Decision rule: `-32700 Invalid JSON` → 補 log request body 判斷是否 body 被吃掉；`-32700 Invalid JSON-RPC message` → 看 body schema 差異；`-32600 Server already initialized` → 顛覆靜態推論，需查 `@nuxtjs/mcp-toolkit` 是否跨 request 共享 McpServer

### Phase 2 PoC：評估 McpAgent on DO 取代自寫 transport

- 建立最小 DO class 搭 `McpAgent`，嘗試在 DO 內跑 `tools/call`
- 判準：是否仍觸發 `ownKeys` proxy error；維護成本（toolkit 升級相容性）；code size
- 若 PoC 成功 → 切到 `McpAgent` path，刪自寫 transport；若失敗 → 維持自寫 transport，PoC 結果寫入 `docs/solutions`

### Rollout：staging-first 搭配 feature flag 雙控

1. Staging `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`，production 保持 `false`（走 stateless shim）
2. Staging 用 Claude.ai integration 跑 3 次連續 AskKnowledge，wrangler tail 確認無 re-init 循環、無 400、無 `ownKeys` error
3. Staging soak 3 天（至少涵蓋一次 workday + 一次週末低峰）
4. Production flag flip，production 繼續 wrangler tail 至少 24 小時
5. 一週後，若 production 穩定，將 stateless shim path 降級為「kill-switch only」（flag=false 才走 shim，預設 true）

### Middleware 擴充：rate-limit 仍以 token 為主 session 生命週期綁 token

- `runMcpMiddleware` 目前 key 為 token；本 change **不擴為 `token + sessionId` 複合 key**（避免 rate-limit 語義漂移）
- 但 session lifecycle 綁 token：token revoke 時同時清 session DO（透過 admin UI trigger 或 cron）
- Middleware 內新增一步：若 request 帶 `Mcp-Session-Id` 但 session 已過期 / 被撤銷 → 回 404（不是 401），讓 client 重跑 initialize

### Stateless fallback 保留為 kill-switch

- `features.mcpSession=false` 時走 `server/utils/mcp-agents-compat.ts` 現行 stateless path（shim 的 GET/DELETE 405 行為保留）
- `features.mcpSession=true` 時走 DO path
- 保留至本 change archive 後一個 release cycle；若 DO path 穩定，下一個 change 移除 stateless fallback

## Risks / Trade-offs

- **SDK env proxy 相容性（Phase 1 實證）**：`WebStandardStreamableHTTPServerTransport` 在 Cloudflare Workers 的 env access 會觸發 `Reflect.ownKeys` TypeError；DO 架構不解決此問題。Mitigation = 進 Phase 2 前做 Pivot decision（A/B/C），寫入 `docs/solutions`
- `McpAgent` on DO 仍爆 `ownKeys` → 維持自寫 DO-backed transport；mitigation = Phase 2 PoC 先驗，不賭
- DO cold start 延遲導致首次 handshake > Claude 超時門檻 → 首次 initialize 走 DO 但延遲觀測寫入 tail；若超時用 `enableJsonResponse: true` 保持 response 短路徑（已採用）
- Session TTL 30 min 太短造成 Claude 中途被踢 → env var 可調，apply 階段用 staging 觀察決定最終值；monitoring 看 `lastSeenAt - createdAt` 分佈
- DO 儲存成本（per-session storage）→ alarm GC 清空 storage；每 session metadata < 1KB，單帳號 concurrent session 預估 < 100，成本可忽略
- Feature flag flip 時現有 Claude client 已有 stateless session 快取 → flip 後第一次 request 會因 shim 不回 `Mcp-Session-Id` 與 DO path 行為差異引發 Claude 重跑 initialize；預期可接受（非破壞性）
- Phase 1 spike 要 deploy diag code 到 production → 風險 = log 噪音；mitigation = only log status ≥ 400、完成後立即 revert、patch 連續區段容易整段刪

## Migration Plan

1. Phase 1（diag spike）：patch shim log → deploy → capture 400 body → revert patch → spike log 寫入 task
2. Phase 2（PoC + transport decision）：寫 `McpAgent` on DO PoC + 自寫 transport skeleton → 跑 `tools/call` 對比 → 決定最終實作路徑
3. Phase 3（core implementation）：
   - 新增 `server/mcp/durable-object.ts`（DO class + session state + alarm）
   - `wrangler.jsonc` 新增 `durable_objects.bindings` + migration `v1`
   - `server/mcp/index.ts` 依 `features.mcpSession` flag 切換 DO path vs shim path
   - `nuxt.config.ts` runtime config 加 `NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS`
   - Middleware 改動（session 404 path + token lifecycle 綁定）
4. Phase 4（test + rollout）：
   - DO unit test（session lifecycle、alarm GC）
   - Integration test（stub DO，驗 handshake + tool call 完整流程）
   - Staging flag flip → 3 天 soak → production flag flip
5. Phase 5（cleanup + archive）：
   - 更新 `openspec/specs/mcp-knowledge-tools/spec.md` session-aware requirement
   - 新增 `docs/solutions/mcp-streamable-http-session-durable-objects.md`（整合 Phase 1 + Phase 2 spike 結論）
   - `docs/tech-debt.md` TD-030 標 done
   - 保留 stateless fallback 一個 release cycle 再移除

**Rollback**：任何 phase 失敗 → flag flip 回 stateless path（無需 redeploy），DO binding 留在 wrangler 但 handler 不觸發

## Open Questions

- Phase 1 spike 結果：第二次 POST initialize 400 具體 error code 為何？若為 `-32700 Invalid JSON-RPC message`，request body 是否 conform MCP initialize schema？
- Phase 2 PoC 結果：`McpAgent` on DO 是否規避 `ownKeys`？若規避，自寫 transport 是否仍有維護優勢（如 log / middleware 注入點）？
- Session 撤銷 propagation：token revoke → session cleanup 的 latency 要求（立即 / 最終一致 / cron daily）？
- DO region pinning：Cloudflare DO 可指定 region，預設 auto；是否需要 hint 到主要使用者所在 region 以降低 first-hop latency？
