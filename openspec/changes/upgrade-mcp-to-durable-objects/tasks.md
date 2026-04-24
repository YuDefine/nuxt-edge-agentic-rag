## 1. 基建準備

- [~] 1.1 wrangler.jsonc 加 MCP_SESSION binding（**移至 Task 4.5**；原 task 的 dry-run gate 要等 DO class 存在）
- [x] [P] 1.2 `shared/schemas/knowledge-runtime.ts` 加 `mcp.sessionTtlMs`（預設 `1800000`），`nuxt.config.ts` runtime config 讀取 `NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS`

## 2. Phase 1 Diag Spike

- [x] 2.1 `server/utils/mcp-agents-compat.ts` 在 `transport.handleRequest(request)` 回傳前加 `[MCP-DIAG]` log（method / url / 選定 headers / cloned request body / cloned response body，status ≥ 400 only）（執行 Decision：Phase 1 diag spike：patch shim log 400 response body）
- [x] 2.2 `/commit` → deploy diag patch 到 production → Claude.ai 任一 tool call 重現 re-init 循環 → `wrangler tail` 抓 `[MCP-DIAG]` JSON 至少 5 筆
- [x] 2.3 將 `resBody.error.code` + `resBody.error.message` 對照 SDK 400 路徑 decision rule（`-32700 Invalid JSON` / `-32700 Invalid JSON-RPC message` / `-32600 Server already initialized`），記錄到 `docs/solutions/mcp-streamable-http-session-durable-objects.md` 草稿；revert diag patch 並獨立 `/commit`（diagnostic code 不留 main）

## 3. Phase 2 Pivot Decision（已完成 2026-04-24）

Phase 1 spike 實證真因是 SDK 碰 Cloudflare env proxy `Reflect.ownKeys` TypeError，DO 架構本身不解決（詳見 design.md Phase 2 Pivot decision 段 + `docs/solutions/mcp-streamable-http-session-durable-objects.md`）。

- [~] 3.1 Pivot A 評估（跳過 — 選 C 後不需要；理由：SDK env access pattern 不穩定，shim 易脆）
- [~] 3.2 Pivot B 評估（跳過 — 選 C 後不需要；涵蓋原 Phase 2 PoC：評估 McpAgent on DO 取代自寫 transport — Superseded 區段的相容性疑慮）
- [x] 3.3 Pivot C 評估：SDK `Transport` interface 極簡（`start/send/close + onmessage`），minimum viable surface = `DoJsonRpcTransport` class ~30 行 + DO `fetch()` 橋接 HTTP ↔ JSONRPCMessage；不必實作完整 MCP Streamable HTTP spec（SDK `McpServer`/`Protocol` 處理語義）
- [x] 3.4 Pivot decision log：**選定 Pivot C**（執行 Decision：Phase 2 Pivot decision required before DO implementation）；已寫入 `docs/solutions/mcp-streamable-http-session-durable-objects.md` § Pivot Decision — C 並更新 `design.md` Decisions 段

## 4. Core Implementation（Pivot C 路線 — 自寫 minimal transport）

- [x] 4.1 新增 `server/mcp/do-transport.ts`：`DoJsonRpcTransport` class 符合 SDK `Transport` interface（`start / send / close + onmessage` callback）；`send(msg)` 存入 per-request resolver，由 DO fetch handler 收集；~30 行（對齊 Decision：採用自寫 minimal `DoJsonRpcTransport`（Pivot C 實作））
- [x] 4.2 新增 `server/mcp/durable-object.ts`：`MCPSessionDurableObject` class、`this.state.storage` schema（`sessionId` / `protocolVersion` / `capabilities` / `createdAt` / `lastSeenAt` / `initializedServer`）、`alarm()` handler 在 `lastSeenAt + TTL` 清空 storage（對齊 Decision：Session TTL 30 分鐘 idle 並由 DO alarm 驅動 GC；Requirement: MCP Session Durable Object Binding）
- [x] 4.3 DO 內實作 `fetch()` **session lifecycle only**（scope 縮 — C-path 2026-04-24）：parse request body → 首次 `initialize` 建 session 並發 `Mcp-Session-Id` header（sessionId 由 shim 層 `crypto.randomUUID()` 生成並以 header 傳入，DO 內不另生）→ 後續 non-initialize 續 `lastSeenAt` + 重排 alarm → missing session 回 404 re-init guidance（對齊 Requirement: MCP Session Initialization Issues Mcp-Session-Id / MCP Session Has Idle TTL With Request-Triggered Renewal）。**@followup[TD-041]** lazy init `McpServer` + `server.connect(transport)` + tool dispatch via `DoJsonRpcTransport` 由 `wire-do-tool-dispatch` change 接手；本 change 的 DO 對 non-initialize 回 501 JSON-RPC `-32601` 避免 flag=true 誤 flip 時靜默 degradation
- [x] 4.3.1 DO non-initialize fallback 回 explicit JSON-RPC error（**@followup[TD-041]**）：`server/durable-objects/mcp-session.ts` non-initialize path 回 `{ jsonrpc: '2.0', id, error: { code: -32601, message: 'Tool dispatch via MCP Session Durable Object is not yet implemented...', data: { method, followup: 'TD-041', sessionLifecycle: 'ok', toolDispatch: 'not_implemented' } } }` with HTTP 501；session 仍續命（lastSeenAt / alarm 同步更新）以便 staging 驗 lifecycle，但回應清楚告訴 client「tool dispatch 未 wire」，production flag flip 為 true 時 fail loud 而非 silent ack
- [x] 4.4 改 `server/mcp/index.ts`：依 `features.mcpSession` flag 分支——flag=true 時抽/生成 session id 並 `env.MCP_SESSION.idFromName(sessionId).fetch(request.clone())` 轉交 DO；flag=false 保留現行 stateless shim path（對齊 Decision：Stateless fallback 保留為 kill-switch；Requirement: Feature Flag Controls MCP Session Path）
- [x] 4.5 `wrangler.jsonc` 新增 `durable_objects.bindings` 條目 `{ name: "MCP_SESSION", class_name: "MCPSessionDurableObject" }` + migration tag `v1`，驗證 `wrangler deploy --dry-run` 通過（對齊 Decision：採用獨立 Durable Object class MCPSessionDurableObject 搭配 binding MCP_SESSION；取代原 Task 1.1——該 task 的 dry-run gate 要等 class 存在，故合併到此）
- [x] [P] 4.6 `server/utils/mcp-middleware.ts`：加過期/撤銷 session 回 `404` 路徑（非 401）；token revoke 時同時清 session DO（對齊 Decision：Middleware 擴充：rate-limit 仍以 token 為主 session 生命週期綁 token；Requirement: Stateless MCP Authentication 的 expired session scenario）**@followup[TD-040]** 主動 token-revoke → session 清理需 token→sessionId 索引，本 change 交給 DO idle TTL alarm 自然回收。

## 5. Test Coverage

- [x] [P] 5.1 新增 `test/integration/mcp-session-durable-object.spec.ts`：DO session lifecycle 覆蓋 create / touch `lastSeenAt` / alarm GC / expired 404（Requirement: MCP Session Has Idle TTL With Request-Triggered Renewal）
- [x] [P] 5.2 新增 `test/integration/mcp-session-handshake.spec.ts`：stub DO，驗 handshake flag=true / flag=false 兩路徑皆綠（**tool call full flow** 因 scope 縮至 session lifecycle 後屬於 `wire-do-tool-dispatch` change 範圍，**@followup[TD-041]**；本 spec 聚焦 「哪個 path 被觸發 + sessionId 如何流動」）
- [x] [P] 5.3 確認既有 `test/integration/mcp-agents-compat.spec.ts` + `test/integration/mcp-streamable-http.spec.ts` 在 flag=false 分支仍綠，regression clean

## 6. Rollout（scope 縮 — session lifecycle only，tool dispatch 由 `wire-do-tool-dispatch` 接手）

- [ ] 6.1 Staging 設 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`、`NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS=1800000`，production 保持 flag=false，deploy staging（對齊 Decision：Rollout：staging-first 搭配 feature flag 雙控）
- [ ] 6.2 Staging soak：僅驗 **session lifecycle** — `initialize` 回 `Mcp-Session-Id`、後續 request 續命（但 non-initialize 預期回 501 `-32601` `TD-041` error payload）、閒置 > 30 min alarm GC 清 DO 後再打同 sessionId 回 404；tail 驗無 `ownKeys` error。**Tool call 完整流程**（AskKnowledge 回真實結果）在 `wire-do-tool-dispatch` change 的 rollout 驗
- [ ] 6.3 Production **維持 flag=false**，**@followup[TD-041]** — 直到 `wire-do-tool-dispatch` change archive 後才考慮 flag flip；本 change 僅驗 lifecycle + fallback 保留，不做 production 的 tool dispatch 切換

## 7. Cleanup

- [x] [P] 7.1 `docs/solutions/mcp-streamable-http-session-durable-objects.md` 定稿：整合 Phase 1 diag + Phase 2 PoC 結論、DO state schema、transport 選擇理由、TTL 策略、rollout timeline
- [ ] [P] 7.2 `docs/tech-debt.md` TD-030 `Status: done`，註 `Resolved: 2026-0X-XX by change upgrade-mcp-to-durable-objects`，並附一句 one-liner 描述根因（Claude 缺 `Mcp-Session-Id` 導致 re-init）
- [ ] [P] 7.3 `openspec/specs/mcp-knowledge-tools/spec.md` archive 時由 spectra 自動合併 delta；archive 後人工校對 `@trace` 區塊是否需補新建檔案路徑（`server/mcp/durable-object.ts`）

## 8. 人工檢查

- [ ] 8.1 （**scope 縮 — @followup[TD-041]**）Claude.ai production 連續三次 `AskKnowledge` 顯示正確回答驗證改由 `wire-do-tool-dispatch` change 負責；本 change 僅需 staging tail 觀察到 `initialize 200` + `Mcp-Session-Id` header + 後續 request 的 501 `-32601` JSON-RPC error 符合 TD-041 預期 payload
- [ ] 8.2 `wrangler tail` 24 小時內無 `[MCP-DIAG]` log（確認 diag patch 已 revert）
- [ ] 8.3 `wrangler tail` 無 Cloudflare proxy `ownKeys` error
- [ ] 8.4 Staging + production 的 `features.mcpSession` flag 值符合 rollout 計畫當前階段
- [ ] 8.5 `docs/tech-debt.md` TD-030 狀態為 done，且 `openspec/changes/fix-mcp-streamable-http-session/tasks.md` 的 `@followup[TD-030]` markers 無殘留未解條目
