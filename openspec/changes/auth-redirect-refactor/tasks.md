## 1. Validator 與 Return-To Util（Return-To Query Param Validation）

- [x] 1.1 [P] TDD 實作 `parseSafeRedirect` 滿足 **Safe Redirect Validator Blocks Open-Redirect Payloads**：新增 `app/utils/auth-return-to.ts` 並先寫 `test/unit/auth-return-to.spec.ts` 覆蓋 exhaustive truth table（合法 3 種：`/admin/documents`、`/account/settings?tab=profile`、`/`；非法 9+ 種：`//evil.com`、`http://evil.com`、`javascript:alert(1)`、`data:text/html`、缺前導 `/`、空字串、null、undefined、超 2048 char）
- [x] 1.2 [P] 實作 **Generic Return-To Storage Handles Cross-Domain OAuth** helpers（`saveGenericReturnTo` / `peekGenericReturnTo` / `consumeGenericReturnTo` / `clearGenericReturnTo`）使用 `auth:return-to` sessionStorage key，SSR 情境 no-op；底層抽共用 `saveReturnTo(key, path)` / `consumeReturnTo(key)` 供 MCP util 未來共用但不強制重構 `mcp-connector-return-to.ts`
- [x] 1.3 在 `auth-return-to.ts` JSDoc 記錄 2048 char 上限與驗證規則（反映 design **Return-To Query Param Validation** 決策），以及 sessionStorage key 分離的原因

## 2. Middleware 與路由組裝（Middleware Redirect URL Composition）

- [x] 2.1 TDD 改寫 `app/middleware/auth.global.ts` 滿足 **Global Auth Middleware Captures Origin Path**：新增 `test/integration/auth-redirect-flow.spec.ts` 覆蓋四種 case — 未登入打 `/admin/documents` → `/auth/login?redirect=%2Fadmin%2Fdocuments`、未登入打 `/` → `/auth/login`（無 qs）、未登入打 `/auth/login` → 不 redirect、`auth: false` 頁面不攔截
- [x] 2.2 驗證 **Middleware Redirect URL Composition** 邊界：integration test 覆蓋 `/admin/usage?filter=x` query-string 需要 URL encode 正確、`to.path === '/auth/login'` 不循環、`to.path === '/'` 不附 `redirect` qs
- [x] 2.3 改寫 `app/middleware/admin.ts` 未登入分支滿足 **Admin Middleware Unauthenticated Branch Mirrors Global Behavior**（對齊 design **admin.ts Middleware 未登入分支對齊** 決策）；無權限分支 `L26-28` **不動**，tasks.md 明確註記為 Non-Goal

## 3. Page Surface 拆分（Login Surface Routing）

- [x] 3.1 [P] 實作 **Login Route Is Independent And Publicly Accessible**：改寫 `app/pages/auth/login.vue` 為獨立全頁（移除 `navigateTo('/')` 假 redirect），承接原 `app/pages/index.vue` 的 Google login + Passkey login + PasskeyRegisterDialog UI 與 error state；套用 `definePageMeta({ auth: false, layout: 'auth' })`；依 `responsive-and-a11y-foundation` 既有 pattern 保留 responsive + a11y
- [x] 3.2 依 design **Login Surface Routing** 決策配置 `/auth/login` 的 `auth: false` + `layout: 'auth'` 與 `/` 的 chat layout；確認 `/auth/mcp/authorize` 的 `auth: false` 維持不變
- [x] 3.3 [P] `/` 改為純 chat 滿足 **Chat Page Access And Navigation**：改寫 `app/pages/index.vue` — 移除 `v-if="!loggedIn"` 登入 UI 分支與相關 handler（`handleGoogleLogin` / `handlePasskeyLogin` / `handleOpenPasskeyRegister` / `handlePasskeyRegistered` / `errorMessage` / `registerDialogOpen` / `socialLoading` / `passkeyLoginLoading`）；移除 `parseAuthError` / `passkeyFeatureEnabled` / `describePasskeyError` 引用；保留 chat + conversation history；`definePageMeta` 改為 `{ layout: 'chat' }`（不設 `auth: false`，由 global middleware 保護）

## 3.A Logout Flow Redirects To /auth/login

- [x] 3.A.1 登出 redirect target 從 `/` 改為 `/auth/login`，且 **layout 登出 flow 必須用 full page reload**（`window.location.replace('/auth/login')`）而非 SPA `navigateTo`。影響檔案：`app/layouts/chat.vue` `handleSignOut`、`app/layouts/default.vue` `handleSignOut`、`app/components/auth/DeleteAccountDialog.vue` `redirectToSignedOutHome`。理由：(1) `/` 現在純 chat + 需登入；(2) nanostore session atom 在 `signOut()` 後滯後一 tick，SPA navigate 到 `/auth/login` 會被 3.A.2 的 middleware bounce（`loggedIn && path===/auth/login → /`）誤判命中 stale `true` 狀態，把使用者踢回原 `/` 頁（`replace: true` 造成 same-route no-op，看起來「按鈕失效」）。full reload 同時重置 SPA state 與 atom，middleware 下次看到 `loggedIn=false` 即正確渲染 login UI
- [x] 3.A.2 `auth.global.ts` 加「已登入打 `/auth/login` 反向踢回 `/`」分支。理由：`/auth/login` 是 `auth: false` 頁，middleware 原本只攔未登入分支 → 已登入使用者手動貼 `/auth/login` 會看到無用的登入 UI。`?redirect=` query 刻意忽略（攻擊面考量）

## 4. OAuth Callback Return-To 消費順序

- [x] 4.1 改寫 `app/pages/auth/callback.vue` 滿足 **Callback Page Consumes Return-To In Priority Order**：consume 順序 `consumeMcpConnectorReturnTo()` → `consumeGenericReturnTo()` → fallback `/`；generic 路徑先經 `parseSafeRedirect` 驗證；寫 integration test 覆蓋三種 priority case（MCP wins / generic only / neither）。**fallback 必填** — `resolveReturnToPath()` 回 null 時 callback.vue 仍必須 `navigateTo('/')`，否則使用者會卡在 loading UI（design.md consume order step 3）
- [x] 4.2 在 `/auth/login` Google login handler 實作 **Cross-Domain Return-To Bridge（Google OAuth）**：按下 Google 按鈕時同步呼叫 `saveGenericReturnTo(parseSafeRedirect(route.query.redirect) ?? '')`（空字串視為無效，不寫 sessionStorage）再 `signIn.social({ provider: 'google', callbackURL: '/auth/callback' })`；**callbackURL 必填** — 未指定時 better-auth 會預設回 `/` 而非 `/auth/callback`，sessionStorage bridge 就永遠不會被消費。`/auth/mcp/authorize` 的 Google login 同此要求。驗證跨 domain 往返後能由 callback 讀到

## 5. Passkey 同 origin redirect 流程

- [x] 5.1 在 `/auth/login` Passkey login handler 實作 **Passkey Same-Origin Flow Reads Redirect From Query**（design **`/auth/login` 頁的 Passkey 成功流程** 決策）：`signIn.passkey` 成功且 `fetchSession({ force: true })` 後，讀 `route.query.redirect` → `parseSafeRedirect` → `navigateTo(safe ?? '/', { replace: true })`；**不**寫 sessionStorage；寫 unit + integration test 覆蓋合法 redirect、unsafe redirect fallback、無 redirect 三種 case
- [x] 5.2 `/auth/login` `handlePasskeyRegistered` 對稱 `handlePasskeyLogin` 補 post-success navigate：讀 `route.query.redirect` → `parseSafeRedirect` → `navigateTo(safe ?? '/', { replace: true })`。理由：`PasskeyRegisterDialog` 註冊成功已 notify `$sessionSignal` + `fetchSession({ force: true })`，使用者應立即進入系統。原實作只清 error message 依賴「下次 navigation」被 middleware 踢走，但使用者並不會主動 navigate → 停在 login UI 看起來像沒登入

## 6. Design Review

- [x] 6.1 檢查 `.impeccable.md` 是否存在，若無則執行 `/impeccable teach`
- [x] 6.2 執行 `/design improve app/pages/auth/login.vue app/pages/index.vue`（含 Design Fidelity Report）
- [x] 6.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [x] 6.4 依 `/design` 計劃按 canonical order 執行 targeted design skills
- [x] 6.4.1 響應式 viewport 測試（xs 360 / md 768 / xl 1280 截圖並人工核對 `/auth/login` 與 `/`）
- [x] 6.4.2 無障礙檢查（@nuxt/a11y dev report 無 error + 鍵盤 Tab / Esc walkthrough `/auth/login` 所有互動元素）
- [x] 6.5 執行 `/audit app/pages/auth/login.vue app/pages/index.vue` — 確認 Critical = 0
- [x] 6.6 執行 `review-screenshot` — 視覺 QA 截圖歸檔到 `screenshots/local/auth-redirect-refactor/`
- [x] 6.7 Fidelity 確認 — `design-review.md` 中無 DRIFT 項

## 7. 人工檢查

- [x] 7.1 使用者本人瀏覽器實測 Generic page recovery（Google OAuth）journey：未登入打 `/admin/documents` → 跳 `/auth/login?redirect=%2Fadmin%2Fdocuments` → Google 登入 → 回到 `/admin/documents`
- [x] 7.2 使用者本人瀏覽器實測 Generic page recovery（Passkey）journey：未登入打 `/account/settings` → 跳 `/auth/login?redirect=%2Faccount%2Fsettings` → Passkey 登入 → 回到 `/account/settings`
- [x] 7.3 使用者本人瀏覽器實測 **Chat Page Access And Navigation** 拆分後行為：未登入打 `/` → 跳 `/auth/login`（無 qs）；登入後 `/` 顯示 chat；Network tab 確認**未登入狀態 0 個** `/api/conversations` 請求
- [x] 7.4 使用者本人瀏覽器實測 MCP connector first-time authorization journey（必不回歸）：在 Claude.ai 發起 connector 連接 → 被導去 `/auth/mcp/authorize?...` → 點 Google 登入 → OAuth 完成 → **必須回到 `/auth/mcp/authorize`**（不能停留在 `/` 或 `/auth/login`）→ 點授權 → 回到 Claude.ai。**@followup[TD-027]** local dev 無法被 claude.ai 直接連到，本項延後至 staging/production 部署後驗證
- [x] 7.5 使用者本人瀏覽器實測 Open-redirect rejection：手動構造 `/auth/login?redirect=//evil.com`、`?redirect=http://evil.com`、`?redirect=javascript:alert(1)` 三種 payload，登入成功後皆應 fallback 到 `/` 而非跳外站
- [x] 7.6 Legacy `/chat` 路由仍 redirect 到 `/`（`app/pages/chat/index.vue` 維持不動）。已知未登入情境下 auth middleware 先攔截 → `/auth/login?redirect=/chat`，登入後才回 `/chat` 再 redirect 到 `/`（多一跳，功能安全）。驗收：(a) 已登入打 `/chat` → 最終停在 `/`；(b) 未登入打 `/chat` → 登入後最終停在 `/`（不是停在 `/chat`）
