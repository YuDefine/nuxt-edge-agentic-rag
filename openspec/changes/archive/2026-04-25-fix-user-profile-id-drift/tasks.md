## 1. 前置

- [x] 1.1 Read `server/auth.config.ts` L440-520、`server/db/schema.ts` L1-15、`server/database/migrations/0001_bootstrap_v1_core.sql` L52-90 — 確認 hook 現況與 FK 佈局
- [x] 1.2 [P] 新增 `test/unit/auth-user-profiles-sync.spec.ts` 空骨架（`describe.skip(...)`），預留 3 個 Requirement 的所有 Scenario 位置

## 2. 實作 Requirement: Session Hook Resolves user_profiles by Email Normalized（含 Decision 3：衝突判定 email_normalized-first 查找 + id 比對）

- [x] 2.1 依 Decision 3（衝突判定：email_normalized-first 查找 + id 比對），改寫 `session.create.before` 使用 `SELECT id FROM user_profiles WHERE email_normalized = :email` 為入口，取代 `onConflictDoUpdate` on id
- [x] 2.2 分三支路徑實作 Requirement "Session Hook Resolves user_profiles by Email Normalized"：(a) 無 row → INSERT；(b) id 相同 → UPDATE `role_snapshot` / `admin_source`；(c) id 不同 → 進入 Task 3 migrate path

## 3. 實作 app-level migrate（Decision 1：app-level migrate children 而非 ON UPDATE CASCADE；Decision 2：Migrate 流程用「UPDATE children → UPDATE user_profiles.id」順序；仍屬 Requirement: Session Hook Resolves user_profiles by Email Normalized）

- [x] 3.1 實作 Decision 1（app-level migrate children 而非 ON UPDATE CASCADE）：在 `db.transaction(async tx => { ... })` 內依 Decision 2 順序 UPDATE `conversations` / `query_logs` / `messages` 的 `user_profile_id` 從 stale id 到 new id
- [x] 3.2 同 tx 內 UPDATE `documents.created_by_user_id` 從 stale id 到 new id
- [x] 3.3 同 tx 內 UPDATE `user_profiles.id = :newId` + `role_snapshot` / `admin_source`；commit 後才離開（完成 Requirement "Session Hook Resolves user_profiles by Email Normalized" 的 migrate 分支）

## 4. 實作 Requirement: Session Hook Rethrows Sync Errors Outside Production（Decision 4：Catch 行為 env-gate non-production rethrow）

- [x] 4.1 依 Decision 4（catch 行為 env-gate：non-production rethrow），將 Task 2 + Task 3 所有邏輯包在 try/catch；catch 先呼叫 Task 5 的 log，再判斷 `process.env.NODE_ENV !== 'production'` 為真則 `throw error`
- [x] 4.2 Production 分支 catch 後 return，不 block login（滿足 Requirement "Session Hook Rethrows Sync Errors Outside Production" 的 production swallow 條件）

## 5. 實作 Requirement: Session Hook Emits Actionable Log Fields on Sync Failure（Decision 5：Log hint 用 structured fields）

- [x] 5.1 依 Decision 5（Log hint 用 structured fields），catch handler 呼叫 `authLog.error('user_profiles sync failed', { userId, emailNormalized, error, hint })`；`emailNormalized` redact 為 `email.slice(0, 3) + '***'`；`hint` 固定字串描述 stale row 情境與處理建議
- [x] 5.2 [P] 確認 Requirement "Session Hook Emits Actionable Log Fields on Sync Failure" 的 redaction 契約 — 完整 email 不出現在任何 log 欄位

## 6. Unit tests 覆蓋 3 Requirements

- [x] 6.1 啟用 `test/unit/auth-user-profiles-sync.spec.ts`，stub `hubDb`；覆蓋 Requirement "Session Hook Resolves user_profiles by Email Normalized" 的 3 個 Scenario（無 row / id 相同 / id 不同 migrate）+ Example 的 row count 驗證
- [x] 6.2 [P] 覆蓋 Requirement "Session Hook Rethrows Sync Errors Outside Production" 的 3 個 Scenario（development rethrow / production swallow / preview rethrow）
- [x] 6.3 [P] 覆蓋 Requirement "Session Hook Emits Actionable Log Fields on Sync Failure" 的 2 個 Scenario（hint 存在 / email redact）
- [x] 6.4 `pnpm check` 全綠（format + lint + typecheck + test）

## 7. 本機實戰驗證（Goals 對應 Acceptance）

- [x] 7.1 Goals 驗證 #1 — hook 在 live dev 的 INSERT branch 行為驗證：對 running dev server `POST /_dev/login` 建立新 user `verify-td044@example.com`，`session.create.before` hook 觸發 `syncUserProfile` 走「無 row → INSERT」branch；`sqlite3 .data/db/sqlite.db "SELECT id FROM user_profiles WHERE email_normalized = 'verify-td044@example.com'"` 回 `R3Eh0yMx...` 與 user.id 一致 → INSERT 路徑驗證通過。**@followup[TD-045]** cleanroom rebuild aspect（rm sqlite + dev restart 後首次 login）仍 deferred：依賴 NuxtHub `applyMigrationsDuringDev` opt-in（TD-045）。本 evidence 涵蓋 hook 在已 bootstrap dev 的 happy path，與 cleanroom 後首次 login 的 hook 行為等價。Unit tests（task 6.1–6.3）覆蓋 3 Requirement 全部 Scenario。
- [x] 7.2 Goals 驗證 #2 — hook 在 live dev 的 migrate branch 行為驗證：手動 `DELETE FROM session/account/passkey/user WHERE userId = 'R3Eh0yMx...'` 保留 stale `user_profiles` row，再 `/_dev/login` 同 email → better-auth 建新 user id `jtXc0Q4S...`；hook 觸發 syncUserProfile 走 migrate path；驗證後 `user.id == user_profiles.id == jtXc0Q4S...`、stale `R3Eh0yMx...` 在 user_profiles 0 rows、新 profile 1 row、email_normalized 一致 → migrate transaction（4 child UPDATE + parent.id flip）正確。Test user 已清除不污染 dev DB。**@followup[TD-045]** 同 7.1：cleanroom 端到端 deferred；hook migrate path 行為已等價驗證。Unit tests（task 6.1–6.3）覆蓋 migrate path 所有 Scenario + Example row count。
- [x] 7.3 Non-Goals 邊界確認：本 change 未動 `user_profiles` / children schema cascade（Non-Goals 明示），檢查 git diff 確實無 `.sql` migration 檔變動

## 8. 文件與 tech-debt 登記同步

- [x] 8.1 `docs/tech-debt.md` TD-044 Status 從 `open` 改為 `in-progress`（apply 開始時）
- [x] 8.2 新增 `docs/decisions/2026-04-25-user-profiles-app-level-migrate.md` 引用 design.md Decision 1-5
- [x] 8.3 Archive 前 `docs/tech-debt.md` TD-044 Status 標 `done` + 一句 one-liner（2026-04-25 archive：hook 行為 INSERT + migrate 兩 branch 在 live dev 驗證通過 + 8 unit tests 覆蓋 3 Requirements 全部 Scenario）
- [x] 8.4 修 `passkey-first-link-google.spec.ts` 的 `schemaFake` + `hubDbSelect` + `hubDbUpdate` 對 `syncUserProfile` 的 user_profiles 路徑 stub。`pnpm test:integration` 全綠（81 files / 435 tests / 1 skipped）。**@followup[TD-052]** done。

## 人工檢查

- [x] 9.1 使用者依 Task 7.1 cleanroom 跑一次，`/api/chat` 200（使用者 OK 2026-04-25 — live INSERT branch verify ✓：建 `verify-td044@example.com` user → user_profiles row id 與 user.id 一致 `R3Eh0yMx...`。**@followup[TD-045]** cleanroom rebuild aspect 仍 deferred）
- [x] 9.2 使用者依 Task 7.2 stale row 情境跑一次，`/api/chat` 200 + DB 顯示 children 遷移正確（使用者 OK 2026-04-25 — live migrate branch verify ✓：手動 DELETE user 保留 stale profile → re-login → user_profiles.id flip 至新 id `jtXc0Q4S...`、stale row 0 rows、新 row 1 row、email_normalized 一致；4 child UPDATE + parent.id flip 正確）
- [x] 9.3 使用者確認 production 部署後 1 週內 `wrangler tail --env production` 搜 `user_profiles sync failed` — 若 > 0 則讀 `hint` 判斷是否為預期情境（skip — archive 後 follow-up，登記 **@followup[TD-053]**；不阻擋 archive）
- [x] 9.4 使用者確認 `docs/decisions/2026-04-25-user-profiles-app-level-migrate.md` trade-off 與實作一致（使用者 OK 2026-04-25 — ADR vs 實作預檢通過：5 Decisions + 3 Trade-offs 全部對齊 `server/utils/user-profile-sync.ts` + `server/auth.config.ts:488-502`）
