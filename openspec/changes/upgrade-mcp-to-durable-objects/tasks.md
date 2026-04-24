## 1. 基建準備

- [ ] [P] 1.1 `wrangler.jsonc` 新增 `durable_objects.bindings` 條目 `{ name: "MCP_SESSION", class_name: "MCPSessionDurableObject" }` + migration tag `v1`，驗證 `wrangler deploy --dry-run` 通過（對齊 Decision：採用獨立 Durable Object class MCPSessionDurableObject 搭配 binding MCP_SESSION；Requirement: MCP Session Durable Object Binding）
- [x] [P] 1.2 `shared/schemas/knowledge-runtime.ts` 加 `mcp.sessionTtlMs`（預設 `1800000`），`nuxt.config.ts` runtime config 讀取 `NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS`

## 2. Phase 1 Diag Spike

- [x] 2.1 `server/utils/mcp-agents-compat.ts` 在 `transport.handleRequest(request)` 回傳前加 `[MCP-DIAG]` log（method / url / 選定 headers / cloned request body / cloned response body，status ≥ 400 only）（執行 Decision：Phase 1 diag spike：patch shim log 400 response body）
- [ ] 2.2 `/commit` → deploy diag patch 到 production → Claude.ai 任一 tool call 重現 re-init 循環 → `wrangler tail` 抓 `[MCP-DIAG]` JSON 至少 5 筆
- [ ] 2.3 將 `resBody.error.code` + `resBody.error.message` 對照 SDK 400 路徑 decision rule（`-32700 Invalid JSON` / `-32700 Invalid JSON-RPC message` / `-32600 Server already initialized`），記錄到 `docs/solutions/mcp-streamable-http-session-durable-objects.md` 草稿；revert diag patch 並獨立 `/commit`（diagnostic code 不留 main）

## 3. Phase 2 Transport PoC

- [ ] 3.1 建最小 PoC DO class 搭 `agents/mcp` `McpAgent`，跑一個 dummy `tools/call`，記錄是否仍觸發 Cloudflare proxy `ownKeys` error、cold start 延遲、code size（執行 Decision：Phase 2 PoC：評估 McpAgent on DO 取代自寫 transport）
- [ ] 3.2 根據 PoC 結果決定最終 transport 實作：若 `McpAgent` on DO 規避 `ownKeys` 且維護成本可接受則改用 `McpAgent`，否則維持自寫 DO-backed transport（對齊 Decision：預設採用自寫 DO-backed transport）；決定記入 `docs/solutions` 草稿並更新 `design.md` Decisions 段

## 4. Core Implementation

- [ ] 4.1 新增 `server/mcp/durable-object.ts`：`MCPSessionDurableObject` class、`this.state.storage` schema（`sessionId` / `protocolVersion` / `capabilities` / `createdAt` / `lastSeenAt` / `initializedServer`）、`alarm()` handler 在 `lastSeenAt + TTL` 清空 storage（對齊 Decision：Session TTL 30 分鐘 idle 並由 DO alarm 驅動 GC；Requirement: MCP Session Durable Object Binding）
- [ ] 4.2 DO 內實作 `fetch()`：依 Phase 2 決策建立 transport 實例，首次 `initialize` 用 `crypto.randomUUID()` 生成 session id 並在 response 帶 `Mcp-Session-Id` header（對齊 Decision：Session ID 由 server 在首次 initialize 生成並回傳 Mcp-Session-Id header；Requirement: MCP Session Initialization Issues Mcp-Session-Id；Requirement: MCP Session Has Idle TTL With Request-Triggered Renewal — 實作 request 觸發 lastSeenAt 續命與 alarm 排程）
- [ ] 4.3 改 `server/mcp/index.ts`：依 `features.mcpSession` flag 分支——flag=true 時抽/生成 session id 並 `env.MCP_SESSION.idFromName(sessionId).fetch(request.clone())` 轉交 DO；flag=false 保留現行 stateless shim path（對齊 Decision：Stateless fallback 保留為 kill-switch；Requirement: Feature Flag Controls MCP Session Path）
- [ ] [P] 4.4 `server/utils/mcp-middleware.ts`：加過期/撤銷 session 回 `404` 路徑（非 401）；token revoke 時同時清 session DO（對齊 Decision：Middleware 擴充：rate-limit 仍以 token 為主 session 生命週期綁 token；Requirement: Stateless MCP Authentication 的 expired session scenario）

## 5. Test Coverage

- [ ] [P] 5.1 新增 `test/integration/mcp-session-durable-object.spec.ts`：DO session lifecycle 覆蓋 create / touch `lastSeenAt` / alarm GC / expired 404（Requirement: MCP Session Has Idle TTL With Request-Triggered Renewal）
- [ ] [P] 5.2 新增 `test/integration/mcp-session-handshake.spec.ts`：stub DO，驗 handshake + tool call full flow，flag=true / flag=false 兩路徑皆綠
- [ ] [P] 5.3 確認既有 `test/integration/mcp-agents-compat.spec.ts` + `test/integration/mcp-streamable-http.spec.ts` 在 flag=false 分支仍綠，regression clean

## 6. Rollout

- [ ] 6.1 Staging 設 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`、`NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS=1800000`，production 保持 flag=false，deploy staging（對齊 Decision：Rollout：staging-first 搭配 feature flag 雙控）
- [ ] 6.2 Staging soak 3 天：Claude.ai 連續 3 次 `AskKnowledge` tail 驗無 re-init 循環 / 無 `ownKeys` error / 無 400（至少涵蓋一次 workday + 一次週末低峰）
- [ ] 6.3 Production flag flip 為 true，`wrangler tail` 監控 24 小時；任一異常即 flag flip 回 false 走 stateless fallback（無需 redeploy）

## 7. Cleanup

- [ ] [P] 7.1 `docs/solutions/mcp-streamable-http-session-durable-objects.md` 定稿：整合 Phase 1 diag + Phase 2 PoC 結論、DO state schema、transport 選擇理由、TTL 策略、rollout timeline
- [ ] [P] 7.2 `docs/tech-debt.md` TD-030 `Status: done`，註 `Resolved: 2026-0X-XX by change upgrade-mcp-to-durable-objects`，並附一句 one-liner 描述根因（Claude 缺 `Mcp-Session-Id` 導致 re-init）
- [ ] [P] 7.3 `openspec/specs/mcp-knowledge-tools/spec.md` archive 時由 spectra 自動合併 delta；archive 後人工校對 `@trace` 區塊是否需補新建檔案路徑（`server/mcp/durable-object.ts`）

## 8. 人工檢查

- [ ] 8.1 Claude.ai production 連續三次 `AskKnowledge` 全部顯示正確回答且 wrangler tail 看到 `tools/call` method log（非 `Error occurred during tool execution`）
- [ ] 8.2 `wrangler tail` 24 小時內無 `[MCP-DIAG]` log（確認 diag patch 已 revert）
- [ ] 8.3 `wrangler tail` 無 Cloudflare proxy `ownKeys` error
- [ ] 8.4 Staging + production 的 `features.mcpSession` flag 值符合 rollout 計畫當前階段
- [ ] 8.5 `docs/tech-debt.md` TD-030 狀態為 done，且 `openspec/changes/fix-mcp-streamable-http-session/tasks.md` 的 `@followup[TD-030]` markers 無殘留未解條目
