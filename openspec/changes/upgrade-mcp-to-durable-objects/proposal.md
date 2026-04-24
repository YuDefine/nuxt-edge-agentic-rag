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

## Open Questions（待 `/spectra-discuss` 收斂）

- DO binding name 與 migration tag（`MCP_SESSION` vs 別的）
- Session TTL 值（15 min? 60 min? 跟 rate-limit 窗口對齊？）
- Feature flag `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` 啟用順序（staging 先 / production 同時 / canary）
- Transport 選擇：`agents/mcp` `McpAgent` 是否在 DO context 規避 `ownKeys` error？若否，自寫 DO-backed transport 的介面邊界
- ChatGPT Remote MCP 是否有類似 Claude 的 re-init 行為（需先以 Claude 收斂再驗 ChatGPT）
- 第二次 POST initialize 400 的具體 error code（Zod parse vs `Server already initialized` vs 其他）— discuss 階段補 production tail debug log 或本地重現

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
- **Test plan**:
  - Unit：DO class 的 session lifecycle（create / validate / expire / cleanup）
  - Integration：選定 transport 的 handshake + tool call 流程（可在 test 中 stub DO）
  - E2E：production wrangler tail 實測 Claude.ai 連續 3 次 `AskKnowledge` 穩定、無 re-init 循環
  - Regression：前置 change 的 `mcp-agents-compat.spec.ts` + `mcp-streamable-http.spec.ts` 在 stateless fallback 分支仍綠
  - **Spike gate**：進 apply 前 MUST 有「`agents/mcp` `McpAgent` 在 DO context 跑 `tools/call` 是否 ownKeys error」的 PoC spike 結論
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
