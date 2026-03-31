## Context

better-auth 與 `@onmax/nuxt-better-auth` 會在 build time 生成 `.nuxt/better-auth/schema.sqlite.ts`，裡面宣告 `user` / `account` 等表的 drizzle column 定義，`createdAt` / `updatedAt` / `banExpires` 皆為 `integer({ mode: 'timestamp_ms' })`（`.default(sql\`(cast(unixepoch('subsecond') \* 1000 as integer))\`)`）。

然而 production D1（database `agentic-rag-db`）裡實際建立的 `user` 表 column type 為 `TEXT` + default `CURRENT_TIMESTAMP`。透過 `wrangler d1 execute --remote` 的 `PRAGMA table_info(user)` 可驗證；實際樣本：

```
createdAt: TEXT, default CURRENT_TIMESTAMP, sample value = "1776332449872.0"
updatedAt: TEXT, default CURRENT_TIMESTAMP, sample value = "1776476402391.0"
```

Root cause 推測：第一版 migration（early better-auth version 或 nuxt-better-auth 的舊 generator）以 `TEXT` 建表；後續升級把 drizzle 宣告改成 `integer` 但未對既有 production 補齊 ALTER migration。新寫入仍走該 column，SQLite TEXT affinity 把 better-auth 傳入的 `Date.now()`（JS number）coerce 成 float-like string `"1776332449872.0"`。

Drizzle 的 `timestamp_ms` mapper（來自 drizzle-orm 套件內 sqlite-core/columns 的 timestamp 實作）：

```ts
mapFromDriverValue(value: number): Date {
  return new Date(value);
}
```

期待 driver 回 number，但拿到 string `"1776332449872.0"`。`new Date("1776332449872.0")` 在 V8 / Node 21 回傳 **Invalid Date**（Date.parse 不把純數字或 float 字串視為 epoch-ms），後續 `toISOString()` 拋 `RangeError: Invalid time value`。

**Stakeholders**：

- **Admin**（使用者本人）：無法打開 `/admin/members`，阻塞 B16 Phase 5-1 人工檢查
- **既有 user row**：production 目前有 2 筆（都是真實登入 Google 帳號），不可丟失
- **將來的 user insert**：若僅修 endpoint、未修 column type，新 row 仍以 TEXT 儲存並觸發 bug

## Goals / Non-Goals

**Goals:**

- 立即止血 `/api/admin/members` 500（Phase 1 endpoint 修改 + v0.18.2 deploy）
- 治本：production D1 的 `user.createdAt` / `user.updatedAt` / `user.banExpires` 與 `account.createdAt` / `account.updatedAt` column 改為 INTEGER，確保未來 insert 以 integer 儲存
- 保留既有 2 筆（含 Admin seed）資料；migration 後 drizzle 的 `timestamp_ms` mapper 能正常讀出 valid Date
- Phase 3 簡化 endpoint，移除治本後不需要的 `sql<>` workaround

**Non-Goals:**

- **NOT** 升級 better-auth 版本或重產 `.nuxt/better-auth/schema.sqlite.ts`
- **NOT** 調整其他專案自有表（`documents`、`query_logs`、`user_profiles` 等，用 `text` mode 儲存 ISO string，與 bug 無關）
- **NOT** 改 drizzle schema 宣告（generator 控制，無法手改）
- **NOT** 在 migration 做 GDPR / data validation 清理
- **NOT** 在同一 change 合併新 admin 功能

## Decisions

### Why endpoint fix 不能取代 migration

Drizzle 在 schema 宣告為 `timestamp_ms` 的 column 上永遠套用 `new Date(value)` mapper；即便 production D1 之後寫入純 integer `1776332449872`（無 `.0`），SQLite TEXT affinity 仍會存成 `"1776332449872"` string，drizzle 拿到字串做 `new Date("1776332449872")` 依然 Invalid Date（非 ISO format，Date.parse 不接受全數字字串）。

Endpoint Phase 1 fix 以 `sql<>` template 繞過 mapper 拿 driver raw value、再自行以 `Number()` 解析，可在 production 儲存未修正前撐住；但這是實作層 workaround，不該成為長期架構。治本必須 column type 改回 INTEGER。

**Alternatives considered:**

- **A. 只做 endpoint fix，不 rebuild D1**：簡單但脆弱。未來若有其他 query 直接 select `schema.user.createdAt`（drizzle 自動套 mapper），仍會遇到同樣 crash。rejected。
- **B. 直接改 drizzle schema 宣告為 `text` mode**：drizzle schema 由 `@onmax/nuxt-better-auth` generator 控制，手改 `.nuxt/better-auth/schema.sqlite.ts` 會在下次 build 被覆寫。rejected。
- **C. Column rebuild（本方案）**：雖複雜（FK、data migration），是唯一能恢復「drizzle 宣告 = D1 實際」契約的路。accepted。

### SQLite table rebuild recipe

SQLite `ALTER TABLE` 不支援 `MODIFY COLUMN TYPE`。官方 [make-other-kinds-of-table-schema-changes](https://www.sqlite.org/lang_altertable.html#otheralter) recipe（12-step）歸納為：

```
1. PRAGMA foreign_keys = OFF
2. BEGIN TRANSACTION
3. Create `user_new` with desired schema (createdAt / updatedAt / banExpires = INTEGER)
4. INSERT INTO user_new SELECT ...
     createdAt  = CAST(CAST(createdAt AS REAL) AS INTEGER)   -- "1776332449872.0" → 1776332449872
     updatedAt  = 同上
     banExpires = CASE WHEN banExpires IS NULL THEN NULL ELSE CAST(CAST(banExpires AS REAL) AS INTEGER) END
5. DROP TABLE user
6. ALTER TABLE user_new RENAME TO user
7. 重建 index（id PK 已在 CREATE 時內建；email UNIQUE 重建）
8. 對 `account` 表重複同樣程序，INTEGER 欄位含：
     createdAt
     updatedAt
     accessTokenExpiresAt  (nullable)
     refreshTokenExpiresAt (nullable)
   重建 `account_userId_idx` index；`userId` FK 指向（此時已 rename 回 `user`）的 `user.id`
9. PRAGMA foreign_key_check  -- 必須零筆違規
10. COMMIT
11. PRAGMA foreign_keys = ON
12. VACUUM（可選，清理）
```

`account.userId` FK 指向 `user.id`（text primary key），id 值不變，FK 不會受影響。

**Alternatives considered:**

- **A. `ALTER TABLE user ADD COLUMN createdAt_new INTEGER` + copy + drop old + rename**：SQLite 不支援 `DROP COLUMN` with FK constraint 狀態下的原子操作；且需要兩次 migration。rejected（更複雜）。
- **B. 本方案（full table rebuild）**：accepted。

### Phase 部署順序：先 endpoint，後 migration

**Phase 1（endpoint）先上**的理由：

- Production 當前 500，需立即止血
- Migration 要做預演 / 備份，需要更長 lead time
- Endpoint fix 在 schema drift 修復後仍無害（helper 成為 defensive 保底）

**Phase 2（migration）後上**的理由：

- Migration 是 table rebuild，有資料風險，需 staging 演練
- Phase 1 部署後 admin 已能開啟頁面，migration 可從容執行（非同日同時部署）

**Phase 3（endpoint 簡化）**：migration 部署且 production 確認 drizzle mapper 恢復正常後再做，獨立 PR，低風險。

### Rollback 策略

| Phase   | Rollback 手段                                                                                                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | `git revert` 該 commit → redeploy 上一版 Worker；endpoint 回到 500（非降級，回到 bug 原狀）                                                                                                                                                                                           |
| Phase 2 | Migration 執行前 MUST 做 `wrangler d1 export agentic-rag-db --output /path/to/backup.sql`；若 migration 失敗：`wrangler d1 execute --file backup.sql`。因 migration 走 transaction，中途失敗 COMMIT 前的狀態會 rollback 至 transaction 開始前；但若 COMMIT 後才發現問題，需從備份還原 |
| Phase 3 | `git revert` → endpoint 回到 sql raw + helper 狀態，仍 defensive，對 admin 無感知                                                                                                                                                                                                     |

### 是否保留 `toIsoOrNull` 作為 defensive

**Accept**。理由：

- Cost 小（~15 lines），collocated 在 endpoint
- 保底：未來若再有 schema drift（其他 column、其他 table），或 driver 行為變化，不至於再讓 admin 頁 500
- Phase 3 僅移除 `sql<>` raw select，保留 helper；branch 可化簡至「`instanceof Date && !NaN` 成功回 ISO / 否則 null」一條路

## Risks / Trade-offs

| Risk                                                                     | Mitigation                                                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Migration 執行中 FK 檢查失敗（`account.userId` 指向不存在的 `user.id`）  | Phase 2 SQL 最後一步 `PRAGMA foreign_key_check` MUST 回零筆違規才 COMMIT；預演時先在本機 dump 上驗證                         |
| Migration 執行期間 better-auth 寫入衝突（使用者同時登入）                | 在 off-peak 時段執行；Transaction 保證原子性；若 commit 時 D1 concurrency rollback，整段回退，使用者只會看到短暫 write error |
| `CAST(CAST(col AS REAL) AS INTEGER)` 遇到非數字 TEXT（極端壞資料）→ 回 0 | 先 `SELECT id, createdAt FROM user WHERE CAST(createdAt AS REAL) = 0` 盤點；若有異常 row，改用 fallback UPDATE 個案處理      |
| 預演時機：本機無 production 資料 → 難 100% 重現 FK 狀況                  | `wrangler d1 export agentic-rag-db --remote --output backup.sql` → 以 `sqlite3` 在本機匯入做 dry run                         |
| Phase 1 部署把 `createdAt` 傳成 null 給前端，影響 admin UI 排序 / 顯示   | Phase 1 test 確保 drift row 會被 parse 回 valid ISO（非 null），UI 無感                                                      |
| Drizzle 未來版本改 `timestamp_ms` mapper 行為                            | Defensive helper 保留；pinned drizzle version 升級時需重跑 admin-members test                                                |

## Migration Plan

**Phase 1 — Endpoint hotfix（~1 天）**

1. Endpoint 修改（已在本機）
2. `pnpm check` + `pnpm test:integration` 全綠
3. `/commit`（Tier 3：`spectra-audit` + `code-review` agent）
4. Deploy v0.18.2
5. 使用者實測 `/admin/members` 能正常開啟

**Phase 2 — D1 migration（~2-3 天，跨天安排）**

1. 撰寫 `server/database/migrations/XXXX_better_auth_timestamp_affinity.sql`
2. 本機 dry run：`wrangler d1 export agentic-rag-db --remote --output tmp/prod-backup.sql` → 匯入本機 sqlite → 執行 migration SQL → 驗證 `typeof(createdAt) = 'integer'` + `PRAGMA foreign_key_check` 零違規
3. 更新 `.nuxt/hub` 生成 schema（如有）
4. `/commit`
5. Deploy：Migration 透過 nuxthub deploy pipeline（D1 migration auto-apply）或 `wrangler d1 migrations apply agentic-rag-db --remote`
6. Post-deploy 驗證：
   - `PRAGMA table_info(user)` 確認 INTEGER
   - `/admin/members` 仍正常（drizzle mapper 回 valid Date）
   - 新 user 登入測試：`SELECT typeof(createdAt) FROM user WHERE id = <new>` 應 integer

**Phase 3 — Endpoint cleanup（~0.5 天）**

1. 移除 `sql<>` raw select，改回 `createdAt: schema.user.createdAt`
2. 簡化 `toIsoOrNull` helper（保留但 branch 減少）
3. Test 對應調整（drift case 保留作回歸）
4. `/commit` + deploy

**Rollback trigger points：**

- Phase 1 部署後發現新 regression → `git revert` hotfix commit，回到 500 狀態
- Phase 2 migration 執行後 admin 頁面有資料異常 → 從 backup restore
- Phase 3 簡化後意外 regression → `git revert` 簡化 commit

## Open Questions

- **Q1 (已決)**：是否同一 change 合併 Phase 1 + 2 + 3？→ 是（使用者指示 2a：綁在同一 spectra change），但 Phase 1 因 production 持續 500 已先獨立 ship（commit `e45cf95` / deploy `dc6d447` v0.18.2）
- **Q2**：Phase 2 migration 在哪個窗口執行？初步規劃：等 Phase 1 部署穩定 24 小時以上、低流量時段
- **Q3 (已決)**：是否也 rebuild `session` / `verification` 表？→ **否**。D1 查詢結果顯示兩表皆有 TEXT drift，但 `.nuxt/better-auth/schema.sqlite.ts` 只宣告 `user` + `account`；session / verification 由 better-auth 以 raw SQL 處理，不經過 drizzle `timestamp_ms` mapper，drift 不觸發 `RangeError`。migration scope 維持 user + account。
- **Q4 (已決)**：`account` 表除了 `createdAt` / `updatedAt` 外，是否還有其他 timestamp_ms 欄位？→ **是**。drizzle 宣告 `accessTokenExpiresAt` 與 `refreshTokenExpiresAt` 亦為 integer timestamp_ms，production D1 為 TEXT，納入同一 migration。
