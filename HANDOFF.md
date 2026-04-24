# Handoff

## In Progress

### `upgrade-mcp-to-durable-objects`（Phase 1 diag spike 進行中）

- Claim: `charles@charlesdeMac-mini.local`
- Progress: 2/25 tasks（8%）
  - ✅ 1.2 runtime config `mcp.sessionTtlMs`（commit `39ebcb3`）
  - ✅ 2.1 shim diagnostic log patch（commit `5f3d01d`）
- Current phase: **Task 2.2 等 Claude.ai 實測**
  - diag patch 已包在 v0.39.0 release，staging 已綠、production deploy workflow 在跑（tag `v0.39.0` 已 push）
  - 等 production deploy 成功 → 使用者在 Claude.ai 隨便點一個 `AskKnowledge`/`SearchKnowledge` 觸發 re-init 循環
  - 然後跑 `wrangler tail` 抓 `[MCP-DIAG]` JSON ≥ 5 筆，對照 SDK 400 路徑 decision rule（`-32700 Invalid JSON` / `-32700 Invalid JSON-RPC message` / `-32600 Server already initialized`）

## Next Steps

1. **確認 production deploy 綠燈** — `gh run watch <run-id>` 看 tag `v0.39.0` 的 deploy-production job 完成
2. **在 Claude.ai 觸發 re-init 循環 + tail 抓 diag body** — Task 2.2；拿到 body 後 Task 2.3：
   - 記錄到 `docs/solutions/mcp-streamable-http-session-durable-objects.md` 草稿
   - revert diag patch（`server/utils/mcp-agents-compat.ts` `// === MCP-DIAG START @followup[TD-030]` 整段刪）
   - 獨立 `/commit`（diagnostic code 不留 main）
3. **Phase 2 PoC**（Task 3.1 3.2）— 依 Phase 1 結論決定 `McpAgent` on DO 還是自寫 DO-backed transport
4. **Phase 3+ Core Implementation**（Task 4.1 起）
5. **`assert-never` 重複 util 收斂** — 新增 `app/utils/assert-never.ts` 與既有 `shared/utils/assert-never.ts` 重複（Nuxt auto-import 以 shared 版為主），使用者後續決定保留哪一版（非本 change scope）
6. **長期 TD**（見 `docs/tech-debt.md`）
   - TD-027 MCP connector first-time auth — 等 DO 方案完成後一併實測
   - TD-028 DeleteAccountDialog Google reauth callbackURL — 獨立 change 候選
   - TD-009 `user_profiles.email_normalized` nullable migration
   - TD-015 + TD-019 + TD-016 SSE 合併處理
   - TD-026 conversation owner-fallback 重複 config
   - `passkeyFeatureEnabled` 三處重複 → `useFeatureFlags` composable 機會
7. **日期格式 smoke（遺留）** — `/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認
