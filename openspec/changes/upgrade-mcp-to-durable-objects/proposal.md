## Why

前置 change `fix-mcp-streamable-http-session`（deployed as v0.37.0；archive pending 本 change proposal 落地後）實測：

- ✅ 解決 `GET /mcp` Worker 30s hang（MCP spec 2025-11-25 `405` 生效）
- ✅ 首次 handshake 穩定（`initialize 200 → notifications/initialized 202 → tools/list 200`）
- ❌ Claude.ai tool call **仍 100% fail**，UI 顯示 "Error occurred during tool execution"

Root cause（wrangler tail 實測 + TD-030 記錄）：

Claude.ai 在任何 tool call 前會先自發 re-initialize（推測是 session health check）。stateless server 回 `GET 405` 對 Claude 意義是「SSE stream 不可用」，它因此每次 tool call 前都重建 session。但第二次 `POST initialize` 回 **HTTP 400**（wrangler tail 只有 status，沒 error body），**推測**為 MCP SDK transport 的 Zod JSON-RPC schema parse fail 或 `Server already initialized` 類 guard；具體 error code 留到 `/spectra-discuss` 階段 spike 驗證。400 導致 Claude 放棄 tool call，tools/call 從未送達 server。

也就是說：**純 Workers stateless 模式在協議語義上合規（MCP spec 允許 405），但無法滿足 Claude.ai client 的實際行為需求**。前置 change 的 Fallback Plan 已預留此退路；TD-030 `high` priority 登記此 gap。

## What Changes

升級 MCP layer 到 Cloudflare Durable Objects，承載真正的 session state + SSE stream，消除 Claude 的 re-init 循環。**具體 transport 實作（`agents/mcp` `McpAgent` 或自寫 DO-backed transport）待 `/spectra-discuss` + spike 驗證後決定**。

### 候選方向（待 discuss + spike 收斂）

1. **新 Durable Object class**：`MCPSessionDurableObject`（binding name 待定，例如 `MCP_SESSION`），承載：
   - `Mcp-Session-Id` 生成與驗證
   - 跨 request session state（protocol version / capabilities / negotiated options）
   - SSE stream connection（server-initiated event channel）
   - Session TTL / GC（close idle sessions）
2. **MCP handler 重構**：候選以 `agents/mcp` 的 `McpAgent` + `WorkerTransport` 取代 `server/utils/mcp-agents-compat.ts` shim 的 stateless 路徑
   - `GET /mcp` 回 `200 Content-Type: text/event-stream`（DO 承載 long-lived SSE）
   - `POST /mcp` 仍走 JSON response，但 session-bound
   - `DELETE /mcp` 允許 client-initiated session termination
   - **已知 blocker**：`server/utils/mcp-agents-compat.ts` 的 shim 註解明確記錄 `agents/mcp` 的 Worker transport 在 production `tools/call` 遇 Cloudflare proxy `ownKeys` error（shim 存在的理由正是繞開此 bug）。本 change MUST 先 spike 驗證 `McpAgent` 在 DO context 下是否仍受此影響；若仍受影響則改自寫 DO-backed transport（直接組 `WebStandardStreamableHTTPServerTransport` + DO storage），或評估是否值得繼續（見 Risk Plan 的 failure paths）
3. **Feature flag 啟用**：wire up `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION`（前置 change 保留但未用），讓 DO path 可環境切換（例如 staging 先啟用）
4. **Middleware 調整**：`mcpAuth` / rate-limit / role-gate 的 key 從 token-only 擴展為 `token + sessionId`；rate-limit 窗口保持以 token 為主，但 session lifecycle 綁 token
5. **保留 stateless fallback**：`server/utils/mcp-agents-compat.ts` shim 的 GET 405 邏輯保留，作為 bearer-token-less probe 或 DO 失敗時的退路（透過 feature flag 切換）

### 部署/基建

- `wrangler.jsonc` 新增 `durable_objects` binding + migration class
- `nuxt.config.ts` runtime config 加 `NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS`（session GC）
- Deploy pipeline 要跑 DO migration（`wrangler deploy` 會處理）

## Non-Goals

- 不改 `rehydrateMcpRequestBody`（前置 change 已處理，本 change 保留該 helper）
- 不升級 `@nuxtjs/mcp-toolkit` major version（若衝突另開 change）
- 不處理 ChatGPT Remote MCP 差異（先聚焦 Claude.ai，symptom 收斂後再驗 ChatGPT）
- 不引入 MCP prompt / elicitation / sampling 能力（DO 具備 server-initiated push 能力，但本 change 仍聚焦 knowledge tools 4 個方法的穩定性）

## Capabilities

### Modified Capabilities

- `mcp-knowledge-tools`：MCP handler 升級為 session-aware（DO + SSE），確保 Claude.ai / ChatGPT / 其他 Remote MCP client 能穩定多輪 tool call。`Mcp-Session-Id` header 首次由 server initialize response 簽發，後續 request MUST 攜帶；session TTL 可配置，過期自動回收。

## Impact

- **Code**: 新增 `server/mcp/durable-object.ts`（DO class）、改寫 `server/mcp/index.ts`（`defineMcpHandler` → DO-backed wrapper）、`server/utils/mcp-agents-compat.ts`（保留 stateless path 作 flag-gated fallback）
- **Runtime**: Cloudflare Workers + Durable Objects（全新 binding）
- **External**: Claude.ai / ChatGPT / 其他 Remote MCP 受益
- **Risk tier**: **Tier 3**（動 MCP protocol layer + auth lifecycle + 新 Cloudflare binding + deploy pipeline 改動）
- **前置依賴**: `fix-mcp-streamable-http-session`（deployed as v0.37.0；archive pending）+ `fix-mcp-transport-body-consumed`（archived 2026-04-24，deployed as v0.34.5，rehydrate helper 仍保留）

## Affected Entity Matrix

_(本 change 無 DB entity / enum / shared type 改動。新增 Durable Object binding 為基建，不屬於 user-visible entity。)_

## User Journeys

**No user-facing journey (backend-only)**

理由：純 MCP 協議層基建升級，沒有 UI。Journey 驗收由 Claude.ai（主）+ ChatGPT Remote MCP（副）兩個外部 integration 完成 tool call 作為 E2E 證據，跟前置 change 同路徑但要求 **tool call 穩定成功**而非僅首次 handshake 成功。

## Open Questions

### ✅ Discuss-phase 收斂結果（2026-04-24）

- **視角翻轉**：Claude re-init 循環的**真因是「沒拿到持久 `Mcp-Session-Id`」**，不是 400 本身；400 只是 re-init 後 SDK 防守的副作用。讓 Claude 停止 re-init 的充分條件是「首次 `initialize` response 帶 `Mcp-Session-Id`」。DO 的價值因此**不依賴** Q6 最終 error code 結論。
- **SDK 400 路徑靜態分析**（`node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js` `handlePostRequest`）：POST `initialize` 情境下只可能命中 3 條：
  - `line 402` → JSON-RPC `-32700` `Parse error: Invalid JSON`（`req.json()` 失敗）
  - `line 417` → JSON-RPC `-32700` `Parse error: Invalid JSON-RPC message`（Zod schema fail）
  - `line 427` → JSON-RPC `-32600` `Invalid Request: Server already initialized`（guard = `this._initialized && this.sessionId !== undefined`）
- **Q6（第二次 POST initialize 400 具體原因）**：**降級為 Phase 1 diag spike task**。由於現行 shim 傳 `sessionIdGenerator: undefined`（`server/utils/mcp-agents-compat.ts:119`），`this.sessionId` 永遠 undefined，line 427 path 結構上不會命中；幾乎必然是 parse error。spike task 負責捕 response body 確認具體 code，並決定是否需要補 log request body。
- **Q4（transport 選擇）**：**預設走「自寫 DO-backed transport」**（直接在 DO 內實例化 `WebStandardStreamableHTTPServerTransport` + 使用 `this.state.storage` 承載 session state）。理由：`agents/mcp` `WorkerTransport` 在 shim 註解明示 production `tools/call` 爆 `ownKeys` proxy error（`server/utils/mcp-agents-compat.ts:78-85`），其 root cause 是 Cloudflare env binding proxy 被 `Reflect.ownKeys` 掃描；把這個 transport 拖到 DO context 並無充分理由認為 env proxy 訪問模式會變。`McpAgent` 保留為次選，由 Phase 2 PoC spike 驗證（若 PoC 通過，可換掉自寫路徑）。
- **Q1（DO binding name）**：`MCP_SESSION`（binding name）+ migration tag `v1`（class 名 `MCPSessionDurableObject`）。理由：name 短且與 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` flag 呼應。
- **Q2（Session TTL）**：預設 **30 minutes**，每次 request touch 續命（`idle TTL`，非絕對 TTL）。理由：大於 Claude 使用者思考間隔（防誤 GC），小於 rate-limit 日窗口（避免 token 續跑但 session 失效的語義漂移）。實際值寫入 `NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS`，apply 階段可微調。
- **Q3（Rollout）**：Staging-first + feature flag 雙控；**不做 per-request canary**（專案無 traffic-splitting 基建）。順序：staging flag=true → production flag=false（stateless shim path）→ staging soak 3 天 → production flag flip → 一週後 stateless fallback 降級為 kill-switch。
- **Q5（ChatGPT Remote MCP）**：**不在本 change scope 內驗**；Claude.ai 收斂後另起觀察 task，若 ChatGPT 行為不同再開 follow-up change。

### 🔁 Phase 1 spike 實證（2026-04-24）— 推翻原假設

**Round 1 + Round 2 兩次 diag spike 結論**：

- `hasExistingTransport: false` 恆成立 — shim guard `server.transport !== undefined` 從未命中；`server` 不是 singleton，toolkit per-request 給 fresh instance。原 Q6 假設 + Q4 預設路徑都基於錯誤前提。
- **400 真因**：SDK 回 `-32700 Parse error`，`data` 欄位 = `TypeError: a16.ownKeys is not a function or its return value is not iterable`。
- 這是 **Cloudflare env binding proxy 在 `Reflect.ownKeys` 的相容性問題**；SDK 在 JSON-RPC parse path 呼叫 `Reflect.ownKeys(env)`，proxy 不支援該 trap → SDK 外層 catch 包成 `-32700 Parse error`。
- 與 `server/utils/mcp-agents-compat.ts:78-85` 註解記錄的 `agents/mcp` `WorkerTransport` `ownKeys` 問題**同家族**；實證 `WebStandardStreamableHTTPServerTransport` **也爆同樣錯誤**。
- `installEnumerableSafeEnv` 只在第一次 handshake 有效，第二次以後 SDK 某段繞過 `globalThis.__env__` 直接碰原生 env proxy。

### 🔀 Pivot Required：DO 架構不充分

原 proposal 前提「DO + per-session server 解決 re-init 循環」**被實證推翻**。Re-init 循環不是 session state 問題，是 env proxy 相容性問題。把任何 SDK transport 搬進 DO **不會改變** SDK 碰 env proxy 的事實——每次 initialize 仍會觸發 ownKeys TypeError。

DO 仍可能是終局架構（承載 session state / SSE push），但**必須先修 env proxy 相容問題**。Pivot 選項（進 Phase 2 前評估）：

| 選項 | 方法                                                                                                                          | 成本                                   | 風險                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| A    | 加強 `installEnumerableSafeEnv`：grep SDK dist 找 `a16` 對應 env access pattern，把那個 access point 也 shim                  | 低；不動 SDK                           | 下次 SDK 升級可能又引入新 `Reflect.ownKeys` 位置，shim 變脆弱 |
| B    | Fork / monkey-patch SDK：把 SDK 所有 `Reflect.ownKeys` / `Object.keys(env)` 取用改成 safe iteration                           | 中；要 maintain patch 跟 upstream 同步 | 每次 SDK 升版都要重 diff                                      |
| C    | 自寫 minimal JSON-RPC transport：不用 SDK 的 `WebStandardStreamableHTTPServerTransport`，在 DO 內直接實作 MCP Streamable HTTP | 高；要吃 MCP spec 細節                 | 長期維護成本最低；但 completeness 要逐個手工實作              |

完整 spike 記錄見 [`docs/solutions/mcp-streamable-http-session-durable-objects.md`](../../../docs/solutions/mcp-streamable-http-session-durable-objects.md)。

### ✅ Pivot decision（2026-04-24）— **Pivot C**

使用者確認採 Pivot C。關鍵 surface 評估結果大幅降低實作成本：

- MCP SDK `Transport` interface 極簡（`start / send / close + onmessage`），自寫 shim ~30 行即可
- 不必實作完整 MCP Streamable HTTP spec——request 解析 / handler 派遣 / response 組裝仍由 SDK `McpServer` + `Protocol` 基類處理
- Shim 只做 HTTP request ↔ JSONRPCMessage 橋接，**從未接觸 env proxy**，根除 `Reflect.ownKeys` bug
- 詳細記錄：`docs/solutions/mcp-streamable-http-session-durable-objects.md` § Pivot Decision — C

### 🔄 仍 open（進 Phase 4 apply 後解）

- DO alarm 的 TTL GC 策略具體實作（`alarm()` 驅動 session cleanup vs. lazy cleanup on next access）
- `DoJsonRpcTransport.send` 的 response 收集模式：single-request-resolver vs. event-based queue（影響 streaming 能力；目前不支援 streaming，single response mode 足夠）

## Implementation Risk Plan

- **Truth layer / invariants**: MCP Streamable HTTP spec 2025-11-25（session lifecycle + `Mcp-Session-Id` 語義）+ Cloudflare Durable Objects 一致性模型（single-instance 寫入 + eventual 讀）+（若採用）`agents/mcp` `McpAgent` 合約
- **Review tier**: Tier 3（新 binding、協議層、deploy pipeline）
- **Contract / failure paths**:
  - Session 首次建立：response 必須帶 `Mcp-Session-Id` header
  - Session 驗證失敗（過期 / 不存在）：回 `404` 帶建議重建 session 的訊息
  - DO 不可達 / cold start：透過 retry 與 flag-gated stateless fallback（GET 405 shim）續跑
  - Worker cold start：SSE connection 初次建立延遲需可接受（Claude 超時前完成）
  - Session TTL 到期：close stream + cleanup state，client 收 close event 後 re-init
  - **`agents/mcp` spike 失敗（`ownKeys` error 在 DO context 仍發生）**：退路選項 — (a) 自寫 DO-backed transport 以 `WebStandardStreamableHTTPServerTransport` + DO storage 組合；(b) 若 (a) 成本 > 價值且 Claude bug 有望被 Anthropic 修復，暫停本 change 回到 stateless fallback 並升級 Anthropic bug report 優先級
  - **Phase 1 實證新增風險（2026-04-24）**：`WebStandardStreamableHTTPServerTransport` 也爆 `ownKeys`（原假設只有 `agents/mcp` `WorkerTransport` 爆）。任何 SDK transport 在 Cloudflare Workers 都有風險。**必須先做 Pivot decision（A/B/C）**才能進 Phase 2+；DO 本身不解決此問題
- **Test plan**:
  - Unit：DO class 的 session lifecycle（create / validate / expire / cleanup）
  - Integration：選定 transport 的 handshake + tool call 流程（可在 test 中 stub DO）
  - E2E：production wrangler tail 實測 Claude.ai 連續 3 次 `AskKnowledge` 穩定、無 re-init 循環
  - Regression：前置 change 的 `mcp-agents-compat.spec.ts` + `mcp-streamable-http.spec.ts` 在 stateless fallback 分支仍綠
  - **Phase 1 Spike gate（Q6 diag）**：Phase 1 產出「第二次 POST `initialize` response body JSON」為實際 artifact（spike log + `docs/solutions` 或 inline task note），否則 phase 2 不啟動
  - **Phase 2 Spike gate（Q4 PoC）**：Phase 2 完成後必須做 `McpAgent` on DO 的 PoC 與「自寫 DO-backed transport」二選一的最終 decision log；PoC 失敗或無明顯優勢則沿用自寫 transport（預設路徑）
  - **SDK 400 路徑靜態邊界**：已於 Open Questions 列出 3 條 400 path，phase 1 spike 以此作為 decision rule map（`-32700 Invalid JSON` / `-32700 Invalid JSON-RPC message` / `-32600 Server already initialized`）
- **Artifact sync**:
  - `openspec/specs/mcp-knowledge-tools/spec.md` 更新 session-aware requirement（替換或擴充前置 change 留下的 stateless requirement）
  - `docs/solutions/mcp-streamable-http-session-durable-objects.md`（新）← root cause（stateless 不足） + DO 實作 + trade-off + GC 策略
  - `docs/tech-debt.md` TD-030 標 `done`（或 `in-progress` during apply）
  - `HANDOFF.md` 移除相關條目（若有）

## 起點：`/spectra-propose`

本 proposal 由前置 change post-deploy 觀察觸發自動建立（非人工 discuss 收斂）。進入 spectra workflow 前需：

1. `/spectra-discuss upgrade-mcp-to-durable-objects` 收斂 Open Questions 中的每一項
2. 撰寫 `design.md`（DO class 介面、transport wiring、rollout plan、rollback plan）
3. 撰寫 `specs/mcp-knowledge-tools/spec.md` delta（session-aware requirement）
4. 撰寫 `tasks.md` phase 1–N（含 spike phase）
5. `/spectra-apply` 進實作
