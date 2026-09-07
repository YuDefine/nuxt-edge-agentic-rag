## Why

**TD-009** — `passkey-authentication` change（已 archive）的 design 原本規劃 `user_profiles.email_normalized` 同步改 NULL，落實「passkey-only 使用者不需要 email」的完整語意。但 migration 0009 因規模考量延後此項：0009 已經 rebuild `user` 樹的 8 張表（user / account / session / member_role_changes / mcp_tokens / query_logs / citation_records / messages），再加 `user_profiles` 樹（FK children: `conversations`、`query_logs`、`messages`、`documents`）會讓單一 migration 超過 700+ 行 SQL，超出安全 review surface。

當下的 workaround：passkey-only 使用者的 `user_profiles.email_normalized` 寫入 sentinel 值 `'__passkey__:' || user.id` 維持 UNIQUE constraint，並在所有 email 比對 code path（`isAdminEmailAllowlisted` 等）靠 `:` 不是合法 email 字元 implicit 排除。

這個 sentinel workaround 有三個問題：

1. **語意 leak**：sentinel 值是 truth source 不一致——「passkey-only user」應該是「`email_normalized IS NULL`」，現在卻是「`email_normalized LIKE '__passkey__:%'`」，未來新增 email 比對 code path 容易踩錯
2. **稽核 / 觀察成本**：admin / debug 看 `user_profiles` row 看到 `__passkey__:abc123` 不直觀，要查 schema 才知道是 sentinel
3. **migration 壓力延後不解決**：TD-009 自 2026-04-21 標記至今 mid priority open，schema 漂移時間越久成本越高

本 change 是 `passkey-authentication` 的 deferred follow-up，把 sentinel workaround 替換成正規的 NULL + partial unique index。

## What Changes

- 新增 migration 0016 rebuild `user_profiles` + FK children（`conversations` / `query_logs` / `messages` / `documents`），仿 0007 / 0009 的 D1 cascade rebuild 模式（`PRAGMA foreign_keys = OFF` → drop indexes → rename `user_profiles` → create new `user_profiles` with NULL email_normalized → copy data → recreate FK children referencing new table → drop old → re-enable FK + indexes）
- `user_profiles.email_normalized` 從 `TEXT NOT NULL` 改為 `TEXT`（nullable）+ partial unique index `WHERE email_normalized IS NOT NULL AND email_normalized NOT LIKE '__passkey__:%'`（partial 的 NOT LIKE 部分是過渡：data migration 跑完後就只剩 NULL 與真實 email，但 partial 留 NOT LIKE 防 backfill 漏掉的 sentinel row 衝突）
- Data migration（0010 同 transaction 內）：`UPDATE user_profiles SET email_normalized = NULL WHERE email_normalized LIKE '__passkey__:%'`
- `server/utils/` 中 user_profiles upsert 邏輯（`server/auth.config.ts:syncUserProfile` + 任何寫 sentinel 的 code path）改為直接寫 `NULL`，不再產 sentinel
- 所有 email 比對 code path（`isAdminEmailAllowlisted` 等）加 `email_normalized IS NOT NULL` guard，並移除「`isAdminEmailAllowlisted` 靠 sentinel 含 `:` 隱式排除」的 implicit 假設
- `auth-storage-consistency` spec 修改 Requirement「User Email Is Nullable With Partial Unique Index」：移除 sentinel scenario + 移除 deferred follow-up note，新增 scenario「user_profiles.email_normalized stores NULL for passkey-only users」+ scenario「sentinel values are migrated to NULL on schema rebuild」
- archive 時 `docs/tech-debt.md` 把 TD-009 改 done + Resolved 紀錄

## Non-Goals

- **NEVER** 改 `user.email` schema（已在 0009 改 nullable，本 change 只動 `user_profiles.email_normalized`）
- **NEVER** rebuild `user` 樹或 `user_profiles` 之外的表（FK children 範圍嚴格限定 `conversations` / `query_logs` / `messages` / `documents`）
- **NEVER** 改 `session.create.before` hook 的 email_normalized-first lookup 邏輯（fix-user-profile-id-drift archive 已 land，本 change 沿用）
- **NEVER** 引入 schema feature flag（schema migration 必須前向相容；不允許「flag false 走舊 sentinel」）
- **NEVER** 改 `isAdminEmailAllowlisted` 行為語意（passkey-only 使用者本來就不應符合 allowlist，行為不變；只是底層機制從「sentinel 含 `:`」變成「值為 NULL」）
- **NEVER** 同 transaction 動 user 或 account 表（避免 0010 super-migration）

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth-storage-consistency`: 修改 User Email Is Nullable With Partial Unique Index requirement —— 移除 sentinel scenario、新增純 NULL scenario + sentinel data migration scenario；移除 deferred follow-up note

## Affected Entity Matrix

### Entity: user_profiles

| Dimension       | Values                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Columns touched | `email_normalized`（NOT NULL → nullable + partial unique index 改寫）                                                                                                                |
| Roles           | system migration（無 admin / staff / guest UI 觸動）                                                                                                                                 |
| Actions         | rebuild table + data backfill（sentinel → NULL）                                                                                                                                     |
| States          | pre-migration（sentinel 存在）/ post-migration（純 NULL）                                                                                                                            |
| Surfaces        | `server/auth.config.ts:syncUserProfile`（upsert 邏輯）、`server/utils/admin-allowlist.ts`（或對應檔，`isAdminEmailAllowlisted`）、所有讀 user_profiles.email_normalized 的 code path |

### Entity: FK children of user_profiles（read-only rebuild）

| Dimension      | Values                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------- |
| Tables         | `conversations`、`query_logs`、`messages`、`documents`                                       |
| Reason         | D1 sqlite 的 `ALTER TABLE` 限制，rebuild parent 必須 cascade rebuild children                |
| Schema changes | 表本身結構不變，只 recreate（DROP + CREATE LIKE + INSERT SELECT），FK 重指向新 user_profiles |
| Data integrity | `PRAGMA foreign_key_check` post-migration 必須零 row                                         |

## User Journeys

**No user-facing journey (backend-only schema migration)**

理由：本 change 純粹改 schema 與 server-side upsert 邏輯。Web UI / admin UI / chat / MCP 流程行為皆不變：

- passkey-only 使用者註冊 / 登入後 `user_profiles.email_normalized = NULL`（之前是 sentinel）—— 兩種 representation 對 UI 等效（都不顯示 email、不入 admin allowlist）
- Google 登入使用者：`email_normalized = "alice@example.com"`（不變）
- admin allowlist 比對：行為等價（passkey-only 之前靠 sentinel implicit 排除，現在靠 `IS NOT NULL` 顯式排除）

唯一可感知差異是 admin / debug 直接查 `user_profiles` row 看到 NULL 而非 `__passkey__:abc`，但這不是 user-facing surface。

## Implementation Risk Plan

- **Truth layer / invariants**: `user_profiles.email_normalized` 是「使用者 email 的 normalized 形式」的 truth source；passkey-only user 對應 NULL 是新 invariant；既有「PK = better-auth user.id」、「user_profiles row 與 user row 1:1」、「FK children 引用 user_profiles.id」等 invariant 全部保留。Migration 與 data backfill 必須在同一 transaction 內，跨 statement 失敗整體 rollback；`PRAGMA foreign_keys = OFF` 期間發生失敗需手動 verify 一致性。
- **Review tier**: **Tier 3** — schema migration、動 user_profiles + 4 FK children、影響 auth code path（admin allowlist）、需要 raw SQL；spectra-audit + code review + screenshot review（passkey-only / Google login 雙 path）+ 可能需要 second-opinion review。
- **Contract / failure paths**: (1) Migration 跑到一半失敗 → transaction rollback，user_profiles 與 children 維持原狀；(2) 既有 sentinel data 漏掃 → partial unique index 的 `NOT LIKE '__passkey__:%'` 兜底防 UNIQUE 衝突；(3) `isAdminEmailAllowlisted` 加 NULL guard 漏改 → unit test 新增 NULL input case 強制覆蓋；(4) Local D1 重跑 migration 0016 兩次 → 第二次應 no-op（檢查 `email_normalized` 已 nullable + sentinel row count = 0 才繼續）。
- **Test plan**: Unit — 新加 `test/unit/admin-allowlist-nullable.spec.ts`（NULL input → false、empty string → false、real email match → true）；migration 邏輯本身用 vitest D1 fake 跑 forward + rollback path。Integration — 既有 `test/integration/passkey-authentication-*.spec.ts` 全綠；新加 `test/integration/migration-0016-rebuild-user-profiles.spec.ts` 驗證 rebuild 前後 row count + FK 完整性 + sentinel row 全部變 NULL。Manual evidence — local D1 跑一次 fresh migration（從 0001 → 0010）+ 一次 incremental（從 0009 → 0010 with sentinel data），兩次都通過 `PRAGMA foreign_key_check`；production deploy 用 staging 先跑驗證（staging D1 schema 須先確認包含 0009 + sentinel data）。
- **Artifact sync**: `openspec/specs/auth-storage-consistency/spec.md`（spec delta：MODIFIED requirement）；`docs/tech-debt.md`（archive 時 TD-009 改 done + Resolved）；`server/db/schema.ts`（drizzle declaration 同步 nullable）；無新 env var、無 wrangler binding 變更、無 CHANGELOG（schema migration 標準流程）；archive 時更新 `passkey-authentication` archived spec note（已 land 的 deferred）。

## Impact

- Affected specs: `auth-storage-consistency`（Modified — User Email Is Nullable With Partial Unique Index requirement scenarios 重寫）
- Affected code:
  - Modified: `server/db/schema.ts`、`server/auth.config.ts`、`server/utils/admin-allowlist.ts`（或對應 isAdminEmailAllowlisted 所在檔，apply 階段確認路徑）
  - New: `server/database/migrations/0016_user_profiles_nullable_email.sql`、`test/unit/admin-allowlist-nullable.spec.ts`、`test/integration/migration-0016-rebuild-user-profiles.spec.ts`
  - Removed: (none)
- Dependencies / bindings: 無新 npm package、無新 env var、無新 wrangler binding；migration runner 沿用 NuxtHub `applyMigrationsDuringDev` + production deploy 自動套用機制
- Parallel change coordination: 與 `add-sse-resilience`（active SSE plumbing）+ `add-mcp-token-revoke-do-cleanup`（parked MCP DO cleanup）完全 disjoint files；可獨立 apply 不撞工
