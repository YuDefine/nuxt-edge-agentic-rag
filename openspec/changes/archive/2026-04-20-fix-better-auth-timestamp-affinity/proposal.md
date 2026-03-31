## Why

Production `/api/admin/members` 回 500（`RangeError: Invalid time value`），Admin 無法開啟成員管理頁。

**Root cause**：better-auth 建立的 `user` 表在 production D1 的 column affinity 與 drizzle schema 宣告不一致——

| 欄位                      | Drizzle 宣告                        | Production D1 實際                  |
| ------------------------- | ----------------------------------- | ----------------------------------- |
| `createdAt` / `updatedAt` | `integer({ mode: 'timestamp_ms' })` | `TEXT`，default `CURRENT_TIMESTAMP` |
| `banExpires`              | `integer({ mode: 'timestamp_ms' })` | `TEXT`                              |

Better-auth 在寫入時傳 `Date.now()`（float），SQLite TEXT affinity coerce 成 `"1776332449872.0"` 字串儲存。Drizzle 的 `timestamp_ms` mapper 讀出來做 `new Date("1776332449872.0")` → Invalid Date → `toISOString()` 拋 RangeError。

這是核心閉環之外的實作層 drift bug：v1.0.0 不改 better-auth 的 schema 產生方式，也不改其他 spec-level 行為，僅修正實際儲存型別與 mapper 一致。

## What Changes

**Phase 1 — Endpoint 防禦性修法（止血，已有本機修改）**

- `server/api/admin/members/index.get.ts`：加 `toIsoOrNull()` helper，以 `sql<>` template 繞過 drizzle 的 `timestamp_ms` mapper，改拿原始 driver value 後自行解析字串 / 數值 / Date 三種來源
- `test/integration/admin-members-list.spec.ts`：覆蓋 TEXT `"<ms>.0"` drift / numeric epoch / null / unparseable 四種情境

**Phase 2 — D1 `user` / `account` 表 rebuild migration（治本）**

- 新增 `server/database/migrations/XXXX_better_auth_timestamp_affinity.sql`：
  1. `PRAGMA foreign_keys = OFF`
  2. 依 SQLite 官方 [table rebuild recipe](https://www.sqlite.org/lang_altertable.html) 建立 `user_new` / `account_new`，`createdAt` / `updatedAt` / `banExpires` 改為 `INTEGER`
  3. 以 `CAST(CAST(col AS REAL) AS INTEGER)` 把 `"1776332449872.0"` 轉回 integer 搬遷
  4. `DROP` 舊表、`RENAME` 新表、重建 index / FK
  5. `PRAGMA foreign_keys = ON`
- 本機先以備份的 production D1 dump 演練一次，確認 FK 重建無資料漏失

**Phase 3 — Endpoint cleanup（治本後簡化）**

- 移除 `sql<>` workaround，恢復直接 select `schema.user.createdAt` / `.updatedAt`
- `toIsoOrNull()` 保留作為 defensive（避免未來 driver 回未預期型別再次 500），但 branch 可簡化
- Test 對應調整

## Non-Goals

- **NOT** 更換 better-auth 版本或重產 `.nuxt/better-auth/schema.sqlite.ts`
- **NOT** 調整其他 table（`documents`、`query_logs` 等都用 `text` mode 或 `sqlite-now-text`，與此 bug 無關）
- **NOT** 調整 drizzle schema 宣告（better-auth 擁有 `user` 表，宣告由 generator 控）
- **NOT** 在 migration 內做 data validation／GDPR 清理（獨立 work）
- **NOT** 在同一 change 加新 admin 功能

## Capabilities

### New Capabilities

- `auth-storage-consistency`: 規範 better-auth 相關表（`user` / `account`）在 D1 的實際 column type 必須與 drizzle schema 宣告一致，並要求 admin 讀取端點對 timestamp 提供容錯解析以免 schema drift 造成 500

### Modified Capabilities

（none — 不涉及既有 spec 行為變更）

## Affected Entity Matrix

### Entity: user (better-auth table, lives in D1 via hub:db)

| Dimension       | Values                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Columns touched | `createdAt` / `updatedAt` (both → affinity corrected TEXT → INTEGER), `banExpires` (TEXT → INTEGER)                                       |
| Roles           | admin（透過 `/admin/members` 讀取；其他 role 無 read/write 路徑）                                                                         |
| Actions         | read via `GET /api/admin/members`（本次修正的 surface）；其他既有的 insert / update path（better-auth 內部）受 migration 影響但呼叫端不變 |
| States          | loading / error / unauthorized / empty（所有狀態都由既有 admin-member-management-ui 頁面處理，本次不新增 state）                          |
| Surfaces        | `/admin/members`（唯一 user-facing read surface）；後端直連 SQL 除外                                                                      |

### Entity: account (better-auth table)

| Dimension       | Values                                                            |
| --------------- | ----------------------------------------------------------------- |
| Columns touched | `createdAt` / `updatedAt`（TEXT → INTEGER，migration scope）      |
| Roles           | 無直接 user-facing surface；僅供 better-auth 內部 OAuth flow 使用 |
| Actions         | migration 只動 column type，不改 insert/select path               |
| States          | n/a                                                               |
| Surfaces        | 無（internal to better-auth）                                     |

## User Journeys

### Admin 查看成員列表

- **Admin** 在 `/admin/members` 打開頁面 → 看到使用者列表（email / role / createdAt / updatedAt）→ 時間欄顯示正確 ISO，而非目前的 500 錯誤頁
- 目前（bug 未修）：頁面顯示「Server Error」覆蓋，Admin 被卡住無法做角色管理
- Phase 1 部署後：頁面回復正常，`createdAt` / `updatedAt` 以 Phase 1 defensive parser 還原為 ISO
- Phase 2 部署後：同上，但走 drizzle 原生 `timestamp_ms` mapper（D1 已修型別）
- Phase 3 部署後：endpoint 程式碼簡化，Admin 體感不變

### 新 user Google OAuth 登入

- **新使用者** 點「使用 Google 登入」→ OAuth 回流 → better-auth 建立 `user` row → 成功進入應用
- 目前（bug 未修）：登入成功，但新 row 的 `createdAt` 會被 TEXT affinity 存成 `"<ms>.0"`，之後進入 `/admin/members` 又會再次漂移
- Phase 2 部署後：新 row 的 `createdAt` 以 INTEGER 儲存；未來 admin 讀取永遠走 drizzle 正確 mapper

## Impact

**Affected code**

- `server/api/admin/members/index.get.ts`（Phase 1 修改 → Phase 3 簡化）
- `test/integration/admin-members-list.spec.ts`（新增）
- `server/database/migrations/XXXX_better_auth_timestamp_affinity.sql`（新增）

**Affected systems**

- Production D1 binding `DB`（database `agentic-rag-db`）— Phase 2 migration 執行時需短暫停寫；migration 會影響 `user` 與 `account` 兩表
- Admin `/admin/members` UI surface — Phase 1 部署後回復正常；Phase 3 部署後行為相同（使用者無感知）

**Runtime bindings**

- 無新增 env var / binding

**Review tier**

- **Tier 3**（migration + 動到 auth 相關 `user` 表）：`spectra-audit` + `code-review` agent + 使用者人工檢查
