# Handoff

## In Progress

- [ ] `passkey-first-link-google-custom-endpoint`
- 已完成 `GET /api/auth/account/link-google-for-passkey-first` initiator / callback、`/account/settings` UI 分流、chat persistence race 修正、unit/integration/e2e/spec 更新；目前約 38/45 tasks，待最終 UI 證據與 archive
- [ ] `drizzle-refactor-credentials-admin-members`
- 仍缺 `/account/settings` 與 `/admin/members` manual regression，以及 `docs/tech-debt.md` TD-010 狀態回填

## Blocked

- screenshot-review agent 多次未回最終 PASS；但我已手動在 `http://localhost:3000` 用既有 member session 確認 conversation history 列表會顯示、切換會載入內容、刪除會同步更新。剩餘缺口是 in-flight 鎖定的最終 screenshot evidence
- `.data/db/sqlite.db` 的 local auth storage 仍有 drift；`bash scripts/checks/verify-auth-storage-consistency.sh --local .data/db/sqlite.db` 目前失敗，`account` / `session` 等表仍殘留 `*_new` FK refs，造成 `/api/_dev/login` 建新帳號失敗
- `drizzle-refactor-credentials-admin-members` task 7.3 屬人工檢查，仍需 production `/account/settings` 與 `/admin/members` 的實測證據

## Next Steps

1. 對 `http://localhost:3000` 重跑 chat screenshot review，補齊 in-flight 鎖定證據；若通過，archive `passkey-first-link-google-custom-endpoint`
2. 修復或重建 `.data/db/sqlite.db`，讓 local auth storage verifier 轉綠並恢復 `/api/_dev/login` 新建帳號能力
3. 補 `drizzle-refactor-credentials-admin-members` 的 manual regression，回填 TD-010，再決定是否 archive
4. 若 auth 線收斂，切到 `multi-format-document-ingestion`
