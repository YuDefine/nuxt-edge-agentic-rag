## Why

passkey-first 使用者（`user.email = NULL`）目前**無法**透過 `/account/settings` 綁定 Google 帳號：better-auth 的 `linkSocial` endpoint 在建構 OAuth state 時會把 `session.user.email` 塞進 `link.email` 並以 Zod 驗證必須是 string，`null` 直接讓 state parse 失敗，OAuth callback 回 `please_restart_the_process`。此行為寫死在 better-auth core（`node_modules/better-auth/dist/api/routes/account.mjs` 約 line 148 的 `parseGenericState`），無法用 `allowDifferentEmails: true` 之類 config 繞過（config 在 parse 之後才套用）。

結果：`passkey-authentication` §6.2 的 Scenario「Passkey-first user binds Google and email gets populated」實際不能運作；目前 `/account/settings` 的 Google 綁定按鈕為 passkey-first 使用者 disable + 顯示「開發中」alert 作為 workaround（詳見 TD-012）。本 change 自建 OAuth endpoint pair 繞開 better-auth linkSocial，恢復這條路徑。

## What Changes

- **新增** `GET /api/auth/account/link-google-for-passkey-first` — 驗證 `session.user.email === null` → 建 OAuth state（cookie + KV 雙層，state 綁 `session.user.id`） → redirect 到 Google authorization URL（重用既有 `NUXT_OAUTH_GOOGLE_CLIENT_ID` / redirect_uri 設定）。
- **新增** `GET /api/auth/account/link-google-for-passkey-first/callback` — 驗證自家 state（cookie ↔ KV 比對，過期或不合即 401） → `code` 換 access_token + id_token（直接 fetch `https://oauth2.googleapis.com/token`） → 解 id_token 拿 `email` / `name` / `image` → **email collision 檢查**（若同 email 已綁到其他 `user.id` 回 HTTP 409 `EMAIL_ALREADY_LINKED`） → `UPDATE "user" SET email/image WHERE id = <session.user.id>` + `INSERT INTO account (providerId='google', accountId, accessToken, idToken, refreshToken, scope, createdAt, updatedAt)`（對齊 better-auth schema） → redirect 回 `/account/settings?linked=google`。
- **修改** `app/pages/account/settings.vue` 的 `handleLinkGoogle`：依 `credentials.email === null` 分流——passkey-first 走新 endpoint，Google-first 加綁（若未來有此情境）仍走 better-auth `client.linkSocial`。同時**移除**現在的 disable state 與「開發中」alert，callback feedback 改為頁內 alert 以避開 toaster 的 a11y warning。
- **新增** integration test `test/integration/passkey-first-link-google.spec.ts`：happy path（綁定成功 → email 填入 + account row 建立 + passkey 保留） + 409 collision + allowlist upgrade（email 在 `ADMIN_EMAIL_ALLOWLIST` → 下次 session refresh 由 `session.create.before` 升 admin + audit `reason='allowlist-seed'`）。
- **修改** spec `passkey-authentication` §6.2 Scenario「Passkey-first user binds Google and email gets populated」：從隱含 `linkSocial` 改為明確走 custom endpoint；新增 Scenario「Google email collision is rejected with 409 via custom endpoint」對齊 §6.3 但指向新 endpoint。
- **修改** spec `auth-storage-consistency`：若新 endpoint 寫入 `account` 表的 timestamp 欄位，必須與既有 `timestamp_ms` affinity 契約一致（本 change 只補 requirement，不新增 migration）。

## Non-Goals

- **NEVER** 擴散到 Google-first 加綁 passkey 路徑（§6.1，已由 better-auth `passkey` plugin 原生支援、已完成）。
- **NEVER** 修改 better-auth 的 `linkSocial` 或 core source code；本 change 是**繞過**而非「修好 better-auth」。
- **NEVER** 在此 change 內變更 `ADMIN_EMAIL_ALLOWLIST` 機制或 `session.create.before` 邏輯——本 change 只保證新綁定的 email 會進入既有 reconciliation 流程，不重寫 reconciliation。
- 不處理 Google account unlink / 切換 Google 帳號（超出 TD-012 scope；如有需求另開 change）。
- 不引入 PKCE（OAuth 2.0 `code_verifier`）：Google client secret 走 confidential client（Workers 伺服器端），state + one-time KV entry 已足以防 CSRF。未來若擴展到 public client 再評估。
- **不**改動既有 TD-011（passkey-only user 自刪 FK cascade）— 本 change apply 需依賴 TD-011 migration 0010 落地到 prod，但不碰 TD-011 artifacts。

## 依賴宣告

- **Blocked by**: `fk-cascade-repair-for-self-delete`（TD-011）migration 0010 必須先 apply 到 production，避免綁定過程若觸發 session refresh + audit tombstone 寫入時踩到 FK constraint。建議 apply 順序：TD-011 archive → 本 change apply。
- **不涉及**新 D1 migration（只動 `user` / `account` 表，schema 已存在）；因此與其他 migration change **無 mutex**。
- KV namespace 重用既有 `KV`（若尚未綁定 one-time state，用 prefix `oauth-link-state:` + TTL 600s，無新 binding）。

## Capabilities

### New Capabilities

（無——此 change 在現有 capability 底下擴充實作路徑，不新增 capability）

### Modified Capabilities

- `passkey-authentication`: §6.2 Scenario「Passkey-first user binds Google and email gets populated」的實作路徑改為 custom endpoint；新增 Scenario 明確描述 email collision 由 custom endpoint 回 409（原 §6.3 仍成立，但收斂到新路徑）。
- `auth-storage-consistency`: 補充 requirement 說明 custom endpoint 寫入 `account` 表的 timestamp 欄位必須遵守 `timestamp_ms` affinity 契約。

## Impact

- **Affected specs**:
  - `openspec/specs/passkey-authentication/spec.md` §6.2 / §6.3 對應 Requirement
  - `openspec/specs/auth-storage-consistency/spec.md`
- **Affected code**:
  - `server/api/auth/account/link-google-for-passkey-first/index.get.ts`（**new**）
  - `server/api/auth/account/link-google-for-passkey-first/callback.get.ts`（**new**）
  - `app/pages/account/settings.vue`（修改 `handleLinkGoogle` 分流；移除 disable + 「開發中」alert）
  - `test/integration/passkey-first-link-google.spec.ts`（**new**）
- **Reference only（不修改）**:
  - `server/auth.config.ts`（既有 `databaseHooks.session.create.before` 已處理 allowlist reconciliation，新 endpoint 寫 email 即可觸發）
  - `server/api/auth/me/credentials.get.ts`（UI `credentials.email === null` 判斷已存在）
  - `node_modules/better-auth/dist/api/routes/account.mjs` line ~148（限制來源 reference）
- **Environment bindings**（全部重用，無新增）:
  - `NUXT_OAUTH_GOOGLE_CLIENT_ID` / `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`
  - Google OAuth redirect_uri（新 endpoint 使用不同 callback path）— 需在 Google Cloud Console authorized redirect URIs 補 `<origin>/api/auth/account/link-google-for-passkey-first/callback`（ops 需配合）
  - `KV`（重用既有 binding，prefix `oauth-link-state:`）
- **UI surface 影響**:
  - `/account/settings`「綁定 Google 帳號」按鈕：passkey-first 從 disable 變 active；新增 409 error feedback；綁定成功返回後顯示 email + Google badge（依 `credentials.email` reactive 更新）
- **Runtime**: Cloudflare Workers（Web Standard `fetch`，無 Node.js-only API，CPU 時間 < 1s），遵守 `.claude/rules/api-patterns.md`。
- **Review tier**: Tier 3（auth endpoint + OAuth state handling + DB mutation），需 `spectra-audit` + `code-review` agent。
