## Context

v1.0.0 唯一的互動式登入方式是 Google OAuth。`nuxt.config.ts:63` 已預埋 `knowledge.features.passkey` feature flag 但從未被任何代碼消費；v1.0 spec（`server/auth.config.ts:32-34`）明確記載「Google OAuth is the only interactive login path」。

當前授權模型（B16 三級角色，`member-and-permission-model` spec）關鍵依賴：

- `user.email` 是 **NOT NULL UNIQUE**（better-auth 原生 schema + 本專案 drizzle 宣告）
- `deriveRole(email)` 以 email 比對 `ADMIN_EMAIL_ALLOWLIST` 決定角色
- `user_profiles.emailNormalized` 是 **NOT NULL UNIQUE**，`session.create.before` 以 email 為 upsert key
- Admin UI `/admin/members` 以 email 作為辨識欄位

若直接加 passkey 而不處理 email 欄位，passkey-first 使用者會被迫填寫 pseudo email，污染 allowlist 比對與 `user_profiles` 語意。本設計採取**徹底 nullable email + 引入 nickname 身分 anchor** 的路線。

## Goals / Non-Goals

**Goals：**

- 導入 better-auth `passkey` plugin 作為第二條互動式登入路徑
- 支援 passkey-first 註冊（完全無 email）、Google-first 加綁 passkey、passkey-first 加綁 Google 三條流程
- 以永久不可改的唯一暱稱作為無 email 使用者的身分 anchor，讓 Admin 能辨識並提拔為 Member
- 維持 `ADMIN_EMAIL_ALLOWLIST` 作為 Admin 授權的唯一來源（不因 passkey 而放寬）
- 以既有 `knowledge.features.passkey` feature flag 作為 server plugin + UI 的雙重閘門
- 保留 Google 按鈕作為 passkey 失敗時的 fallback

**Non-Goals：**

- **跨帳號 auto-merge**：若使用者先用 passkey 建了帳號 X，之後用 Google（相同 email）建了帳號 Y，系統**不自動** merge，v1.1 再處理
- **自助 recovery**：使用者遺失所有 passkey 且未綁 Google 時，只能由 Admin 手動介入重置；不建 email-based recovery / 其他恢復途徑（與 passkey-first 無 email 的前提一致）
- **暱稱修改**：暱稱一經建立永久不可改；不提供 cooldown、別名、曾用名列表
- **Email verification**：passkey-first 使用者不強制驗證 email（因為根本沒填 email）；若事後加綁 Google，信任 Google OAuth 已驗證
- **MCP token 相關變動**：本 change 不觸及 MCP 認證路徑

## Decisions

### Decision 1: Use better-auth official `passkey` plugin instead of self-implemented WebAuthn

**選擇**：`@better-auth/passkey@^1.6.5` 獨立 package（不在 better-auth core）。

- Server：`import { passkey } from '@better-auth/passkey'`
- Client：`import { passkeyClient } from '@better-auth/passkey/client'`
- peerDep: `better-auth ^1.6.5`（本專案已安裝 1.6.5，相容）

**理由**：官方 plugin 已封裝 challenge store（走 better-auth secondary storage，本專案已啟用 KV）、signCount tracking、credential revocation、`/api/auth/passkey/*` endpoints。自建需另起 `@simplewebauthn/server` + challenge table + endpoints，工作量至少 3-5 倍且無額外收益。

**踩坑紀錄**：passkey 是**獨立 npm package `@better-auth/passkey`**，不在 better-auth core `./plugins/*` export 清單中；`import { passkey } from 'better-auth/plugins'` 會失敗（core plugins 清單：access / admin / anonymous / bearer / custom-session / email-otp / generic-oauth / jwt / magic-link / mcp / multi-session / oauth-proxy / oidc-provider / one-time-token / organization / phone-number / siwe / two-factor / username 等，無 passkey）。

**Alternative considered**：`@simplewebauthn/server` 自建 — 僅在 better-auth plugin 缺 feature 時才考慮；目前無缺漏。

### Decision 2: Make `user.email` nullable with partial unique index

**選擇**：

- `user.email`：`TEXT UNIQUE` → `TEXT NULL`，加 `CREATE UNIQUE INDEX user_email_partial ON user(email) WHERE email IS NOT NULL`
- `user_profiles.email_normalized`：同樣改 nullable + partial unique
- 既有 `session.create.before` reconciliation 需加 `email IS NOT NULL` guard

**理由**：passkey-first 使用者可能永遠不會填 email；若塞 pseudo email（`passkey-{id}@local`），會讓 `isAdminEmailAllowlisted` 比對、`member_role_changes.reason = 'allowlist-*'` 路徑、admin UI 欄位顯示全都需要 filter 假值，污染面非常大。Partial unique 保留「有 email 的使用者 email 唯一」這條業務不變式。

**Alternative considered**：Pseudo email（已否決，見上）；刪 email 欄位改用 account table 分散儲存（better-auth 不支援）。

### Decision 3: Introduce `user.display_name` as immutable unique identity anchor

**選擇**：

- 新增 `user.display_name TEXT NOT NULL UNIQUE`
- 註冊時必填、全系統唯一、**應用層與 DB 層雙重約束不可更新**：
  - DB：無 direct update 機制（migration 只建立，應用 API 不提供 PATCH endpoint）
  - 應用層：`server/utils/member-role-changes.ts` 或獨立 guard 檢查任何 `UPDATE user SET display_name` 呼叫並 reject
- 註冊前即時衝突檢查：`GET /api/auth/nickname/check?nickname=xxx`
- 建立後若有 better-auth 的 `user.update` 介面，須 intercept 禁止修改 `display_name`

**理由**：使用者明確要求「暱稱就是身分」。可改的欄位等於把 role（mutable）綁在另一個 mutable field 上，使 admin 辨識失去穩定性。

**Existing Google users 的 backfill**：migration 執行時，既有 `user` 行若 `name IS NOT NULL` 則 copy 成 `display_name`；若衝突或 NULL 則用 `user_{id.slice(0,8)}` 自動產生。首次登入時 UI 提示其「暱稱已自動生成，可到帳號設定確認」（但仍不可改）。

**Alternative considered**：允許改名加 cooldown（已否決）；不加 display_name 改用 userId（已否決，UX 上 admin 無從辨識 `user_abc123`）。

### Decision 4: Feature flag as dual gate (server plugin registration + UI display)

**選擇**：

- Server：`server/auth.config.ts` 依 `knowledge.features.passkey` 決定是否把 `passkey()` 加入 `plugins` 陣列
- Client：`app/auth.config.ts` 始終載入 `passkeyClient()`（無副作用）；UI 用 `useRuntimeConfig().public.knowledge.features.passkey` 控制按鈕顯示
- 當 flag = false 時，client 呼 passkey endpoint 會回 404（因為 server 未 register）

**理由**：配合 `Production v1.0.0 defaults features.passkey = false` 的既有非可議邊界。Server 未 register plugin = 攻擊面最小化（endpoint 根本不存在）。UI 條件渲染避免按了按鈕但 server 回 404 的劣質 UX。

**Alternative considered**：純 UI hide（已否決，server 面仍暴露）；純 server gate（已否決，UI 會顯示無效按鈕）。

### Decision 5: Bidirectional binding via authenticated session, no cross-account merge

**選擇**：

- 已登入狀態下可呼 `POST /api/auth/passkey/add` 或 `POST /api/auth/link/google`（後者走 better-auth `linkSocial`），加綁憑證到當前 userId
- 綁 Google 時若帶回的 email ∈ `ADMIN_EMAIL_ALLOWLIST`，`session.create.before` 的 reconciliation 在下次 session refresh 自動升 admin
- 不做跨帳號 merge：同一 email 若先有 passkey-only 帳號 X、後有 Google 帳號 Y，系統視為兩個獨立使用者
- UX 警示：Google 登入流程若偵測到 email 已綁定其他 passkey-only 帳號，顯示「此 email 已在系統中使用，請先用原帳號登入後加綁 Google」並 block 建立 Y

**理由**：auto-merge 牽涉權限合併（X 的 role vs Y 的 role 取哪個？）、資料合併（X 的 conversations 要轉移嗎？）、audit 血統（member_role_changes 該怎麼寫？），複雜度遠超 MVP 容許。v1.1 專門設計 merge flow。

**Alternative considered**：Auto-merge by email（已否決）；禁止同一 email 存在兩個帳號（本決策採「偵測+block 建立」的弱版本）。

### Decision 6: Passkey-only account self-deletion with reauth ceremony

**選擇**：

- 帳號設定頁提供「刪除帳號」按鈕
- 刪除前強制走一次 passkey ceremony（或 Google reauth）驗證當前使用者身分
- 刪除時同步清除 `user`、`user_profiles`、`passkey`、`account`、`session`、`member_role_changes`（保留最後一筆 audit row 標註 `reason = 'self-deletion'`）

**理由**：passkey-only 使用者無 email 可送確認信，必須用 passkey 自身作為身分證明。保留 member_role_changes 最後一筆是 audit compliance，畢竟曾是 member 或 admin 的使用者刪除行為本身需追溯。

**Alternative considered**：只標記 soft-delete（已否決，passkey 表保留會污染唯一性約束）。

### Decision 7: RP (Relying Party) configuration via runtime env vars

**選擇**：

- `NUXT_PASSKEY_RP_ID`：`yourdomain.com`（prod）/ `localhost`（local）— WebAuthn rpID
- `NUXT_PASSKEY_RP_NAME`：`"知識問答系統"` — 顯示給使用者作業系統 passkey UI
- `origin`：從 `event.node.req.headers.host` 動態取（支援多 subdomain）

**理由**：WebAuthn 規範 rpID 必須等於當前 origin 的 eTLD+1；跨環境部署（local / staging / prod）若硬編會 `NotAllowedError` 且錯誤訊息模糊。

**Alternative considered**：硬編（已否決）；從 `runtimeConfig.knowledge.environment` 推導（已否決，環境 → 域名映射仍需再一層 config）。

## Risks / Trade-offs

- **[Risk] Passkey plugin 產生的 schema 可能與 drizzle 自動生成的 `.nuxt/better-auth/schema.sqlite.ts` 不同步** → 在 migration 階段手動產生 `passkey` 表的 migration SQL，不依賴 auto-generation；驗證 `PRAGMA table_info(passkey)` 符合預期
- **[Risk] Email nullable 後，`user_profiles` FK 到 `userId` 仍工作，但 `emailNormalized` 索引查詢會遇到 NULL 語意陷阱** → 所有以 email 查詢使用者的 code path 必須加 `email IS NOT NULL` guard；寫測試覆蓋「passkey-only 使用者不被 email 查詢命中」
- **[Risk] 既有 Google 使用者 backfill display_name 衝突** → migration 自動產生 `user_{id.slice(0,8)}` 後若仍衝突（極低機率），fallback 到 `user_{full_id}`；Admin UI 提示 backfill 的暱稱以區別
- **[Risk] Passkey-only 使用者在不同裝置無法登入**（WebAuthn credential 綁裝置） → UX 強烈建議第一次註冊後立即加第二個 passkey（不同裝置）或綁 Google；UI 在帳號設定頁顯示「僅綁定 1 個 passkey = 失去此裝置即失去帳號」警告
- **[Risk] Feature flag 切 false 時既有 passkey 使用者被鎖門外** → 切 flag 屬於危險操作，文件化為 ops runbook 動作；UI 若偵測到 passkey-only session 但 flag = false，顯示 graceful error 而非白屏
- **[Risk] `session.create.before` reconciliation 對 nullable email 行為改變** → 既有 `inAllowlist = isAdminEmailAllowlisted(existing.email, allowlist)` 對 NULL email 必須回 false；`isAdminEmailAllowlisted` 已經對 null/空字串 defensive（見 `shared/schemas/knowledge-runtime.ts`），以單元測試驗證此 invariant

## Migration Plan

### Phase 1: Schema migration（向下相容準備）

1. 新增 migration：`user.email` 改 nullable + partial unique index
2. 同步 `user_profiles.email_normalized` 改 nullable + partial unique index
3. 新增 `user.display_name TEXT NOT NULL UNIQUE`，backfill 策略如 Decision 3
4. 新增 `passkey` 表（better-auth plugin 原生 schema）
5. 跑 `PRAGMA foreign_key_check` + row count 對照驗證無資料遺失

### Phase 2: Server 側載入

6. `server/auth.config.ts` 依 feature flag 條件載入 `passkey()` plugin
7. 新增 `server/api/auth/nickname/check.get.ts` 即時衝突檢查
8. `session.create.before` 的 reconciliation 加 `email IS NOT NULL` guard

### Phase 3: UI

9. `app/auth.config.ts` 加 `passkeyClient()`
10. `app/pages/index.vue` 登入區塊加 passkey 按鈕（條件渲染依 feature flag）
11. 新增 passkey 註冊 UI：暱稱輸入 + 即時檢查 + WebAuthn ceremony
12. 新增 `app/pages/account/settings.vue`：雙向綁定、帳號自刪
13. `app/pages/admin/members/index.vue` 擴充列表欄位（暱稱、credential 類型）

### Phase 4: Rollout

14. Local env 開 `NUXT_KNOWLEDGE_FEATURE_PASSKEY=true` + 設 RP vars → smoke test
15. Production 預設 flag = false；切流量時 Admin 先手動驗證 allowlist 使用者綁定 passkey → 逐步開放
16. Rollback plan：若切 flag = false，既有 passkey session 會在 reauth 時失效，使用者必須改走 Google；若無 Google 綁定則需 Admin 介入

## Open Questions

- **Admin 辨識欄位的 privacy 邊界**：`/admin/members` 是否顯示「最近活動時間」以外的行為線索（例如首問的問題 snippet）？暫定僅顯示註冊時間 + 最後活動時間 + credential 類型，不顯示 IP / query 內容
- **Passkey ceremony 的 UX 細節**：使用 better-auth 預設 modal 還是自建？`impeccable teach` 階段檢視 design system 後再定
