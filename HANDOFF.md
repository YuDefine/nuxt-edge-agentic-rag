# Handoff

## In Progress

### `auth-redirect-refactor`（實作已完 + commit + 人工驗收完，待 archive）

- 所有實作已 commit 到 v0.36.0（`495319b` / `a90c49b` / `4da6c5b`）
- 人工檢查 7.1 / 7.2 / 7.3 / 7.5 / 7.6 全部 PASS
- 7.4（MCP connector first-time auth）deferred 到 staging/production → **TD-027**
- **下一步**：`/spectra-archive auth-redirect-refactor`

### `fix-mcp-streamable-http-session`（WIP，非本 session 工作）

有 uncommitted 變更（proposal/design/tasks + server/utils/mcp-agents-compat.ts + 2 個 test spec + solutions 筆記）。**這些由原來做它的 session / 使用者自行處理**，本次 commit 刻意未包含。

## Next Steps

1. **`/spectra-archive auth-redirect-refactor`** — 一行指令結案 v0.36.0 已含全部改動
2. **TD-027 staging/production 驗證**：部署後跑 7.4 MCP connector first-time authorization journey（claude.ai → `/auth/mcp/authorize` → Google → 回原 URL → 授權 → 回 claude.ai）
3. **TD-028 處理**：`DeleteAccountDialog.handleGoogleReauth` 加 `callbackURL` + sessionStorage bridge 讓 Google reauth 回到 `/account/settings` 重開 dialog（細節見 `docs/tech-debt.md` TD-028）
4. **Deploy v0.36.0 後 smoke**：
   - 未登入打 `/` → `/auth/login`（無 `/api/conversations` 請求）
   - Google OAuth `redirect=/admin/documents` 回得去
   - Passkey 註冊完自動進入系統
   - 登出按鈕 full reload 到 `/auth/login`
5. **`fix-mcp-streamable-http-session`**：另一個 session 續跑，uncommitted 檔案在 local
6. **Residual TDs（長期 backlog）**：
   - TD-009（`user_profiles.email_normalized` 改 nullable）Tier 3 migration
   - TD-015 + TD-019 + TD-016 SSE 合併處理（heartbeat + reader pattern + isAbortError 抽共用）
   - TD-026（index.vue vs ConversationHistory owner-fallback 重複 config）low priority
   - `passkeyFeatureEnabled` computed 三處重複（simplify review 發現，未建 TD — 三個檔案觸動即可抽 `useFeatureFlags` composable）
7. **日期格式 smoke（遺留）**：`/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認新格式（`YYYY/M/D HH:mm:ss`）
