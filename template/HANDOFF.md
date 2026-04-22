# Handoff

## In Progress

- [ ] `drizzle-refactor-credentials-admin-members` 仍未 archive
- 依 `tasks.md` 目前只剩 production regression（7.3）與 `docs/tech-debt.md` TD-010 狀態回填（7.5）
- [ ] `fk-cascade-repair-for-self-delete` 仍未 archive
- 依 `tasks.md` 目前只剩 production passkey-only 自刪 / tombstone / token cascade 驗證（8.5-8.6）與 TD-011 狀態回填（8.7）
- 已完成 local mitigation：`server/utils/better-auth-safe-logger.ts` 已接入 `server/auth.config.ts`，目前不只會先序列化 raw error/object，還會改走 plain console sink 並顯式 `disableColors: true`，避免 Better Auth logging 在 Worker runtime 再碰到 color/env probing；`test/unit/better-auth-safe-logger.test.ts`、`test/integration/passkey-verify-authentication-hotfix.spec.ts`、`pnpm build` 均已通過
- 本地 `npx wrangler --cwd .output dev` 已可正常啟動，先前 `getColorDepth -> a14.has` 的 Worker startup 崩點不再重現；首頁 canary `GET /` 回 `200`
- 已新增 exact route `server/api/auth/passkey/verify-authentication.post.ts`，先前版本是直接改走 `auth.api.verifyPasskeyAuthentication({ asResponse: true })`，最新未提交版本再進一步改成 `auth.handler(new Request(...))` forwarding，盡量貼近 Better Auth 原生 request contract，避開 `@onmax/nuxt-better-auth` 的 `/api/auth/**` catch-all handler 與 Worker adapter 邊界；runtime gate / handler guard 仍保留，確保 passkey 關閉時維持 `404` 語意、handler 缺失時回 `503 Passkey authentication unavailable`。GitHub CI 曾暴露 Node unit runner 載入 `h3` bare import 的問題，現已把 `h3` 錯誤包裝收回 route handler、util 改丟自家錯誤型別；`pnpm check`、`pnpm test:unit`、`test/unit/passkey-verify-authentication.test.ts`、`pnpm build` 已通過，本地對空 payload 實測會回自訂 `400 Passkey authentication payload invalid`，證明 routing precedence 生效
- local full-flow preview 目前不能直接當 WebAuthn 判準：以 `http://localhost:8790` 跑 passkey-first 註冊時，`verify-registration` 會因 `.output` artifact 仍固化 production origin 而報 `Unexpected registration response origin "http://localhost:8790", expected "http://agentic.yudefine.com.tw"`；因此 local preview 現階段只能驗 route precedence / startup，不足以代表 ceremony 本身好壞
- `v0.28.7` production live trace 已再把 root cause 縮到 Better Auth `setSessionCookie -> setCookieCache -> filterOutputFields(structuredClone(...))` 路徑：重新實測 passkey-first 註冊 + `/account/settings` reauth 時，`generate-authenticate-options` 仍 `200`、`verify-authentication` 仍 `500`，tail 維持 `TypeError: a14.ownKeys is not a function or its return value is not iterable`。對照 `@better-auth/core/utils/db.mjs` 後，本地最新 hotfix 已在 `server/auth.config.ts` 顯式關閉 `session.cookieCache.enabled`，避免 Worker 對 adapter row 做 `structuredClone`；同輪也把 `better-auth-safe-logger.ts` 收斂成單字串 console sink，並把 args serialization 再包一層 try/catch，避免 catch-path logging 再次放大錯誤
- 新增 `test/unit/better-auth-worker-cookie-cache-hotfix.test.ts`；連同 `test/unit/better-auth-safe-logger.test.ts`、`test/unit/passkey-verify-authentication.test.ts`、`pnpm check`、`pnpm build` 均已通過
- 已補 `docs/solutions/auth/better-auth-passkey-worker-catchall-override.md`，記錄這輪 3+ 次嘗試後收斂出的 reusable workaround 與判斷線索
- [ ] `multi-format-document-ingestion` 與 `passkey-first-link-google-custom-endpoint` 兩個 active change 尚未開始實作

## Blocked

- production `POST /api/auth/passkey/verify-authentication` 仍是 blocker；`v0.28.7` 已證實 exact route / direct handler forwarding 仍不足以解除 `a14.ownKeys...`。目前尚待把最新「關閉 Better Auth session cookie cache + 強化 safe logger」版本 deploy 上去，再驗證 Worker `structuredClone(proxy row)` 路徑是否被真正繞開
- `passkey-first-link-google-custom-endpoint` 依 proposal 仍被 `fk-cascade-repair-for-self-delete` 的 production apply / 驗證結果卡住
- `Stop` hook 的提醒本身是正常行為；目前即使 worktree 乾淨，只要 4 個 active changes 還在，就仍會持續提醒

## Next Steps

1. Commit / deploy 目前這版 safe logger + exact route mitigation（含 `auth.handler(new Request(...))` forwarding）外加 `session.cookieCache.enabled = false` hotfix，重驗 production `POST /api/auth/passkey/verify-authentication`
2. 若 production passkey reauth 恢復，立刻完成 `fk-cascade-repair-for-self-delete` 的 8.5-8.7
3. 若仍失敗，依新的 live log / response 繼續追真正底層錯誤
4. 收尾 `drizzle-refactor-credentials-admin-members` 的 production regression 與 TD-010 狀態回填，完成後 archive
5. 再決定下一個 active change 要先做 `multi-format-document-ingestion` 還是 `passkey-first-link-google-custom-endpoint`
