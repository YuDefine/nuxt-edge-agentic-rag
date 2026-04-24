# Handoff

## In Progress

### `fix-mcp-streamable-http-session`（實作 commit 完，仍未 archive）

- 實作 + test 已 commit 到 v0.37.0（`962c897` / `2207e17` / `b4e3422`）
- 仍有 **stale claim**（1h ago）— 接手前先 `pnpm spectra:release` 或直接 takeover
- tasks §5（部署 + wrangler tail）、§6（Claude.ai 實機驗證）**未完成**
- `pre-archive-followup-gate.sh` 會因 §5 / §6 未勾擋 archive
- **下一步**：部署 v0.37.0 → 在 Claude.ai 實測 MCP connector → 勾 §5 / §6 → `/spectra-archive fix-mcp-streamable-http-session`

## Next Steps

1. **部署 v0.37.0 到 staging / production**
   - 觀察 `wrangler tail` 確認 `POST /mcp` 回 `Content-Type: application/json`
   - GET / DELETE 立即回 405（無 30s hang）
2. **Claude.ai 端實機驗證（同時消化 TD-027）**：
   - 連接 MCP connector 走完 first-time authorization
   - 預期回到 `/auth/mcp/authorize?...`（非 `/` 或 `/auth/login`）
   - 確認連續 3 次工具呼叫無 re-initialize
   - 全通過後 `/spectra-archive fix-mcp-streamable-http-session` + 更新 TD-027 / TD-029 status
3. **TD-028 後續處理**（DeleteAccountDialog Google reauth callbackURL）：細節見 `docs/tech-debt.md` TD-028
4. **TD-029 方案 A**：加 built Nitro smoke test 驗證 MCP production wiring（shim 是否真的被載入）
5. **Residual TDs（長期 backlog）**：
   - TD-009（`user_profiles.email_normalized` 改 nullable）Tier 3 migration
   - TD-015 + TD-019 + TD-016 SSE 合併處理（heartbeat + reader pattern + isAbortError 抽共用）
   - TD-026（index.vue vs ConversationHistory owner-fallback 重複 config）low priority
   - `passkeyFeatureEnabled` computed 三處重複（`useFeatureFlags` composable 機會）
6. **日期格式 smoke（遺留）**：`/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認新格式
