# Handoff

## In Progress

### v0.41.0 部署中（2026-04-24）

- main push → staging deploy 綠燈（run 24894814696）
- tag `v0.41.0` 已推 → production deploy + docs production 進行中，待驗收
- 本次 release 帶 5 條工作線改動（deploy CI bug、MCP metadata、DO Phase 4 scope trim、eval harness、delete account Google reauth fix）與 1 條自動副作用（enhance-mcp-tool-metadata auto-parked）

### `upgrade-mcp-to-durable-objects`（Pivot C scope trim 後，session lifecycle only）

- Progress: 17/27 tasks（63%）；Phase 4 實作已全部在 branch（commit `5b8e524`）
- scope 縮：DO 內 `McpServer` lazy init + tool dispatch 由新 change `wire-do-tool-dispatch` 接手（@followup[TD-041]）
- non-initialize path 現在回 **HTTP 501 JSON-RPC `-32601`** explicit error，避免 flag=true 時 silent degradation

### `add-mcp-tool-selection-evals`（eval harness 已落地）

- Progress: ~12/19 tasks；`evalite` + `@ai-sdk/anthropic` + `@ai-sdk/mcp` 已裝；`test/evals/` 骨架 + scorer + dataset 完成（commit `0687af8`、`8fa5dc6`）
- 剩餘：harness 主檔的 regression threshold、baseline 建立、docs/evals/mcp-tool-selection.md 填入初次 baseline

### `fix-delete-account-dialog-google-reauth`（實作過半）

- Progress: ~10/15 tasks；`setPendingDeleteReauth` / `consumePendingDeleteReauth` signal + dialog `initialReauthComplete` prop + settings page resume 流程已完成（commit `6bcfec9`）
- 剩餘：人工走一次 Google reauth 完整流程（跨 redirect resume）、截圖 QA、archive tasks

### `enhance-mcp-tool-metadata`（parked，pending production deploy 驗證）

- Progress: 10/14 tasks（71%）；4 個 tool 的 `.describe()` / `annotations` / `inputExamples` 已 commit（`ece9c12`），integration spec 4/4 pass
- 剩餘：3.3 MCP Inspector 實測 + 4.1-4.3 人工 review（皆需真實 production MCP client metadata）

## Blocked

無

## Next Steps

1. **追 production deploy 結果**
   - `gh run watch` v0.41.0 tag 觸發的 Deploy workflow（驗 `deploy-production` + `smoke-test` + `deploy-docs-production` + `smoke-test-docs-production` + `notify` 全綠）
   - **重點驗收**：Discord `notify` 訊息
     - tag push → 應為「Deploy succeeded (production) — v0.41.0」（行為不變）
     - **本次 main push（`96072a5`）應為「Deploy succeeded (staging) — main」** — 驗 notify bug fix 實際效果；若仍為「Deploy failed (production) — main」代表修正未如預期
2. **production 綠燈後批次驗**
   - 解 park `enhance-mcp-tool-metadata`，用真實 production MCP client metadata 走 3.3 MCP Inspector 實測 + 4.1-4.3 人工 review；無異常即 archive
   - 人工走 `fix-delete-account-dialog-google-reauth` 完整流程（settings → 刪除帳號 → Google reauth → resume → confirm）；截圖 QA 後 archive
3. **DO Phase 6 Rollout — session lifecycle only**
   - Staging 設 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`、`NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS=1800000`
   - `wrangler tail` 觀察：`initialize` → 200 + `Mcp-Session-Id`；`tools/*` → 501 `-32601 TD-041`（預期行為）；閒置 > 30 min alarm GC
   - Production **維持 flag=false** 直到 `wire-do-tool-dispatch` archive
4. **`wire-do-tool-dispatch`**（parked）— 接手 Phase 4 剩下的 tool dispatch
   - Scope：DO 內 McpServer lazy init + 4 tool registration + `DoJsonRpcTransport.dispatch` + auth context HMAC forward + DO-aware H3Event shim
   - Gate：可獨立於 DO change archive 前 apply（兩 change 同 spec `mcp-knowledge-tools` mutex，排程由使用者決定）
5. **`add-mcp-tool-selection-evals` 收尾**
   - harness 主檔 regression threshold（–5%）+ 首次跑建立 baseline → 寫入 `docs/evals/mcp-tool-selection.md`
   - 不進 CI gate（API cost + non-deterministic）
6. **`assert-never` util 收斂**（獨立，低優先）
   - `app/utils/assert-never.ts` 與 `shared/utils/assert-never.ts` 重複，nuxt typecheck 仍 WARN
7. **長期 TD**（見 `docs/tech-debt.md` + `openspec/ROADMAP.md` Next Moves）
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

## 安裝紀錄

- 2026-04-24：`npx skills add https://mcp-toolkit.nuxt.dev --agent claude-code -y` 安裝 `manage-mcp` skill 到 `.claude/skills/`
- **未**加入 `scripts/install-skills.sh`；下次需要重裝時手動補同樣指令
