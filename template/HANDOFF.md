# Handoff

## In Progress

- [ ] `drizzle-refactor-credentials-admin-members` 仍未 archive
- 依 `tasks.md` 目前只剩 production regression（7.3）與 `docs/tech-debt.md` TD-010 狀態回填（7.5）
- [ ] `fk-cascade-repair-for-self-delete` 仍未 archive
- 依 `tasks.md` 目前只剩 production passkey-only 自刪 / tombstone / token cascade 驗證（8.5-8.6）與 TD-011 狀態回填（8.7）
- 已完成 local mitigation：`server/utils/better-auth-safe-logger.ts` 已接入 `server/auth.config.ts`，用來避免 Better Auth logging 在 Worker runtime 再把 raw error/object 序列化炸成 `a14.ownKeys...` 500；`test/unit/better-auth-safe-logger.test.ts`、`test/integration/passkey-verify-authentication-hotfix.spec.ts`、`pnpm build` 均已通過
- [ ] `multi-format-document-ingestion` 與 `passkey-first-link-google-custom-endpoint` 兩個 active change 尚未開始實作

## Blocked

- production `POST /api/auth/passkey/verify-authentication` 仍是 blocker；safe logger mitigation 尚待 deploy 後驗證是否解除 `a14.ownKeys...` 500
- `passkey-first-link-google-custom-endpoint` 依 proposal 仍被 `fk-cascade-repair-for-self-delete` 的 production apply / 驗證結果卡住
- `Stop` hook 的提醒本身是正常行為；只要 active changes 與未提交變更還存在，就會持續提醒

## Next Steps

1. Deploy 目前這版 safe logger mitigation，重驗 production `POST /api/auth/passkey/verify-authentication`
2. 若 production passkey reauth 恢復，立刻完成 `fk-cascade-repair-for-self-delete` 的 8.5-8.7
3. 若仍失敗，依新的 live log / response 繼續追真正底層錯誤
4. 收尾 `drizzle-refactor-credentials-admin-members` 的 production regression 與 TD-010 狀態回填，完成後 archive
5. 再決定下一個 active change 要先做 `multi-format-document-ingestion` 還是 `passkey-first-link-google-custom-endpoint`
