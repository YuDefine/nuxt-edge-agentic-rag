# Handoff

## In Progress

- [ ] `drizzle-refactor-credentials-admin-members` 仍未 archive
- 依 `tasks.md` 目前只剩 production regression（7.3）與 `docs/tech-debt.md` TD-010 狀態回填（7.5）
- [ ] `multi-format-document-ingestion` 與 `passkey-first-link-google-custom-endpoint` 兩個 active change 尚未開始實作

## Completed This Round

- `fk-cascade-repair-for-self-delete` 已完成並 archive（`openspec/changes/archive/2026-04-23-fk-cascade-repair-for-self-delete/`）
- production closeout 已通過：`v0.28.12` 重新實測 passkey-only 自刪，`verify-authentication` / `account/delete` / `sign-out` 全數 `200`，最終 hard redirect 回 `/`、`/api/auth/get-session = null`，登入首頁文案恢復
- production D1 也已驗證 tombstone 與 cascade：latest `member_role_changes.reason = 'self-deletion'`，該 test user 的 `"user"` / `passkey` / `mcp_tokens` count 皆為 `0`
- `docs/solutions/auth/better-auth-passkey-worker-catchall-override.md` 已記錄 Worker `verify-authentication` workaround；另新增 `docs/solutions/auth/passkey-self-delete-hard-redirect.md` 記錄自刪後必須 hard redirect 的 SPA 狀態收斂經驗

## Blocked

- `Stop` hook 的提醒本身是正常行為；目前即使 worktree 乾淨，只要 4 個 active changes 還在，就仍會持續提醒

## Next Steps

1. 收尾 `drizzle-refactor-credentials-admin-members` 的 production regression 與 TD-010 狀態回填，完成後 archive
2. 再決定下一個 active change 要先做 `multi-format-document-ingestion` 還是 `passkey-first-link-google-custom-endpoint`
