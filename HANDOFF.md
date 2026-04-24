# Handoff

## In Progress

### `upgrade-mcp-to-durable-objects`（Pivot C scope trim 2026-04-24，session lifecycle only）

- Claim: `charles@charlesdeMac-mini.local`（2026-04-24 release 回給使用者，Phase 4 scope trim 後續 rollout 由人工決策）
- Progress: 17/27 tasks（63%，新增 Task 4.3.1 之後）
  - ✅ Phase 4 Core Implementation — **scope 縮 2026-04-24**：4.1 `DoJsonRpcTransport` class / 4.2 `MCPSessionDurableObject` + storage schema + alarm GC / 4.3 `fetch()` session lifecycle（initialize → Mcp-Session-Id / 續命 / alarm GC / 404 on missing）/ 4.3.1（新增）non-initialize path 回 HTTP 501 + JSON-RPC `-32601 TD-041` explicit error / 4.4 shim 層 flag 分支（`server/utils/mcp-agents-compat.ts`）/ 4.5 wrangler binding + migration tag / 4.6 middleware (token revoke 同步清 DO 已列 TD-040)
  - ✅ Phase 5 Test Coverage — 5.1 DO lifecycle spec 擴充 TD-041 assertion / 5.2 handshake spec（flag=true/false 兩路徑，**但不驗 tool call**，tool dispatch 由 wire-do-tool-dispatch change 接手）/ 5.3 stateless fallback regression clean
  - ✅ Phase 7.1 `docs/solutions/mcp-streamable-http-session-durable-objects.md` 定稿
- **新登記**：TD-041（DO tool dispatch 未 wire up，flag=true non-initialize 回假 ack → 已改為 explicit 501 error），觸發開新 change `wire-do-tool-dispatch`
- **Pivot C 縮 scope 決策記錄**：DO 內 `McpServer` lazy init + `DoJsonRpcTransport.dispatch` + auth/env plumbing 牽涉三個非 trivial 架構決策（event shim、auth context HMAC forward、`Reflect.ownKeys` workaround 是否重現於 DO），本 change 先交付 session lifecycle 證明 Pivot C 方向可行；tool dispatch 獨立 change 接手

## Blocked

無

## Next Steps

1. **Phase 6 Rollout — session lifecycle only**
   - Staging 設 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`、`NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS=1800000`
   - `wrangler tail` 觀察 Claude.ai `initialize` → 200 + `Mcp-Session-Id` header；任何 `tools/call` 或 `tools/list` 會被 DO 回 **501 JSON-RPC `-32601 TD-041`**（這是預期行為，不是 bug）
   - Production **維持 flag=false**（task 6.3 已更新），直到 `wire-do-tool-dispatch` archive
   - 本 change archive 時 TD-030 維持 `open`（尚未解決），等 `wire-do-tool-dispatch` archive 才一併 done
2. **`wire-do-tool-dispatch`**（parked）— Phase 4 剩下的 tool dispatch 工作全部進此 change
   - Scope：DO 內 McpServer lazy init + 4 tool registration + `DoJsonRpcTransport.dispatch`
   - Scope：Auth context HMAC 簽章 forward（Nuxt → DO）
   - Scope：DO-aware H3Event shim（讓 tool handler 不動介面）
   - Rollout：staging flag=true soak 3 天 → production flag=true
   - Gate：可獨立於 DO change archive 前 apply（兩 change 同 spec `mcp-knowledge-tools` 會 mutex，但 DO change archive 前 apply 也 OK，scope 清楚不衝突）；實際排程由使用者決定
3. **平行可推進（與 DO / wire-do-tool-dispatch 皆獨立）**
   - `enhance-mcp-tool-metadata` — **10/14 (71%) parked pending production deploy**（implementation commit `ece9c12` 已在 branch，Tasks 1.1-2.4 / 3.1-3.2 完成 + `mcp-tool-metadata.spec.ts` 4/4 pass；剩 3.3 MCP Inspector 實測 + 4.1/4.2/4.3 使用者 review `.describe()` / `inputExamples` / `annotations`，全部等下次 production deploy 後以真實 MCP client metadata 為準再一次驗）
   - `add-mcp-tool-selection-evals` — 12/19 (63%) in progress（eval harness 實作中）
   - `fix-delete-account-dialog-google-reauth` — 10/15 (67%) in progress（TD-028 auth-critical Tier 2）
4. **`assert-never` util 收斂**（獨立，低優先）— `app/utils/assert-never.ts` 與 `shared/utils/assert-never.ts` 重複，nuxt typecheck WARN
5. **長期 TD**（見 `docs/tech-debt.md` + `openspec/ROADMAP.md` Next Moves）
   - TD-027 MCP connector first-time auth — 等 DO + wire-do-tool-dispatch 雙完成後實測
   - TD-030 Claude.ai re-init 循環 — 等 `wire-do-tool-dispatch` archive 才能標 done
   - TD-040 Token revoke 同步清 MCP session DO — 需 token→sessionId 索引（low priority）
   - TD-041 DO tool dispatch 未 wire up — 等 `wire-do-tool-dispatch` archive 才能標 done
   - TD-009 / TD-015+TD-019+TD-016 / TD-026 / 日期格式 smoke

## MCP Toolkit Review Backlog（ROADMAP Next Moves 長期區塊）

完整 backlog 與 supersedes 關係見 `openspec/ROADMAP.md`：

- **`discuss-mcp-resource-layer`**（長期，等 DO archive）
- **`discuss-mcp-elicitation-for-ask`**（長期，互斥 DO Non-Goals）
- **`discuss-mcp-async-context-refactor`**（長期，supersedes 原 `integrate-mcp-logger-notifications` — 後者實證需要 asyncContext 才能用 toolkit 的 `useMcpLogger` / `useMcpServer`）

## 範圍外發現（待使用者裁定）

- `test/integration/mcp-tool-metadata.spec.ts` — untracked 測試檔（之前 /commit Step 6 unpark/park cycle 產生），內容是 `enhance-mcp-tool-metadata` change 的驗收測試，現在該 change 已 parked 且 tasks.md 有明確對應項。建議：解 park 該 change 進 apply 時由 tasks 2.x 建立乾淨版本，目前 untracked 檔可刪。

## 安裝紀錄

- 2026-04-24：`npx skills add https://mcp-toolkit.nuxt.dev --agent claude-code -y` 安裝 `manage-mcp` skill 到 `.claude/skills/`
- **未**加入 `scripts/install-skills.sh`；下次需要重裝時手動補同樣指令
