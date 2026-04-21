## Why

兩個 endpoint 仍以 `db.all(sql\`...\`)` 走 drizzle 的 D1-specific tagged-template raw SQL pattern：

- `server/api/auth/me/credentials.get.ts` 的 user row 查詢（line 68-72）
- `server/api/admin/members/index.get.ts` 的 count + list 兩條 query（line 126-163）

此 pattern 在 production Cloudflare D1 正常，但在 local dev 的 libsql 環境下 `db.all` 不存在／行為不同，**兩個頁面在 local 永遠回 500 / error state**。後果：

- `/account/settings` 與 `/admin/members` 無法在 local 渲染 happy path
- `passkey-authentication` §16 Design Review 響應式截圖 6/12 只能拍 error state，happy path 必須留待 production 驗證
- §16 Design Review pipeline 被實質阻擋，無法在 local 完成響應式 fidelity check

同類問題已在 TD-001 以 Drizzle ORM 修好（canonical pattern: `server/utils/mcp-token-store.ts`）。TD-010 為此補完，登記於 `docs/tech-debt.md` Status: open, Priority: mid。

## What Changes

- **`server/api/auth/me/credentials.get.ts`**: 將 line 68-72 的 `db.all(sql\`SELECT email, display_name FROM "user" WHERE id = ${userId} LIMIT 1\`)` 改為 drizzle query builder：
  - `db.select({ email: schema.user.email, displayName: schema.user.displayName }).from(schema.user).where(eq(schema.user.id, userId)).limit(1)`
  - FD-001 已將 `schema.user.displayName.fieldName = 'display_name'`，drizzle 直接讀到 snake_case column，**不需** COALESCE fallback
  - 現檔 line 90-107 的 account / passkey 查詢已是 drizzle，本次不動
- **`server/api/admin/members/index.get.ts`**: 完整重寫 line 102-192 的 count + list handler：
  - count：`db.select({ n: count() }).from(schema.user).where(roleFilter)`（`count` 從 `drizzle-orm`）
  - list：改為多條 drizzle query 組合（user list + per-page account/passkey/session lookup）並在應用層 reduce 為 `has_google` / `has_passkey` / `last_activity_at`
  - 移除 `RawMemberRow` interface、`__sql` template 攔截、手寫 `orderByClause` / `roleFilter` raw SQL
  - `registeredAt` = `user.createdAt`、`lastActivityAt` = `MAX(session.updatedAt)` with fallback to `user.updatedAt`
  - `credentialTypes` 聚合邏輯（`toCredentialTypes`）保留；`toIsoOrNull` 只保留「drizzle 路徑可能回傳的 Date / null」兩支，其餘 numeric / string epoch 分支可清除（drizzle timestamp mapper 統一回 Date 或 null）
- **Test mock 改寫**：
  - `test/integration/admin-members-list.spec.ts` 與 `test/integration/admin-members-passkey-columns.spec.ts` 目前 mock `db.all(query)` + 解析 `__sql` tagged template。refactor 後改 mock `hub:db` 的 drizzle query builder chain（`db.select(...).from(...).leftJoin(...).where(...).groupBy(...).orderBy(...).limit(...).offset(...)` 與 `db.select({n:count()}).from(...)`）。覆蓋率與斷言不變。
- **新 integration test**：`test/integration/account-settings-credentials.spec.ts` 覆蓋 `/api/auth/me/credentials` 的 drizzle 路徑（user row not found → 404、有 session → 200 回 email/displayName/hasGoogle/passkeys），以 drizzle mock chain 同上。
- `server/db/schema.ts`、migrations、`.vue` 檔、better-auth config、response schema、`handleDbError` 邏輯、其他 endpoint 皆**不變**。

## Non-Goals

> 本 change 略過 design.md 中的 Goals/Non-Goals（design.md 會補完），但仍在 proposal 保留明確 scope exclusion 以避免漂移。

- **NEVER** 重構其他 raw SQL callers：`server/api/**` / `server/mcp/tools/**` / `server/tasks/retention-cleanup.ts` 尚有 `getD1Database()` / `db.all(sql\`...\`)` pattern 的檔案不在本 scope，留待未來新 TD 評估
- **NEVER** 變更兩 endpoint 的 response schema（`hasGoogle`, `passkeys[]`, `credentialTypes`, `registeredAt`, `lastActivityAt`, `role`, `displayName`, `email` 欄位維持一致）
- **NEVER** 變更 status code / error message / `createError` 結構（local + production 的 error 行為一致）
- **NEVER** 引入 DB migration 或 schema 變更
- **NEVER** 修改 `.vue` 檔或 UI 行為
- **NEVER** 改 better-auth config / `hub:db` schema 對齊
- **NEVER** 改 `handleDbError` 或 log.error 規則（遵守 `logging.md`：`handleDbError` returns 必須自行 throw、`log.error` 只記非預期）
- **NEVER** 新增 `/api/admin/members` endpoint 的 filter 欄位或 sort 選項
- **NEVER** 重寫 `server/api/admin/members/[userId].patch.ts`（已用 drizzle，不在 scope）

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth-storage-consistency`: 新增 Requirement「Credentials And Member List Endpoints Use Portable ORM Layer」——明確規定 `/api/auth/me/credentials` 與 `/api/admin/members` 的 DB 讀取 MUST 走 drizzle query builder（型別安全、跨 driver 相容），不得依賴 D1-specific `db.all(sql\`...\`)` tagged-template API。此 requirement 是 TD-001 + TD-010 經驗的 spec-level 固化，避免未來類似 regression。`admin-member-management-ui`/`passkey-authentication`/`responsive-and-a11y-foundation` 三者的 behavioral requirement 不變，不需 delta。

## Impact

- **Affected specs**: `auth-storage-consistency`（ADDED Requirement；無 MODIFIED / REMOVED）
- **Affected code**:
  - `server/api/auth/me/credentials.get.ts`（refactor：user row 查詢改 drizzle）
  - `server/api/admin/members/index.get.ts`（refactor：count + list 改 drizzle query builder）
  - `test/integration/admin-members-list.spec.ts`（mock 改寫為 drizzle query builder chain）
  - `test/integration/admin-members-passkey-columns.spec.ts`（mock 改寫為 drizzle query builder chain）
  - `test/integration/account-settings-credentials.spec.ts`（新增）
- **Affected runtime**: 無（無 migration、無 deploy 前置作業）。local dev + production D1 皆 live 後立即生效。
- **Affected user journey**:
  - 使用者行為**不變**（response / UI 完全一致）
  - **Developer Journey 可驗證性補完**：`passkey-authentication` §16 Design Review pipeline 可在 local 驗 `/account/settings` + `/admin/members` 響應式 happy path（xs 360 / md 768 / xl 1280），解除 TD-010 的 local blocker
- **Risk**:
  - Drizzle query builder chain 與原 raw SQL 的 EXISTS + MAX aggregation 語意等價性需在 test / manual 驗證（特別是 `lastActivityAt` 的 fallback 行為與 `credentialTypes` 空集合 edge case）
  - Per-page N+1 風險：若採「user list + per-page lookup」策略，需確認 page size = 20 時仍在可接受範圍（應用層 reduce 比 SQL EXISTS 多 2-3 次 DB 讀取）；若超過預算改採 `leftJoin` + `groupBy` + `max()` / `count()` 策略。具體選擇在 design.md 決定。
- **Review tier**: **Tier 2**（`spectra-audit` + `code-review` agent）— 兩 endpoint refactor 加測試 mock 重寫估計 > 50 行 non-敏感變更。依 `review-tiers.md` 無涉及 migration / RLS / auth middleware，不需 Tier 3。
- **Follow-up marker**: 所有 tasks **MUST** 帶 `@followup[TD-010]`（TD-010 已登記 `docs/tech-debt.md` Status: open, Priority: mid）
- **No `.vue` change**: 本 change 不觸發 Design Review tasks（依 `proactive-skills.md` 非 UI Change 的例外），但 tasks.md 會加一條 `review-screenshot` 驗 local happy path（確認 refactor 解除了 §16 blocker）
