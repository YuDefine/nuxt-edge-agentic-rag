# Handoff

## In Progress

- [ ] `drizzle-refactor-credentials-admin-members` 仍未 archive
- 依 `tasks.md` 目前只剩 production regression（7.3）與 `docs/tech-debt.md` TD-010 狀態回填（7.5）
- [ ] `fk-cascade-repair-for-self-delete` 仍未 archive
- 依 `tasks.md` 目前只剩 production passkey-only 自刪 / tombstone / token cascade 驗證（8.5-8.6）與 TD-011 狀態回填（8.7）
- 已完成 local mitigation：`server/utils/better-auth-safe-logger.ts` 已接入 `server/auth.config.ts`，目前不只會先序列化 raw error/object，還會改走 plain console sink 並顯式 `disableColors: true`，避免 Better Auth logging 在 Worker runtime 再碰到 color/env probing；`test/unit/better-auth-safe-logger.test.ts`、`test/integration/passkey-verify-authentication-hotfix.spec.ts`、`pnpm build` 均已通過
- 本地 `npx wrangler --cwd .output dev` 已可正常啟動，先前 `getColorDepth -> a14.has` 的 Worker startup 崩點不再重現；首頁 canary `GET /` 回 `200`
- 已新增 exact route `server/api/auth/passkey/verify-authentication.post.ts`，直接改走 `auth.api.verifyPasskeyAuthentication({ asResponse: true })`，避開 `@onmax/nuxt-better-auth` 的 `/api/auth/**` catch-all handler；後續又補上 runtime gate 與 direct-endpoint guard，確保 passkey 關閉時仍維持 `404` 語意、endpoint 缺失時回 `503 Passkey authentication unavailable`；`pnpm check`、`test/unit/passkey-verify-authentication.test.ts`、`pnpm build` 已通過，本地對空 payload 實測會回自訂 `400 Passkey authentication payload invalid`，證明 routing precedence 生效
- 已補 `docs/solutions/auth/better-auth-passkey-worker-catchall-override.md`，記錄這輪 3+ 次嘗試後收斂出的 reusable workaround 與判斷線索
- [ ] `multi-format-document-ingestion` 與 `passkey-first-link-google-custom-endpoint` 兩個 active change 尚未開始實作

## Blocked

- production `POST /api/auth/passkey/verify-authentication` 仍是 blocker；local Worker startup 已恢復，且 verify-authentication exact route override 已完成並保留 feature-gate `404` 語意，但 safe logger + direct API route 這組 mitigation 尚待 deploy 後驗證是否解除 production `a14.ownKeys...` 500
- `passkey-first-link-google-custom-endpoint` 依 proposal 仍被 `fk-cascade-repair-for-self-delete` 的 production apply / 驗證結果卡住
- `Stop` hook 的提醒本身是正常行為；目前即使 worktree 乾淨，只要 4 個 active changes 還在，就仍會持續提醒

## Next Steps

1. Commit / deploy 目前這版 safe logger + exact route mitigation，重驗 production `POST /api/auth/passkey/verify-authentication`
2. 若 production passkey reauth 恢復，立刻完成 `fk-cascade-repair-for-self-delete` 的 8.5-8.7
3. 若仍失敗，依新的 live log / response 繼續追真正底層錯誤
4. 收尾 `drizzle-refactor-credentials-admin-members` 的 production regression 與 TD-010 狀態回填，完成後 archive
5. 再決定下一個 active change 要先做 `multi-format-document-ingestion` 還是 `passkey-first-link-google-custom-endpoint`
