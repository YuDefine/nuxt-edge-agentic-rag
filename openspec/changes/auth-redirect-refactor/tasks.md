## 1. Validator 與 Return-To Util（Return-To Query Param Validation）

- [x] 1.1 [P] TDD 實作 `parseSafeRedirect` 滿足 **Safe Redirect Validator Blocks Open-Redirect Payloads**：新增 `app/utils/auth-return-to.ts` 並先寫 `test/unit/auth-return-to.spec.ts` 覆蓋 exhaustive truth table（合法 3 種：`/admin/documents`、`/account/settings?tab=profile`、`/`；非法 9+ 種：`//evil.com`、`http://evil.com`、`javascript:alert(1)`、`data:text/html`、缺前導 `/`、空字串、null、undefined、超 2048 char）
- [x] 1.2 [P] 實作 **Generic Return-To Storage Handles Cross-Domain OAuth** helpers（`saveGenericReturnTo` / `peekGenericReturnTo` / `consumeGenericReturnTo` / `clearGenericReturnTo`）使用 `auth:return-to` sessionStorage key，SSR 情境 no-op；底層抽共用 `saveReturnTo(key, path)` / `consumeReturnTo(key)` 供 MCP util 未來共用但不強制重構 `mcp-connector-return-to.ts`
- [x] 1.3 在 `auth-return-to.ts` JSDoc 記錄 2048 char 上限與驗證規則（反映 design **Return-To Query Param Validation** 決策），以及 sessionStorage key 分離的原因

## 2. Middleware 與路由組裝（Middleware Redirect URL Composition）

- [ ] 2.1 TDD 改寫 `app/middleware/auth.global.ts` 滿足 **Global Auth Middleware Captures Origin Path**：新增 `test/integration/auth-redirect-flow.spec.ts` 覆蓋四種 case — 未登入打 `/admin/documents` → `/login?redirect=%2Fadmin%2Fdocuments`、未登入打 `/` → `/login`（無 qs）、未登入打 `/login` → 不 redirect、`auth: false` 頁面不攔截
- [ ] 2.2 驗證 **Middleware Redirect URL Composition** 邊界：integration test 覆蓋 `/admin/usage?filter=x` query-string 需要 URL encode 正確、`to.path === '/login'` 不循環、`to.path === '/'` 不附 `redirect` qs
- [ ] 2.3 改寫 `app/middleware/admin.ts` 未登入分支滿足 **Admin Middleware Unauthenticated Branch Mirrors Global Behavior**（對齊 design **admin.ts Middleware 未登入分支對齊** 決策）；無權限分支 `L26-28` **不動**，tasks.md 明確註記為 Non-Goal

## 3. Page Surface 拆分（Login Surface Routing）

- [ ] 3.1 [P] 實作 **Login Route Is Independent And Publicly Accessible**：改寫 `app/pages/auth/login.vue` 為獨立全頁（移除 `navigateTo('/')` 假 redirect），承接原 `app/pages/index.vue` 的 Google login + Passkey login + PasskeyRegisterDialog UI 與 error state；套用 `definePageMeta({ auth: false, layout: 'auth' })`；依 `responsive-and-a11y-foundation` 既有 pattern 保留 responsive + a11y
- [ ] 3.2 依 design **Login Surface Routing** 決策配置 `/login` 的 `auth: false` + `layout: 'auth'` 與 `/` 的 chat layout；確認 `/auth/mcp/authorize` 的 `auth: false` 維持不變
- [ ] 3.3 [P] `/` 改為純 chat 滿足 **Chat Page Access And Navigation**：改寫 `app/pages/index.vue` — 移除 `v-if="!loggedIn"` 登入 UI 分支與相關 handler（`handleGoogleLogin` / `handlePasskeyLogin` / `handleOpenPasskeyRegister` / `handlePasskeyRegistered` / `errorMessage` / `registerDialogOpen` / `socialLoading` / `passkeyLoginLoading`）；移除 `parseAuthError` / `passkeyFeatureEnabled` / `describePasskeyError` 引用；保留 chat + conversation history；`definePageMeta` 改為 `{ layout: 'chat' }`（不設 `auth: false`，由 global middleware 保護）

## 4. OAuth Callback Return-To 消費順序

- [ ] 4.1 改寫 `app/pages/auth/callback.vue` 滿足 **Callback Page Consumes Return-To In Priority Order**：consume 順序 `consumeMcpConnectorReturnTo()` → `consumeGenericReturnTo()` → fallback `/`；generic 路徑先經 `parseSafeRedirect` 驗證；寫 integration test 覆蓋三種 priority case（MCP wins / generic only / neither）
- [ ] 4.2 在 `/login` Google login handler 實作 **Cross-Domain Return-To Bridge（Google OAuth）**：按下 Google 按鈕時同步呼叫 `saveGenericReturnTo(parseSafeRedirect(route.query.redirect) ?? '')`（空字串視為無效，不寫 sessionStorage）再 `signIn.social({ provider: 'google' })`；驗證跨 domain 往返後能由 callback 讀到

## 5. Passkey 同 origin redirect 流程

- [ ] 5.1 在 `/login` Passkey login handler 實作 **Passkey Same-Origin Flow Reads Redirect From Query**（design **`/login` 頁的 Passkey 成功流程** 決策）：`signIn.passkey` 成功且 `fetchSession({ force: true })` 後，讀 `route.query.redirect` → `parseSafeRedirect` → `navigateTo(safe ?? '/', { replace: true })`；**不**寫 sessionStorage；寫 unit + integration test 覆蓋合法 redirect、unsafe redirect fallback、無 redirect 三種 case

## 6. Design Review

- [ ] 6.1 檢查 `.impeccable.md` 是否存在，若無則執行 `/impeccable teach`
- [ ] 6.2 執行 `/design improve app/pages/auth/login.vue app/pages/index.vue`（含 Design Fidelity Report）
- [ ] 6.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [ ] 6.4 依 `/design` 計劃按 canonical order 執行 targeted design skills
- [ ] 6.4.1 響應式 viewport 測試（xs 360 / md 768 / xl 1280 截圖並人工核對 `/login` 與 `/`）
- [ ] 6.4.2 無障礙檢查（@nuxt/a11y dev report 無 error + 鍵盤 Tab / Esc walkthrough `/login` 所有互動元素）
- [ ] 6.5 執行 `/audit app/pages/auth/login.vue app/pages/index.vue` — 確認 Critical = 0
- [ ] 6.6 執行 `review-screenshot` — 視覺 QA 截圖歸檔到 `screenshots/local/auth-redirect-refactor/`
- [ ] 6.7 Fidelity 確認 — `design-review.md` 中無 DRIFT 項

## 7. 人工檢查

- [ ] 7.1 使用者本人瀏覽器實測 Generic page recovery（Google OAuth）journey：未登入打 `/admin/documents` → 跳 `/login?redirect=%2Fadmin%2Fdocuments` → Google 登入 → 回到 `/admin/documents`
- [ ] 7.2 使用者本人瀏覽器實測 Generic page recovery（Passkey）journey：未登入打 `/account/settings` → 跳 `/login?redirect=%2Faccount%2Fsettings` → Passkey 登入 → 回到 `/account/settings`
- [ ] 7.3 使用者本人瀏覽器實測 **Chat Page Access And Navigation** 拆分後行為：未登入打 `/` → 跳 `/login`（無 qs）；登入後 `/` 顯示 chat；Network tab 確認**未登入狀態 0 個** `/api/conversations` 請求
- [ ] 7.4 使用者本人瀏覽器實測 MCP connector first-time authorization journey（必不回歸）：在 Claude.ai 發起 connector 連接 → 被導去 `/auth/mcp/authorize?...` → 點 Google 登入 → OAuth 完成 → **必須回到 `/auth/mcp/authorize`**（不能停留在 `/` 或 `/login`）→ 點授權 → 回到 Claude.ai
- [ ] 7.5 使用者本人瀏覽器實測 Open-redirect rejection：手動構造 `/login?redirect=//evil.com`、`?redirect=http://evil.com`、`?redirect=javascript:alert(1)` 三種 payload，登入成功後皆應 fallback 到 `/` 而非跳外站
- [ ] 7.6 Legacy `/chat` 路由仍 redirect 到 `/`（`app/pages/chat/index.vue` 維持不動）
