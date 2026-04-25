> **Ingest note (2026-04-26)**: 原 design 寫 migration 0010；apply 階段發現 0010-0015 已使用，本 change 改用 **0016**。同時 4 張 children 結構已被 0010-0015 改過，cascade rebuild 必須以**當前 `server/db/schema.ts` 為真相**寫 `CREATE TABLE`，不照原 design 的 0009-snapshot。詳見 `design.md` `## Context` 段落 ingest note。

## 1. Migration 0016 — rebuild user_profiles + FK children

- [x] 1.1 先寫 `test/integration/migration-0016-rebuild-user-profiles.spec.ts` failing tests 三 scenario（覆蓋 design Migration Idempotency Strategy 與 Test Strategy）：(a) fresh DB（無 sentinel data）→ migration 套用後 user_profiles row count 不變、email_normalized 全 nullable；(b) incremental from 0015（含 sentinel rows + real-email rows + 4 children rows）→ post-migration sentinel row count = 0 且 real-email row 不變；(c) partial unique index 允許多 NULL row + 拒絕重複 real email
- [x] 1.2 撰寫 `server/database/migrations/0016_user_profiles_nullable_email.sql` — **8 表 cascade rebuild**（design ingest note 2 修正）: PRAGMA foreign_keys = OFF + legacy_alter_table = OFF + defer_foreign_keys = ON → CREATE 8 \_v16 staging tables → INSERT 8 tables (user_profiles 含 sentinel→NULL backfill) → children-first DROP 8 originals → RENAME 8 \_v16 → canonical → recreate indexes 含 partial unique index → PRAGMA foreign_keys = ON → PRAGMA foreign_key_check
- [x] 1.3 跑 `pnpm test test/integration/migration-0016-rebuild-user-profiles.spec.ts` 全綠（3/3 pass）

## 2. Drizzle schema sync

- [x] 2.1 修改 `server/db/schema.ts` 的 `userProfiles` table：`emailNormalized` 拿掉 `.notNull()`（仍保留 column name 與 type）
- [x] 2.2 跑 `pnpm typecheck` 全綠

## 3. Server upsert 邏輯改寫

- [x] 3.1 修改 `server/auth.config.ts` 的 `session.create.before` hook：把 `__passkey__:${user.id}` sentinel 寫法改為 `null`；同步擴充 `server/utils/user-profile-sync.ts` 的 `UserProfileSyncInput.emailNormalized` 為 `string | null`，加 NULL branch 用 id-first lookup（passkey-only user 沒 email 不可能 drift）
- [x] 3.2 grep `__passkey__` 全 repo 確認唯一 sentinel writer（`server/auth.config.ts`）已改；migration 0016 內的 `__passkey__:%` 是 backfill SQL pattern，不算 writer

## 4. Email comparison code path NULL guard

- [x] 4.1 寫 `test/unit/admin-allowlist-nullable.spec.ts` 確認 NULL / undefined / empty / real email / 大小寫 / legacy sentinel 行為（7/7 pass）
- [x] 4.2 `isAdminEmailAllowlisted` 既已是 `string | null | undefined` → `if (!email) return false` — 符合 design 要求，**無需改 signature**
- [x] 4.3 既有 callers 都已預期 NULL（auth.config.ts 用 `existing.email` 可為 null, allowlist.ts/knowledge-runtime.ts/admin-members 用 `email ?? null`）— 無需動
- [x] 4.4 typecheck 全綠 + admin-allowlist-nullable spec 全綠

## 5. Spec / 文件同步

- [ ] 5.1 archive 時把 `openspec/changes/passkey-user-profiles-nullable-email/specs/auth-storage-consistency/spec.md` MODIFIED requirement 合併進主規格（spectra-archive 自動處理）；確認舊 sentinel scenario 與 deferred follow-up note 已被新版四個 scenario 取代
- [ ] 5.2 archive 時 `docs/tech-debt.md` 把 TD-009（user_profiles.email_normalized 全面改 nullable）改 Status: done 並補 Resolved 一段（含 migration 0016 編號 + sentinel data backfill 細節）

## 6. Verification

- [x] 6.1 `pnpm typecheck` 全綠
- [x] 6.2 `pnpm test --project unit` — 781 passed / 1 pre-existing baseline failure（`better-auth-passkey-hotfix-version.test.ts` 鎖在 1.6.7，repo 已升 1.6.9，與本 change 無關）
- [x] 6.3 `pnpm test --project integration` 全綠 — 89 file / 472 pass / 1 skip
- [x] 6.4 `pnpm spectra:followups` `No drift detected.`

## 7. 人工檢查

- [ ] 7.1 local `pnpm dev` reset DB（清 .data + 重跑 migration 0001-0016）→ 跑 fresh path：Google login user 1 + passkey-only register user 2 → query D1 確認 user_profiles row：user 1 email_normalized = "alice@example.com"、user 2 email_normalized IS NULL
- [ ] 7.2 local 另一 dataset：先跑到 0015（含 sentinel data：手動 insert `__passkey__:bob123` 一行）→ 套用 0016 → 確認該 row email_normalized 變 NULL；確認 partial unique index `idx_user_profiles_email_normalized_unique` 存在；跑 `PRAGMA foreign_key_check` 預期 0 row
- [ ] 7.3 staging deploy（必須先確認 staging D1 schema 在 0009 + 含 sentinel data 才能驗 incremental）→ 觀察 migration 套用日誌、`PRAGMA foreign_key_check` 結果、staging admin allowlist 行為（passkey-only user 不入 allowlist）
- [ ] 7.4 production deploy（staging 7 天無異常後）→ 觀察 migration 套用日誌；72 小時觀察 evlog `user_profiles.upsert.failed` / `auth.session.error` / Sentry breadcrumb，無 spike 即視為 stable @followup[TD-009]
- [ ] 7.5 production stable 後直接 query 一次：`SELECT COUNT(*) FROM user_profiles WHERE email_normalized LIKE '__passkey__:%'` 預期 0；`SELECT COUNT(*) FROM user_profiles WHERE email_normalized IS NULL` 預期 = passkey-only user 數量
