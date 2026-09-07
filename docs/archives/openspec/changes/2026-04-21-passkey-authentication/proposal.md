## Why

v1.0.0 目前唯一的互動式登入路徑是 Google OAuth，對不想或無法使用 Google 帳號的使用者形成硬性門檻。`nuxt.config.ts` 已預埋 `knowledge.features.passkey` feature flag 但從未消費；本變更兌現該旗標，導入 WebAuthn passkey 作為第二條登入路徑，並允許 passkey 與 Google 帳號**雙向綁定**。為了支援「無 email 的 passkey-first 使用者」仍能被 Admin 提拔為 Member，引入**永久不可改的唯一暱稱**作為身分 anchor。

## What Changes

- 新增 dependency `@better-auth/passkey@^1.6.5`（獨立 npm package，不在 better-auth core）；server 用 `passkey()` plugin，client 用 `passkeyClient()`，消費現有 `runtimeConfig.knowledge.features.passkey` feature flag
- **BREAKING**：better-auth `user.email` 欄位改為 nullable（passkey-first 使用者可能完全沒 email），`user_profiles.email_normalized` 同步改為 nullable；既有 unique index 調整為 partial unique（`WHERE email IS NOT NULL`）
- 新增 `user.display_name` 欄位：必填、全系統唯一、**建立後永久不可修改**，作為無 email 使用者的視覺身分 anchor
- 註冊流程：`/` 登入頁新增「使用 Passkey 註冊／登入」按鈕；passkey-first 使用者先填暱稱（即時唯一性檢查）→ 完成 WebAuthn ceremony → 預設角色 `guest`
- 雙向綁定：登入後於「帳號設定」可加綁另一種憑證（passkey ⇆ Google）；綁 Google 後若 email ∈ `ADMIN_EMAIL_ALLOWLIST`，下次 session refresh 自動升 `admin`
- Admin `/admin/members` 列表擴充：顯示暱稱、綁定的 credential 類型（passkey / google / both）、註冊時間、最後活動時間；Admin 可依暱稱辨識並提拔 Member
- 新增環境變數：`NUXT_PASSKEY_RP_ID`、`NUXT_PASSKEY_RP_NAME`（WebAuthn Relying Party 設定）
- 登入失敗時保留 Google fallback 按鈕；passkey-only 帳號支援自刪（需 passkey ceremony reauth）

## Capabilities

### New Capabilities

- `passkey-authentication`：WebAuthn 憑證生命週期管理——註冊、認證、列出、撤銷、雙向綁定政策、feature flag 閘門
- `nickname-identity-anchor`：無 email 使用者的身分 anchor 機制——暱稱欄位唯一性約束、永久不可改語意、註冊前即時衝突檢查

### Modified Capabilities

- `member-and-permission-model`：`user.email` nullable 化；Admin 授權來源維持 `ADMIN_EMAIL_ALLOWLIST`（email-only）；Member 提拔擴充為「以 userId 為 input、暱稱為 UI 辨識」，支援無 email 使用者被提拔
- `admin-member-management-ui`：列表欄位新增暱稱、credential 類型；email 欄位允許顯示「—」（nullable）
- `auth-storage-consistency`：新增 passkey plugin 建立的 `passkey` 表（better-auth 原生 migration）；`user.email` 儲存型別與 nullable 約束

## Impact

- **Schema 變動（Tier 3 review）**：
  - `user.email`：`NOT NULL UNIQUE` → `NULL` + partial unique index
  - `user.display_name`：新欄位 `TEXT NOT NULL UNIQUE`
  - `user_profiles.email_normalized`：`NOT NULL UNIQUE` → `NULL` + partial unique index
  - 新增 `passkey` 表（better-auth plugin 原生 schema）
- **Server**：
  - `server/auth.config.ts`：加 `passkey()` plugin；`deriveRole()` 保持不變（僅 email 路徑會升 admin）；`session.create.before` reconciliation 擴充處理 nullable email
  - `server/api/auth/nickname/check.get.ts`：新增即時暱稱衝突檢查 endpoint
  - `server/utils/member-role-changes.ts`：擴充 `from_email` / `to_email` 欄位允許 NULL
- **Client**：
  - `app/auth.config.ts`：加 `passkeyClient()`
  - `app/pages/index.vue`：signed-out 區塊新增 passkey register/login UI
  - 新增 `app/pages/account/settings.vue`（或類似路徑）供雙向綁定
  - `app/pages/admin/members/index.vue`：欄位擴充
- **Runtime config**：消費 `knowledge.features.passkey` 作為 server plugin 裝載 + UI 顯示的雙重閘門
- **Env vars**：`NUXT_PASSKEY_RP_ID`、`NUXT_PASSKEY_RP_NAME`、`NUXT_KNOWLEDGE_FEATURE_PASSKEY`
- **Specs**：建立 `passkey-authentication`、`nickname-identity-anchor`；修改 `member-and-permission-model`、`admin-member-management-ui`、`auth-storage-consistency`
- **Follow-up（Non-Goal）**：跨帳號自動 merge（同 email 的 passkey 帳號與 Google 帳號）延後到 v1.1；Passkey recovery flow（遺失所有 passkey）由 Admin 手動介入，不自建自助 recovery

## Affected Entity Matrix

### Entity: user

| Dimension       | Values                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Columns touched | `email`（NOT NULL → nullable + partial unique）、新增 `display_name`（NOT NULL UNIQUE、immutable）                              |
| Roles           | anonymous（passkey-first 註冊）、guest、member、admin                                                                           |
| Actions         | register-passkey、login-passkey、link-google、add-passkey、self-delete、nickname-check、admin-promote、admin-demote             |
| States          | empty（首次使用者）、loading（ceremony 進行中）、error（WebAuthn NotAllowedError、暱稱衝突、email 衝突）、success、unauthorized |
| Surfaces        | `/`（登入/註冊）、`/account/settings`（綁定/自刪）、`/admin/members`（管理列表、提拔/降級）                                     |

### Entity: passkey（新表）

| Dimension       | Values                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Columns touched | 全新表，better-auth plugin 原生 schema（credentialID、userId、publicKey、counter、transports…）     |
| Roles           | 擁有者本人（view、revoke）、admin（view list only via `/admin/members`，不可直接操作他人 passkey）  |
| Actions         | create（registration ceremony）、verify（authentication ceremony）、delete（self-deletion cascade） |
| States          | loading、error（rpID 不符、signCount 倒退、credential 不存在）、success                             |
| Surfaces        | `/account/settings` 列表與撤銷、`/` 登入 ceremony、`/admin/members` 僅顯示 credential 類型 badge    |

### Entity: user_profiles

| Dimension       | Values                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Columns touched | `email_normalized` NOT NULL → nullable + partial unique                |
| Roles           | 所有已登入使用者（upsert 發生在 session.create.before reconciliation） |
| Actions         | upsert on session refresh                                              |
| States          | （後端無 UI）                                                          |
| Surfaces        | 無直接 UI，僅透過 query_logs 等 FK 消費                                |

## User Journeys

### Passkey-first 註冊（anonymous → guest）

- **Anonymous visitor** 在 `/` 看到「使用 Passkey 註冊」按鈕 → 點擊 → 輸入暱稱（即時檢查衝突）→ 完成 WebAuthn registration ceremony → 自動登入為 guest → 被導向 `/`（已登入狀態）

### Google-first 註冊加綁 Passkey

- **Google-登入的使用者** 到 `/account/settings` → 點「新增 Passkey」→ 完成 WebAuthn ceremony → 列表顯示新的 passkey → 之後可用 passkey 或 Google 任一方式登入

### Passkey-first 使用者加綁 Google

- **Passkey-登入的使用者**（email = NULL）到 `/account/settings` → 點「綁定 Google 帳號」→ 完成 Google OAuth → `user.email` 更新為 Google email → 若 email ∈ allowlist，下次 refresh 自動升 admin（顯示 banner 通知）→ 帳號資訊區塊顯示 email

### Passkey 登入（既有使用者）

- **既有 passkey 使用者** 在 `/` 看到「使用 Passkey 登入」按鈕 → 點擊 → 裝置彈出系統 passkey selector → 完成 authentication ceremony → 進入登入狀態

### Admin 提拔無 email 使用者為 Member

- **Admin** 到 `/admin/members` → 看到列表中某行 email 欄顯示「—」，暱稱欄顯示「某某某」、credential 欄顯示「Passkey」badge → 依暱稱辨識該使用者 → 點「提拔為 Member」→ 確認 dialog 顯示暱稱（email 欄為「—」）→ 確認後更新成功，列表 refetch

### Passkey-only 使用者自刪帳號

- **Passkey-only 使用者** 到 `/account/settings` → 點「刪除帳號」→ 警示對話框說明後果（不可復原、無 Google 綁定則完全無法登入）→ 點確認 → 重新走一次 WebAuthn ceremony 作為 reauth → 刪除完成 → 導向 `/`（未登入狀態）

### Feature flag 關閉時的降級

- **所有使用者** 若 `NUXT_KNOWLEDGE_FEATURE_PASSKEY=false`：`/` 頁面不渲染 passkey 按鈕、`/account/settings` 不顯示 passkey 管理區塊；既有 passkey session 若還在 KV 有效期內可繼續使用，但下次 reauth 會失敗 → UI 顯示 graceful error 引導改用 Google
