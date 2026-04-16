## Next Steps

1. **Deploy v0.24.0 到 prod**
   - Wrangler deploy 會自動套用 migration 0008（`mcp_tokens.created_by_user_id` NOT NULL + FK cascade rebuild）
   - Prod DB 已先手動清理（4 筆 local/staging test-seed DELETE、2 筆 prod test token UPDATE 到 charles user id），migration `INSERT INTO mcp_tokens_new` 應無違反 NOT NULL 的行

2. **Deploy 後驗證**
   - 跑 `wrangler d1 execute agentic-rag-db --remote --command "PRAGMA table_info(mcp_tokens)"` 確認 `created_by_user_id NOT NULL = 1`
   - `PRAGMA foreign_key_check` 應回空結果
   - 實際走一次 /mcp 認證流程（wire 到 prod token）確認 role gate + audit trail 正常

3. **擦邊觀察**（不 block）
   - `admin-session.ts` fallback 已刪；若 deploy 後有使用者出現 403 Forbidden 於 admin 路徑，檢查該 user `user.role` 是否為 `'admin'`（`session.create.before` 寫入）。實際觸發機率極低（要 email 為空字串才會跳過 hook 的 role 更新）。
