# Handoff

## In Progress

### `upgrade-mcp-to-durable-objects`（Pivot C 實作完成 Phase 4-7.1，待 rollout）

- Claim: `claude-code:opus-4-7`（accepted from handoff，2026-04-24 v0.40.0 部署後）
- Progress: 16/26 tasks（62%）
  - ✅ Phase 4 Core Implementation 4.1-4.6（DO class / transport / shim 路由 / wrangler binding / build pipeline / middleware contract）
  - ✅ Phase 5 Test Coverage 5.1-5.3（DO lifecycle / handshake 兩路徑 / regression）
  - ✅ Phase 7.1 docs/solutions/mcp-streamable-http-session-durable-objects.md 定稿
- 程式碼已隨 v0.40.0 部署到 staging（`gh run watch 24893099340` 全綠），production tag 已 push（gate 等 staging soak）
- TD-040 follow-up 已登記：token revoke 未同步清 DO session（Task 4.6 emit）

## Blocked

無

## Next Steps

1. **Phase 6 Rollout — staging T1 flag flip**
   - 在 staging Cloudflare 環境設 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`
   - `wrangler tail` 觀察 Claude.ai 連 3 次 askKnowledge：應無 re-init loop、無 `Reflect.ownKeys(env)` 錯誤、`Mcp-Session-Id` 在 response header 出現
   - 失敗 → flag flip 回 false（無需 redeploy），重新 diag
2. **T2 staging soak 3 天**（含 workday + 週末低峰），無異常後進 T3
3. **T3 production flag flip**（Cloudflare Pages env）→ tail 24h
4. **T4 production soak 7 天 → archive change** + tasks 7.2 (TD-030 status: done) + 7.3（spec archive 校對 `@trace`）
5. **平行 propose**（不撞 DO rollout）：
   - `enhance-mcp-tool-metadata`（已 parked，`/spectra-apply` 自動 unpark）
   - `add-mcp-tool-selection-evals`（已 propose，draft only，可立即 apply）
   - `fix-delete-account-dialog-google-reauth`（已 parked，TD-028 auth-critical）
6. **`assert-never` util 收斂** — `app/utils/assert-never.ts` 與 `shared/utils/assert-never.ts` 重複，nuxt typecheck WARN，獨立 change 候選
7. **長期 TD**（見 `docs/tech-debt.md` + `openspec/ROADMAP.md` Next Moves）
   - TD-027 MCP connector first-time auth — 等 DO change archive 後一併實測
   - TD-040 Token revoke 同步清 MCP session DO — 需 token→sessionId 索引（low priority）
   - TD-009 / TD-015+TD-019+TD-016 / TD-026 / 日期格式 smoke

## MCP Toolkit Review Backlog（已收進 ROADMAP Next Moves）

完整 backlog 與 supersedes 關係見 `openspec/ROADMAP.md` MANUAL `## Next Moves`：

- **`discuss-mcp-resource-layer`**（長期，等 DO archive）
- **`discuss-mcp-elicitation-for-ask`**（長期，互斥 DO Non-Goals）
- **`discuss-mcp-async-context-refactor`**（長期，supersedes 原 `integrate-mcp-logger-notifications` — 後者實證需要 asyncContext 才能用 toolkit 的 `useMcpLogger` / `useMcpServer`，故併入此 discuss 統一決策）

## 範圍外發現（待使用者裁定）

- `test/integration/mcp-tool-metadata.spec.ts` — 在本次 /commit Step 6 unpark/park cycle 後出現的 untracked 測試檔，內容是 `enhance-mcp-tool-metadata`（parked）change 的驗收測試。**目前 import 的 `defineMcpTool` API 尚未引入**，include 會破 0-C `pnpm test`，故 v0.40.0 commit 不含此檔，留 untracked 等使用者：
  - 選項 A：等 `enhance-mcp-tool-metadata` 解 park 進 apply 階段時一併 commit（推薦）
  - 選項 B：刪除此檔（若是誤產出）
  - 選項 C：先 commit 並 `.skip` 標註，等 API 引入後再啟用（不推薦，違反「NEVER skip tests」規則）

## 安裝紀錄

- 2026-04-24：`npx skills add https://mcp-toolkit.nuxt.dev --agent claude-code -y` 安裝 `manage-mcp` skill 到 `.claude/skills/`
- **未**加入 `scripts/install-skills.sh`；下次需要重裝時手動補同樣指令（或加到 install script 的第 7 個章節）
