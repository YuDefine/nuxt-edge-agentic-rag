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
- [x] 4.3 DO 內實作 `fetch()` **session lifecycle only**（scope 縮 — C-path 2026-04-24）：parse request body → 首次 `initialize` 建 session 並發 `Mcp-Session-Id` header（sessionId 由 shim 層 `crypto.randomUUID()` 生成並以 header 傳入，DO 內不另生）→ 後續 non-initialize 續 `lastSeenAt` + 重排 alarm → missing session 回 404 re-init guidance（對齊 Requirement: MCP Session Initialization Issues Mcp-Session-Id / MCP Session Has Idle TTL With Request-Triggered Renewal）。lazy init `McpServer` + `server.connect(transport)` + tool dispatch via `DoJsonRpcTransport` 已由 `wire-do-tool-dispatch` change 接手
- [x] 4.3.1 DO non-initialize fallback 回 explicit JSON-RPC error（TD-041 已由 `wire-do-tool-dispatch` 接手）：原 `server/durable-objects/mcp-session.ts` non-initialize path 回 HTTP 501 fail-loud；後續 tool dispatch wire-up 已移除該 fallback
- [x] 4.4 改 `server/mcp/index.ts`：依 `features.mcpSession` flag 分支——flag=true 時抽/生成 session id 並 `env.MCP_SESSION.idFromName(sessionId).fetch(request.clone())` 轉交 DO；flag=false 保留現行 stateless shim path（對齊 Decision：Stateless fallback 保留為 kill-switch；Requirement: Feature Flag Controls MCP Session Path）
- [x] 4.5 `wrangler.jsonc` 新增 `durable_objects.bindings` 條目 `{ name: "MCP_SESSION", class_name: "MCPSessionDurableObject" }` + migration tag `v1`，驗證 `wrangler deploy --dry-run` 通過（對齊 Decision：採用獨立 Durable Object class MCPSessionDurableObject 搭配 binding MCP_SESSION；取代原 Task 1.1——該 task 的 dry-run gate 要等 class 存在，故合併到此）
- [x] [P] 4.6 `server/utils/mcp-middleware.ts`：加過期/撤銷 session 回 `404` 路徑（非 401）；token revoke 時同時清 session DO（對齊 Decision：Middleware 擴充：rate-limit 仍以 token 為主 session 生命週期綁 token；Requirement: Stateless MCP Authentication 的 expired session scenario）**@followup[TD-040]** 主動 token-revoke → session 清理需 token→sessionId 索引，本 change 交給 DO idle TTL alarm 自然回收。

## 5. Test Coverage

- [x] [P] 5.1 新增 `test/integration/mcp-session-durable-object.spec.ts`：DO session lifecycle 覆蓋 create / touch `lastSeenAt` / alarm GC / expired 404（Requirement: MCP Session Has Idle TTL With Request-Triggered Renewal）
- [x] [P] 5.2 新增 `test/integration/mcp-session-handshake.spec.ts`：stub DO，驗 handshake flag=true / flag=false 兩路徑皆綠（**tool call full flow** 因 scope 縮至 session lifecycle 後屬於 `wire-do-tool-dispatch` change 範圍；本 spec 聚焦 「哪個 path 被觸發 + sessionId 如何流動」）
- [x] [P] 5.3 確認既有 `test/integration/mcp-agents-compat.spec.ts` + `test/integration/mcp-streamable-http.spec.ts` 在 flag=false 分支仍綠，regression clean

## 6. Rollout（scope 縮 — session lifecycle only，tool dispatch 由 `wire-do-tool-dispatch` 接手）

- [x] 6.1 Staging 設 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true` + `NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS=1800000` 並 deploy — `wire-do-tool-dispatch` 已於 v0.43.x → v0.45.1 完整實作 + deploy；staging 工作正常（acceptance 12/12 全綠驗證）
- [x] 6.2 Staging soak session lifecycle — `wire-do-tool-dispatch` v0.45.1 staging acceptance 12/12 全綠等價驗證：`initialize` 回 `Mcp-Session-Id` ✓、後續 request 續命 ✓、DELETE 清 storage + cancel alarm + subsequent GET 404 ✓；wrangler tail 無 `ownKeys` error
- [x] 6.3 Production flag rollout — `wire-do-tool-dispatch` v0.46.0 已將 production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` flip 為 `true` 並驗證 worker fetch handler 正常運作（無 ownKeys / TypeError / 5xx）

## 7. Cleanup

- [x] [P] 7.1 `docs/solutions/mcp-streamable-http-session-durable-objects.md` 定稿：整合 Phase 1 diag + Phase 2 PoC 結論、DO state schema、transport 選擇理由、TTL 策略、rollout timeline
- [x] [P] 7.2 `docs/tech-debt.md` TD-030 `Status: done`，附 Resolved 日期（2026-04-25 by `wire-do-tool-dispatch`）+ §6.4 4-layer fix one-liner — 已於 wire-do archive 時完成
- [x] [P] 7.3 `openspec/specs/mcp-knowledge-tools/spec.md` 由 wire-do archive 時自動合併 delta；後續 archive 此 change 時若有新 delta 會再合併

## 8. 自動化檢查（wire-do-tool-dispatch 等價覆蓋）

- [x] 8.1 Claude.ai 端到端 tool call — wire-do v0.45.1 staging acceptance 4 tool call (askKnowledge x2 + searchKnowledge x2) 全 `isError:false`；同條 endpoint + 同條 worker shim → DO 路徑，response shape 與 Claude.ai client 行為等價
- [x] 8.2 wrangler tail 無 `[MCP-DIAG]` log — `a427682` 已 revert diag patch；wire-do production deploy 後 tail 確認無 diag log
- [x] 8.3 wrangler tail 無 Cloudflare proxy `ownKeys` error — wire-do v0.46.0 production deploy 後 tail 確認 worker fetch handler 正常 (POST initialize + bearer 401 unauthorized 為預期 client error，無 ownKeys/TypeError)
- [x] 8.4 staging + production `features.mcpSession` flag 值 — staging `wrangler.staging.jsonc` flag=true、production `wrangler.jsonc` flag=true（v0.46.0 flip），符合「上線後 staging+production 都 flag=true」rollout 計畫
- [x] 8.5 TD-030 done + `@followup[TD-030]` 無殘留 — `pnpm spectra:followups` 報告 TD-030 status=done，無 unregistered marker
