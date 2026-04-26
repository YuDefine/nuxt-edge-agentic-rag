## Context

`passkey-authentication` change（archived 2026-04-21）的 design 原本要把 `user_profiles.email_normalized` 同步改 nullable，但 migration 0009 已經 rebuild 了 `user` 樹的 8 張表，再加 `user_profiles` 樹會讓單一 migration 超過 700+ 行 SQL，超出安全 review surface。當下選擇延後並用 sentinel `'__passkey__:' || user.id` workaround 維持 UNIQUE 約束。

> **Implementation note (2026-04-26 ingest)**: 原 design 寫「migration 0010」是基於 0009 為最新 migration 的 snapshot；apply 階段發現 0010-0015 已被使用（`fk_cascade_repair`、`query_logs_workers_ai_runs`、`fk_rebuild_user_references`、`messages_refused_flag`、`messages_refusal_reason`、`fk_rebuild_query_logs_chain`），本 change 改為 **migration 0016**。同時 4 張 FK children（`conversations` / `query_logs` / `messages` / `documents`）的 column / FK 結構在 0010-0015 期間已調整過，cascade rebuild 的 `CREATE TABLE` 必須以**當前 `server/db/schema.ts` 的最新欄位定義為真相來源**，不可照原 design 的 0009-snapshot 寫法。實際 SQL 行數會超過原估的 700+。
>
> **Implementation note 2 (2026-04-26 cascade extension)**: 寫 0016 時實測發現 cascade 比原 design 估的更深 — 必須 rebuild 8 表而非 4 表。原因：
>
> - libsql 預設 `foreign_keys = 1`（D1 為 OFF 但 silently ignore `PRAGMA foreign_keys = OFF`，per 0010 註記）
> - `defer_foreign_keys = ON` 不適用 DDL，DROP referenced table 仍 abort with `SQLITE_CONSTRAINT_FOREIGNKEY`
> - 當 0016 DROP `documents` 時 `document_versions` 仍引用之 → fail；DROP `query_logs` 時 `citation_records` 仍引用 → fail；連鎖到 `source_chunks` 也得進 rebuild（因為 `document_versions` 要被 DROP，會留 `source_chunks` dangling FK）
>
> 最終 cascade chain：`user_profiles` + `conversations` + `query_logs` + `messages` + `documents` + `citation_records` + `document_versions` + `source_chunks`（**8 表**）。後 3 表純粹是 chain 必要伴隨 rebuild，**column / FK 結構照當前 schema 不變**。實際 SQL 行數約 1500-2000。

本 change 是該 deferred follow-up（TD-009）。Schema 現況：

```
user_profiles
├── id (TEXT PK, references better-auth user.id)
├── email_normalized (TEXT NOT NULL UNIQUE)  ← 改為 NULL + partial unique index
├── role_snapshot
├── admin_source
├── created_at / updated_at

FK children referencing user_profiles(id):
├── conversations.user_profile_id
├── query_logs.user_profile_id
├── messages.user_profile_id
├── documents.author_user_profile_id
```

D1（sqlite）的 `ALTER TABLE` 不支援 `MODIFY COLUMN`，要改 column nullability 必須走 rebuild：

1. `PRAGMA foreign_keys = OFF`
2. RENAME old → drop indexes
3. CREATE new with target schema
4. INSERT SELECT 搬資料（同時跑 data migration: sentinel → NULL）
5. CASCADE rebuild 所有 FK children（DROP indexes / RENAME / CREATE / INSERT SELECT / DROP old / re-create indexes）
6. DROP old user_profiles
7. RECREATE all indexes including partial unique index
8. `PRAGMA foreign_keys = ON`
9. `PRAGMA foreign_key_check`

既有 reference: migration 0007（rebuild documents tree）+ 0009（rebuild user tree）已驗證此 pattern 在 D1 + libsql 與 NuxtHub local dev 三者皆 work。

## Goals / Non-Goals

**Goals:**

- `user_profiles.email_normalized` 從 `TEXT NOT NULL UNIQUE` 改為 `TEXT` + partial unique index
- 既有 sentinel data 在同 migration 內 backfill 為 NULL
- FK children（4 張表）rebuild 完成後 row count 與 row content bit-for-bit 相同（除 sentinel → NULL 的明確差異）
- `PRAGMA foreign_key_check` post-migration 零 row
- Migration idempotent：跑兩次（如 NuxtHub auto-apply 或 local 重置）第二次必須 no-op 或 safe-skip
- Server-side upsert 邏輯改為直接寫 NULL，所有 email 比對 code path 加 `IS NOT NULL` guard

**Non-Goals:**

- 不改 `user.email`、`account.email`（已在 0009 處理）
- 不改 `user_profiles` 的其他 column
- 不引入 schema feature flag（schema 改動必須前向相容）
- 不在同 migration 動 user / account / 其他樹
- 不改 admin allowlist 對「passkey-only user 不可入 allowlist」的行為語意
- 不改 `session.create.before` hook（fix-user-profile-id-drift archive 已 land）

## Decisions

### FK Cascade Rebuild Order

D1 不支援 `ALTER TABLE ... DROP CONSTRAINT`，FK 依附在 children 表的 column definition。要 rebuild parent 的 schema：

```
1. PRAGMA foreign_keys = OFF
2. Backfill sentinel → NULL on existing user_profiles (UPDATE before rename)
3. RENAME user_profiles → user_profiles_old
4. CREATE user_profiles_new with email_normalized TEXT (nullable)
5. INSERT INTO user_profiles_new SELECT * FROM user_profiles_old
6. For each child (conversations / query_logs / messages / documents):
   a. RENAME child → child_old
   b. CREATE child_new (schema 不變，但 FK 重指向 user_profiles_new — 此處要重新寫整個 CREATE)
   c. INSERT INTO child_new SELECT * FROM child_old
   d. DROP child_old
   e. RECREATE child indexes
7. DROP user_profiles_old
8. RENAME user_profiles_new → user_profiles
9. RECREATE user_profiles indexes (含 partial unique index)
10. PRAGMA foreign_keys = ON
11. PRAGMA foreign_key_check (transaction 結束前必跑)
```

**Why backfill sentinel BEFORE rename**: 在 old table 上 backfill 時 NOT NULL 約束仍生效，但更新 sentinel → NULL 違反 NOT NULL → 必須先 rename + 改用 new table；step 2 應該改為「INSERT INTO user_profiles_new SELECT id, CASE WHEN email_normalized LIKE '**passkey**:%' THEN NULL ELSE email_normalized END, ... FROM user_profiles_old」。校正後正確順序：

```
1. PRAGMA foreign_keys = OFF
2. RENAME user_profiles → user_profiles_old
3. CREATE user_profiles_new (email_normalized TEXT nullable)
4. INSERT INTO user_profiles_new
   SELECT id, CASE WHEN email_normalized LIKE '__passkey__:%' THEN NULL ELSE email_normalized END,
   role_snapshot, admin_source, created_at, updated_at
   FROM user_profiles_old
5. ... (FK children rebuild as above)
```

**Alternatives considered**:

- **方案 1：兩段 migration（先 rebuild 不 backfill，後續另一支 backfill）** — 增加 review surface 與 partial deploy 風險；reject
- **方案 3：用 trigger 把 sentinel 動態映射到 NULL** — D1 trigger 支援有限且難 review；reject

### Partial Unique Index Definition

post-migration 的 index：

```sql
CREATE UNIQUE INDEX idx_user_profiles_email_normalized_unique
  ON user_profiles(email_normalized)
  WHERE email_normalized IS NOT NULL
    AND email_normalized NOT LIKE '__passkey__:%';
```

**Why include `NOT LIKE '__passkey__:%'`**: 雖然 data migration 應該已把所有 sentinel 改為 NULL，但作為 defense-in-depth：

- 若 data migration 漏掃（race / bug）→ 殘留 sentinel row 不撞 UNIQUE（避免 production migration partial fail）
- 後續任何 stray code 若意外寫入 sentinel（regression）→ 不撞 UNIQUE 但被 audit 容易抓
- 跑 5-10 個 release cycle 後 staging 確認無 sentinel row 殘留，可發 follow-up change 拿掉 NOT LIKE 部分

**Alternatives considered**:

- **僅 `WHERE email_normalized IS NOT NULL`** — 更乾淨，但失去 sentinel 防呆；defense-in-depth 取捨後保留
- **完整 unique（無 partial）** — 兩個 NULL row 撞 UNIQUE，違反「passkey-only 多 user 共存」需求；reject

### Server-side Upsert 改寫

`server/auth.config.ts` 的 `session.create.before` hook 內 `syncUserProfile` 函式（fix-user-profile-id-drift 已 wire）目前對 passkey-only user 寫入 sentinel：

```ts
// 當前
const emailNormalized = user.email ? normalizeEmail(user.email) : `__passkey__:${user.id}`
```

改為：

```ts
// 目標
const emailNormalized = user.email ? normalizeEmail(user.email) : null
```

對應的 drizzle schema 改 `emailNormalized: text('email_normalized')` （拿掉 `.notNull()`）。

`isAdminEmailAllowlisted` 等 email 比對函式加 NULL guard：

```ts
// 當前（依賴 sentinel 含 ':'）
function isAdminEmailAllowlisted(emailNormalized: string): boolean {
  return ALLOWLIST.includes(emailNormalized)
}

// 目標（顯式 NULL guard）
function isAdminEmailAllowlisted(emailNormalized: string | null): boolean {
  if (emailNormalized === null) return false
  return ALLOWLIST.includes(emailNormalized)
}
```

**Why explicit guard over implicit `:` check**: 顯式檢查更明顯易 review；既有 implicit 機制依賴「sentinel 含 `:` 不是合法 email 字元」這個假設，未來新增的 email 比對 code path 容易踩雷。

### Migration Idempotency Strategy

D1 migration 的標準 idempotency 機制（`_hub_migrations` 表記錄已套用 timestamp）會擋第二次跑同 migration。但本 change 引入新 schema state，要驗證以下三種 scenario：

1. **Fresh DB（migration 0001-0016 一次跑完）**：直接 land target schema，無 sentinel data 要 backfill
2. **Incremental from 0015**：有 sentinel data，data migration 把它變 NULL
3. **Re-run 0016 on already-migrated DB**：`_hub_migrations` 擋下，no-op

不需要在 SQL 內加 `IF NOT EXISTS` 或 conditional logic（migration runner 已負責 dedup），但要在 integration spec 顯式驗證三種 scenario 都 work。

### Test Strategy

| Layer               | Coverage                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                | `admin-allowlist-nullable.spec.ts`（NULL / empty / real email 三 case）、drizzle schema 型別 reflect nullable                                                                      |
| Integration         | `migration-0016-rebuild-user-profiles.spec.ts`（fresh / incremental / re-run 三 scenario + FK check + sentinel migration 正確）                                                    |
| Existing regression | 全 unit + integration suite 跑過（特別關注 passkey-authentication / fix-user-profile-id-drift / consolidate-conversation-history-config 等已 archive change 的 spec）              |
| Manual              | local `pnpm dev` reset DB 後 fresh migration + Google login + passkey-only 註冊兩 path 各 1 user 驗證；wrangler tail / D1 query 確認 `user_profiles` row email_normalized 對應正確 |

## Risks / Trade-offs

- **[Risk] Migration 在 production 中途失敗（D1 outage / network / OOM）** → **Mitigation**: 全部包在 `BEGIN TRANSACTION` ... `COMMIT` 內；失敗自動 rollback 回 0009 state；deploy 流程已有 NuxtHub auto-apply rollback signal
- **[Risk] FK children rebuild 時其中一張表 row count 與 rebuild 前不一致** → **Mitigation**: 每張子表 INSERT SELECT 後立刻 `SELECT COUNT(*) FROM child_new` 比對 `SELECT COUNT(*) FROM child_old`，不一致則 transaction rollback；integration spec 用 fixture data 強制覆蓋
- **[Risk] Partial unique index 在 D1 / libsql / production 三 runtime 行為不一致** → **Mitigation**: 既有 partial unique index 已在 0009（`user.email`）使用相同 syntax 驗證過，跨 runtime 無 known issue；integration spec 跑 D1 fake + libsql 兩個 runtime
- **[Risk] sentinel 漏掃 / 殘留** → **Mitigation**: partial unique index `NOT LIKE '__passkey__:%'` 防呆；integration spec 顯式驗證 post-migration sentinel row count = 0
- **[Risk] `isAdminEmailAllowlisted` 等 code path 漏加 NULL guard** → **Mitigation**: TypeScript signature 從 `string` 改 `string | null` 強制 caller 處理；compiler 會抓所有未處理的 caller
- **[Risk] 新 migration 跟 active sessions race（in-flight `session.create.before` 寫 sentinel 同時 migration 在跑）** → **Mitigation**: D1 migration 期間 worker 短暫不可用；in-flight 寫 sentinel 會在 migration commit 前完成或失敗 retry；migration commit 後 hook 已改 NULL，無 race window
- **[Trade-off] Partial index 含 NOT LIKE 寫死 sentinel pattern** → 接受，作為 defense-in-depth；長期觀察無殘留再發 follow-up 移除
- **[Trade-off] FK children rebuild 影響 4 張表的 INSERT/UPDATE 短暫 window** → 接受，本 change 在 deploy 期間執行（非 hot path），影響可控

## Migration Plan

1. **Local 驗證**：reset local D1 → `pnpm dev` 自動套用 0001-0016 → 驗證 fresh path；另一個 dataset 從 0015 incrementally 跑 0016 → 驗證 incremental path with sentinel data
2. **Staging 驗證**：staging D1 確認當前在 0009 schema + 有 sentinel data → deploy → 觀察 migration 套用日誌 + `PRAGMA foreign_key_check` + sentinel row count = 0
3. **Production deploy**：staging 7 天無異常後 deploy production；deploy 期間 worker 短暫 503（migration window）符合既有 deploy 流程
4. **Post-deploy 觀察**：72 小時觀察 evlog `user_profiles.upsert.failed` / `auth.session.error` / Sentry breadcrumb，無 spike 即視為 stable
5. **archive**：TD-009 改 done + Resolved；spec delta 合併進主規格

**Rollback**: D1 不支援 down migration。若 deploy 後發現 schema-level bug：

- 短期：用 server-side patch 把 `email_normalized = NULL` 寫回 sentinel（保留 0016 schema），緊急修 admin allowlist 等 code path
- 長期：發 0017 reverse migration 把 nullable 還原 `NOT NULL`（成本同 0016，需要 backfill NULL → sentinel）

實務上：staging 7 天觀察期就是預防 rollback 的主要機制。

## Open Questions

無。本 change 的所有 unknowns（FK rebuild order、partial index pattern、idempotency 機制、isAdminEmailAllowlisted guard 寫法）都對齊 0007 / 0009 既有 pattern 並有 archive 證據。
