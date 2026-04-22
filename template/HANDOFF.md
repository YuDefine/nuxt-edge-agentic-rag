# Handoff

## In Progress

- [ ] `fk-cascade-repair-for-self-delete` 仍停在 41/44
- 本輪已把 passkey reauth hotfix commit 成 `v0.28.1`，包含 `better-auth` / `@better-auth/passkey` 1.6.7、`better-call` 1.3.5 override、`vite` / `vitest` 0.1.19 對齊，以及 `verify-authentication` endpoint-level regression test；尚未完成 production closeout
- [ ] `drizzle-refactor-credentials-admin-members` 仍為 active change
- 目前只差 production / local manual regression 與 tech debt 狀態回填

## Blocked

- `fk-cascade-repair-for-self-delete` 的 8.5 / 8.6 / 8.7 仍被 production live 驗證擋住
- 需要 `v0.28.1` 真正部署完成後，重新驗證 production `POST /api/auth/passkey/verify-authentication` 不再 500，才能繼續 passkey-only 自刪與 D1 cascade 檢查

## Next Steps

1. 監看這次 `main` push 與 `v0.28.1` tag 的 GitHub Actions / Cloudflare deploy，確認 production 與 staging 都成功
2. 部署完成後，重新驗證 production `GET /api/auth/passkey/generate-authenticate-options` 與 `POST /api/auth/passkey/verify-authentication`，確認不再出現 `a14.ownKeys...` 500
3. 用 production passkey-only 測試帳號重跑 `/account/settings` 自刪流程，完成 `fk-cascade-repair-for-self-delete` 8.5
4. 查 production D1：確認 `member_role_changes` tombstone 保留、`mcp_tokens` cascade 清除、必要時補驗相關查詢，完成 8.6
5. 更新 `openspec/changes/fk-cascade-repair-for-self-delete/tasks.md` 與 TD-011 狀態，完成 8.7
6. 收尾 `drizzle-refactor-credentials-admin-members` 的 manual regression，並回填 TD-010 狀態
