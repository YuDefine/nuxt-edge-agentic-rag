# Handoff

## In Progress

### `fix-mcp-streamable-http-session`（v0.37.0 上線但問題未解，要轉 Durable Objects）

v0.37.0 post-deploy 實測發現：

- ✅ GET /mcp 405 正確（Workers 30s hang 消失）
- ✅ 首次 handshake + tools/list 正常
- ❌ Claude.ai UI 按任一 tool → "Error occurred"，tail 顯示每 3 秒一次 `POST initialize 400` 循環，**tools/call 從未送達**

→ 使用者登記 **TD-030**（Claude.ai re-init 阻擋 tools/call），本 change 的 stateless 路線不足以解決問題。方向：新 change `upgrade-mcp-to-durable-objects` 重寫成 DO + session。

### `upgrade-mcp-to-durable-objects`（draft，由 TD-030 觸發）

`openspec/changes/upgrade-mcp-to-durable-objects/` 尚未 commit（untracked），內容由使用者並行中。

## Next Steps

1. **走 /spectra-propose 或 /spectra-discuss 把 `upgrade-mcp-to-durable-objects` 收斂成正式 change**，跟 fix-mcp-streamable-http-session 的 Fallback Plan 對齊
2. **`fix-mcp-streamable-http-session` 決定**：
   - 選項 A：保留實作（stateless 快速失敗仍比 30s hang 強），用 `@followup[TD-030]` 標記未解，archive
   - 選項 B：revert 本 change，直接走 DO 方案
3. **v0.38.0 後 smoke** — 使用者登入 / 登出 / Google OAuth / Passkey 全流程應該都 OK（auth-redirect-refactor 已驗），不需額外動作
4. **staging gate 實戰反饋**：
   - v0.38.0 首次走新流程 main push → staging 綠 → tag → prod 全成功
   - 若下次 tag push 時 staging 尚未完成，`verify-staging-gate` 會 `gh run watch` + timeout 25 min；若覺得太長可調 `.github/workflows/deploy.yml` verify-staging-gate.timeout-minutes
5. **TD-027**（MCP connector first-time auth）— 等 DO 方案完成後一併實測
6. **TD-028**（DeleteAccountDialog Google reauth callbackURL）— 獨立 change 候選
7. **Residual TDs（長期）**：
   - TD-009 `user_profiles.email_normalized` nullable migration
   - TD-015 + TD-019 + TD-016 SSE 合併處理
   - TD-026 conversation owner-fallback 重複 config
   - `passkeyFeatureEnabled` 三處重複 → `useFeatureFlags` composable 機會
8. **日期格式 smoke（遺留）**：`/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認
