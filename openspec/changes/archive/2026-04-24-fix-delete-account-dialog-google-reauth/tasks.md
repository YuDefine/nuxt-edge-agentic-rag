## 1. Session bridge helpers

- [x] 1.1 `app/utils/auth-return-to.ts` — 新增 `PENDING_DELETE_REAUTH_KEY = 'auth:pending-delete-reauth'`、`DELETE_REAUTH_WINDOW_MS = 5 * 60 * 1000`、`setPendingDeleteReauth()`、`consumePendingDeleteReauth(): boolean`；實作 SSR-safe（非 client 回 false 並 no-op）；consume 時驗證 `Date.now() - stored.timestamp < DELETE_REAUTH_WINDOW_MS` 並無論 valid / expired / malformed 皆 clear 該 key（支援 Account Self-Deletion UI Flow Survives Cross-Origin Reauth）

## 2. DeleteAccountDialog Google reauth 修復

- [x] 2.1 `app/components/auth/DeleteAccountDialog.vue` — `handleGoogleReauth` 在 `signIn.social(...)` 前依序呼叫 `saveGenericReturnTo('/account/settings?open-delete=1')` 與 `setPendingDeleteReauth()`；`signIn.social({ provider: 'google', callbackURL: '/auth/callback' })` 補 `callbackURL` 參數
- [x] 2.2 `DeleteAccountDialog.vue` — 加 prop `initialReauthComplete?: boolean`（default `false`）；修改 `watch(() => props.open, ...)`：當 next === true 時若 `props.initialReauthComplete === true` 則 `reauthComplete.value = true`，其他欄位（`reauthLoading` / `deleteLoading` / `errorMessage`）照原 reset 邏輯；close 時（next === false）不動 `reauthComplete` 以免閃爍

## 3. Settings 頁 resume signal 處理

- [x] 3.1 `app/pages/account/settings.vue` — `onMounted` 讀 `route.query['open-delete']`；若為 `'1'` 呼叫 `consumePendingDeleteReauth()`；valid → 新 ref `deleteDialogResume` 設 true、`deleteDialogOpen` 設 true；無論 valid / invalid 都 `router.replace({ query: {} })` 清除 query；處理 SSR safe（用 `onMounted` 已保證 client-side）
- [x] 3.2 `settings.vue` template — `<LazyAuthDeleteAccountDialog>` 加 `:initial-reauth-complete="deleteDialogResume"`；dialog 關閉時（`v-model:open` 變 false）將 `deleteDialogResume` 重置為 false 避免下次手動開啟誤繼承（用 `watch(deleteDialogOpen, ...)` 或 `@update:open` 回調）

## 4. Unit 測試

- [x] 4.1 [P] 新增 `test/unit/auth-return-to-pending-delete.test.ts`：覆蓋 `setPendingDeleteReauth` + `consumePendingDeleteReauth` 四組 case — (a) 剛 set 立刻 consume = true（對應 Scenario: Google reauth completes and dialog resumes on confirm step）、(b) set 後用 `vi.useFakeTimers()` 推進 > 5 分鐘再 consume = false（Scenario: Expired pending-delete-reauth signal is treated as invalid）、(c) 未 set 直接 consume = false（Scenario: Direct access to resume URL without a valid signal does not bypass reauth）、(d) sessionStorage 塞 malformed JSON 再 consume = false 且 key 被清除
- [x] 4.2 [P] 新增 `test/unit/delete-account-dialog-initial-reauth.test.ts`：mount `DeleteAccountDialog` with `{ open: true, hasGoogle: true, hasPasskey: true, initialReauthComplete: true }` → 驗證 reauth 按鈕不可見、confirm 按鈕 `disabled` 為 false；換成 `initialReauthComplete: false`（或省略）→ 驗證 reauth 按鈕可見、confirm `disabled` 為 true；對應 Scenario: Passkey reauth path is not affected（prop 為 false 時走原 in-component state machine）

## 5. 驗證與品質閘門

- [x] 5.1 `pnpm check`（format + lint + typecheck + test）全綠
- [x] 5.2 `pnpm spectra:followups` 確認無 drift；`pnpm audit:ux-drift` 無新 enum drift
- [x] 5.3 代碼 review：(a) `consumePendingDeleteReauth` 於 settings `onMounted` 只被呼叫一次、(b) `router.replace({ query: {} })` 在 consume 之後且不等待 dialog close、(c) `handleGoogleReauth` 的 save 順序為先 `saveGenericReturnTo` 再 `setPendingDeleteReauth` 再 `signIn.social`，避免 race — 對應 Scenario: Server reauth enforcement is not weakened（UI flow 永不繞過 server reauth）
- [x] 5.4 `docs/tech-debt.md` TD-028 entry Status 保留 `open`，於本 change archive 時才由 archive 流程標為 `done`（按 follow-up register 規則）

## 6. 人工檢查

- [x] 6.1 使用者以 Google-linked 測試帳號（staging / 或隨時可刪的測試帳號）走完整 Google reauth delete flow：`/account/settings` → 刪除帳號 → Google reauth → OAuth 完成 → 回到 `/account/settings` → dialog 自動打開 → confirm 按鈕可按 → 確認刪除 → 跳 `/auth/login`。截圖兩個關鍵時刻：(1) 回到 settings 時 dialog 狀態、(2) 刪除成功後的 login 頁
- [x] 6.2 使用者以 passkey-only 測試帳號走 passkey reauth delete flow，確認無 regression：passkey ceremony → dialog 內狀態切換 → confirm 可按 → 刪除成功（對應 Scenario: Passkey reauth path is not affected）
- [x] 6.3 使用者（一般已登入 session）手動在網址列輸入 `/account/settings?open-delete=1` → 確認 dialog **不**自動打開、URL 中 `?open-delete=1` 在 onMounted 後消失（對應 Scenario: Direct access to resume URL without a valid signal does not bypass reauth）
- [x] 6.4 使用者觸發 Google reauth 後於 Google OAuth 頁點「取消」或關閉分頁，觀察：(a) `/auth/callback` 顯示錯誤訊息、(b) 回到 `/account/settings` 時 dialog 不自動打開、(c) pending-delete-reauth flag 在 5 分鐘內若重新打 dialog 選 Google 仍可正常走完流程
