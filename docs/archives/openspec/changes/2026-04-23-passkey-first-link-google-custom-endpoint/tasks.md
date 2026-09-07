## 1. 前置準備（Ops + 依賴）

- [x] 1.1 確認 `fk-cascade-repair-for-self-delete`（TD-011）migration 0010 已 apply 到 production D1，才可啟動本 change 的 apply 階段 `@followup[TD-012]`
- [x] 1.2 Ops 在 Google Cloud Console（local 與 production 各一）的 OAuth 2.0 Client「Authorized redirect URIs」加入 `<origin>/api/auth/account/link-google-for-passkey-first/callback`，驗證設定已生效 `@followup[TD-012]`
- [x] 1.3 確認既有 `KV` binding 可用於寫入 `oauth-link-state:*` 前綴的 one-time state entries（本 change 不新增 binding）`@followup[TD-012]`

## 2. Server：新增 Link Endpoint Initiator（Bidirectional Credential Binding Under Authenticated Session）

- [x] 2.1 [P] 為 Bidirectional Credential Binding Under Authenticated Session 建立 `server/api/auth/account/link-google-for-passkey-first/index.get.ts` 骨架：`useLogger(event)` 第一行、`requireUserSession` 取 user id 與 email，依 Error Code 對照表對 `session.user.email !== null` 回 400 `INVALID_ENTRY_STATE`、未登入回 401 `@followup[TD-012]`
- [x] 2.2 實作 State Payload 結構：以 `crypto.getRandomValues` 產 32-byte base64url state token，序列化 `{ userId, nonce, createdAt, redirectOrigin }` 寫入 KV key `oauth-link-state:<token>`，TTL 600 秒 `@followup[TD-012]`
- [x] 2.3 依 OAuth State 儲存：Cookie + KV 雙層決策，寫入 `__Host-oauth-link-state` HttpOnly / Secure / SameSite=Lax cookie（值即 state token），Max-Age 600 `@followup[TD-012]`
- [x] 2.4 組 Google authorization URL（`client_id`、`redirect_uri`、`response_type=code`、`scope=openid email profile`、`access_type=offline`、`prompt=consent`、`state=<token>`），回傳 302 redirect `@followup[TD-012]`
- [x] 2.5 [P] 撰寫 unit test `test/unit/link-google-for-passkey-first-initiator.test.ts` 覆蓋 state 產生、cookie 設定、email 非 NULL 拒絕路徑 `@followup[TD-012]`

## 3. Server：新增 Link Endpoint Callback（Bidirectional Credential Binding Under Authenticated Session）

- [x] 3.1 建立 `server/api/auth/account/link-google-for-passkey-first/callback.get.ts` 骨架：`useLogger(event)` 第一行、`requireUserSession`、依 Error Code 對照表處理 Zod 驗 `code` / `state` query 缺失情境 `@followup[TD-012]`
- [x] 3.2 實作 state 驗證三連：cookie 比對 state → KV 讀取（讀後立即 delete 達成 one-time）→ KV payload `userId` 比對 session，分別對應 `STATE_MISMATCH` 401 / `STATE_EXPIRED` 401 / `SESSION_MISMATCH` 401，三條皆不 `log.error` `@followup[TD-012]`
- [x] 3.3 依 id_token 驗證策略實作 token exchange：`fetch('https://oauth2.googleapis.com/token', ...)` 交換 `code`，非 2xx → 502 `GOOGLE_TOKEN_EXCHANGE` + `log.error` `@followup[TD-012]`
- [x] 3.4 解析 id_token payload（base64url JWT payload decode），驗 `iss === 'https://accounts.google.com'` 且 `aud === runtimeConfig.oauth.google.clientId`，否則 502 `GOOGLE_ID_TOKEN_INVALID` + `log.error`；檢查 `email_verified === true`，否則 400 `EMAIL_NOT_VERIFIED` `@followup[TD-012]`
- [x] 3.5 實作 Email Collision 檢測：`SELECT id FROM user WHERE email = ? AND id != ? LIMIT 1`；若有 row → redirect `/account/settings?linkError=EMAIL_ALREADY_LINKED`（狀態 302），不寫入 DB `@followup[TD-012]`
- [x] 3.6 依 DB 寫入：User UPDATE + Account INSERT 交易性實作 Google link write path；statement 1 更新 `user.email` / `user.image` / `user.updatedAt`；statement 2 INSERT `account` row（providerId='google', accountId=id_token.sub, accessToken, refreshToken, idToken, scope, createdAt=updatedAt=now ms integer），交易失敗 → 500 `DB_WRITE_FAILED` + `log.error` `@followup[TD-012]`
- [x] 3.7 成功寫入後 redirect `/account/settings?linked=google` `@followup[TD-012]`
- [x] 3.8 [P] Endpoint 中央對齊 Error Code 對照表：集中定義 `LinkErrorCode` const union + `switch + assertNever` 產錯誤訊息，遵守 `.claude/rules/development.md` Exhaustiveness Rule `@followup[TD-012]`

## 4. Client：UI 分流策略（Bidirectional Credential Binding Under Authenticated Session）

- [x] 4.1 修改 `app/pages/account/settings.vue` 的 `handleLinkGoogle`：依 `credentials.email === null` 分流——passkey-first `window.location.href = '/api/auth/account/link-google-for-passkey-first'`；其他情境保留 `client.linkSocial({ provider: 'google' })`。移除當前的 disable state 與「開發中」alert `@followup[TD-012]`
- [x] 4.2 在 `settings.vue` `onMounted` / `useRoute` watch `?linked=google`：顯示 success feedback alert、強制 `await refreshCredentials()` 從 `/api/auth/me/credentials` 取新 email/hasGoogle，並從 URL 清除 query（`navigateTo` replace） `@followup[TD-012]`
- [x] 4.3 在 `settings.vue` watch `?linkError=<code>`：依 Error Code 對照表對應使用者訊息（`EMAIL_ALREADY_LINKED` / `EMAIL_NOT_VERIFIED` / `GOOGLE_TOKEN_EXCHANGE` / `GOOGLE_ID_TOKEN_INVALID` / `DB_WRITE_FAILED` 等）顯示頁內 error feedback alert，並清除 query `@followup[TD-012]`
- [x] 4.4 確認按鈕 loading、disabled、error、success 四種 state 視覺正確（UX Completeness State Coverage Rule）`@followup[TD-012]`

## 5. Server：Timestamp Affinity 對齊（Custom Google Link Endpoint Writes Match Drizzle Timestamp Affinity）

- [x] 5.1 為 Custom Google Link Endpoint Writes Match Drizzle Timestamp Affinity 的 DB 寫入：User UPDATE + Account INSERT 交易性，確認所有 timestamp 欄位（`user.updatedAt` / `account.createdAt` / `account.updatedAt`）以 `Date.now()` 產生 integer ms，並透過 Drizzle `timestamp_ms` 模式寫入，取得 D1 INTEGER affinity `@followup[TD-012]`
- [x] 5.2 [P] 撰寫 affinity 檢查 test（整合進 test 5.3 或獨立）：綁定成功後 `SELECT typeof(createdAt) FROM account WHERE userId = ? AND providerId='google'` 回 `'integer'` `@followup[TD-012]`

## 6. 測試

- [x] 6.1 [P] 撰寫 `test/integration/passkey-first-link-google.spec.ts`：happy path — passkey-first user 呼叫 initiator → mock Google token endpoint 回合法 id_token → callback 完成後 `user.email` 與 `account` row 狀態正確、passkey row 保留 `@followup[TD-012]`
- [x] 6.2 [P] 測試 Email Collision 檢測：預先建立另一 user 持有目標 email → 綁定流程 redirect `?linkError=EMAIL_ALREADY_LINKED`、目標 user.email 仍 NULL、無新 account row `@followup[TD-012]`
- [x] 6.3 [P] 測試 allowlist reconciliation：目標 email 在 `ADMIN_EMAIL_ALLOWLIST` → 綁定成功 → 模擬下次 session refresh → `user.role` 升 admin + audit row `reason='allowlist-seed'` `@followup[TD-012]`
- [x] 6.4 [P] 測試 State Payload 結構 / state 驗證三連：cookie mismatch → 401 STATE_MISMATCH；KV missing → 401 STATE_EXPIRED；KV userId mismatch → 401 SESSION_MISMATCH `@followup[TD-012]`
- [x] 6.5 [P] 測試 id_token 驗證策略 失敗分支：`email_verified=false` → 400 EMAIL_NOT_VERIFIED；`iss/aud` 錯誤 → 502 GOOGLE_ID_TOKEN_INVALID；token endpoint 非 2xx → 502 GOOGLE_TOKEN_EXCHANGE `@followup[TD-012]`

## 7. Tier 3 Review（Auth Endpoint + OAuth State）

- [x] 7.1 執行 `spectra audit` skill 對新 endpoint 進行安全審查（`.claude/rules/review-tiers.md` Tier 3 要求）`@followup[TD-012]`
- [x] 7.2 派遣 `code-review` agent 檢視 OAuth state + token exchange + DB 寫入路徑（session safety / CSRF / replay / FK / log sanitization）`@followup[TD-012]`
- [x] 7.3 修復 audit + code-review 發現的 Critical / Warning 問題 `@followup[TD-012]`

## 8. Design Review

- [x] 8.1 檢查 `.impeccable.md` 是否存在，若無則執行 `/impeccable teach` `@followup[TD-012]`
- [x] 8.2 執行 `/design improve app/pages/account/settings.vue`（含 Design Fidelity Report）`@followup[TD-012]`
- [x] 8.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）`@followup[TD-012]`
- [x] 8.4 依 `/design` 計劃按 canonical order 執行 targeted skills `@followup[TD-012]`
- [x] 8.4.1 響應式 viewport 測試（xs 360 / md 768 / xl 1280 截圖並人工核對 settings 頁綁定 button 與 toast）`@followup[TD-012]`
- [x] 8.4.2 無障礙檢查（`@nuxt/a11y` dev report 無 error + 鍵盤 Tab / Esc walkthrough button 與 feedback alert）`@followup[TD-012]`
- [x] 8.5 執行 `/audit` — 確認 Critical = 0 `@followup[TD-012]`
- [x] 8.6 執行 `review-screenshot` — 視覺 QA（含 loaded / linked=google success feedback / linkError 各變體）`@followup[TD-012]`
- [x] 8.7 Fidelity 確認 — `design-review.md` 中無 DRIFT 項 `@followup[TD-012]`

## 9. 人工檢查

> **NEVER** 自行勾選本區塊任何項；須 review-screenshot 截圖 + 使用者確認後才可標記完成（`.claude/rules/manual-review.md`）。

- [x] 9.1 local `pnpm dev` — passkey-first 帳號（email=NULL）在 `/account/settings` 點「綁定 Google 帳號」→ OAuth 走通 → 回到 settings 頁顯示 success feedback + email 與 Google badge 正確呈現
- [x] 9.2 local `pnpm dev` — 第二組 Google 帳號（email 已屬他人）→ 觸發 EMAIL_ALREADY_LINKED → error feedback 顯示正確文案、綁定狀態未變
- [x] 9.3 local `pnpm dev` — 綁定 Google email 在 `ADMIN_EMAIL_ALLOWLIST` → 下次 session refresh（登出再登入或等待 refresh）→ role badge 變為 admin、audit log 出現 `reason='allowlist-seed'`
- [x] 9.4 local `pnpm dev` — 手動在瀏覽器 DevTools 刪 `__Host-oauth-link-state` cookie 後造訪 callback → 顯示 STATE_MISMATCH error feedback
- [x] 9.5 production smoke（TD-011 migration 落地後）— passkey-first 新帳號綁 Google → 結果與 local 一致
- [x] 9.6 response UI 檢查（xs / md / xl）— 綁定按鈕、success feedback、error feedback 各 viewport 視覺無破版
