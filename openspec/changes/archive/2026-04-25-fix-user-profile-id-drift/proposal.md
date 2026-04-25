## Why

`session.create.before` 在每次登入時把 `user` id 對應的 `user_profiles` row upsert 起來（作為 `conversations` / `query_logs` / `messages` / `documents.created_by_user_id` 的 FK target）。目前 upsert 的 conflict target 是 `user_profiles.id`，但 `user_profiles.email_normalized` 帶 `NOT NULL UNIQUE`。當 DB 內已有同 `email_normalized` 但不同 `id` 的 stale row（最常見成因：better-auth `user` 表被手動刪除重建產生新 id），hook 撞 UNIQUE(email_normalized) → catch 整個吞掉 → **新 better-auth user 在 `user_profiles` 裡沒對應 row**。

後果：任何依 `user_profile_id` FK 的寫入都 500（`D1_ERROR: FOREIGN KEY constraint failed`），UI 反應是「登入成功但 /api/chat 一直失敗」。Production D1 目前未重現，但 local dev 在多次 `/_dev/login` / reset DB 後極易卡到，人工檢查 / screenshot review / 任何依 `/api/chat` 的 e2e 隨機失敗且錯誤訊息無揭露真因（TD-044）。

## What Changes

- `session.create.before` 的 user_profiles 同步改為 **email_normalized-first 查找 → 必要時 app-level 遷移 children.user_profile_id → upsert `user_profiles` row 的 id 指向當前 better-auth user**。不改資料庫 FK schema（避免動 ON UPDATE CASCADE 觸發全表 rebuild）。
- `catch` 在 `NODE_ENV !== 'production'` 改為 `throw` — local / staging 立刻 fail fast，production 保留保守行為。
- `log.error` 在 production catch 路徑改為帶 **actionable hint** 的 structured fields（`hint: 'Stale user_profiles row may exist with email_normalized = <redacted>; investigate and migrate children FKs.'`），供下次 debug 不需重讀本 entry。
- 新增 unit test 覆蓋：
  - stale row 指向舊 id、相同 `email_normalized` → hook 成功把 children 遷移到新 id、`user_profiles` row 由新 id 接管
  - 新增 user 無 stale row → 走原本 insert 路徑
  - `catch` 行為在 `NODE_ENV !== 'production'` / `=== 'production'` 的差異
- `server/auth.config.ts` hook 邏輯改動後，`openspec/specs/auth-storage-consistency/spec.md` 新增一條 Requirement 規範 `session.create.before` 的 UNIQUE(email_normalized) 衝突處理。

## Non-Goals

- **不改 `user_profiles` / children 的 FK 為 ON UPDATE CASCADE**。SQLite 改這個需要整表 rebuild（每個 child table 一次 new-table + copy + drop + rename），屬獨立 migration scope，且 `0010_fk_cascade_repair.sql` 已有先例顯示成本高。App-level migrate 更可控，且本 bug 觸發頻率低（只在 better-auth user 刪重建時出現）。
- **不改 `user_profiles.email_normalized` 為 nullable（TD-009）**。那是獨立議題，與本 bug 的 UNIQUE 衝突不同路徑；TD-009 修掉後可進一步簡化本 hook，但現況即可自洽。
- **不改 better-auth `user` 表 schema**。Stale user_profiles row 是 symptom，不是 cause — cause 是本 hook 的 conflict target 選錯；不需要動 upstream。
- **不處理 TD-047（SSE ready-then-error orphan conversation）**。那是獨立 bug，即使本 TD 修完 FK 不再 failed 500，SSE 早 persist 後的 error 流程仍需 TD-047 另行修復。
- **不新增 integration test 實際 call better-auth hook 全流程**。Hook 執行環境是 better-auth runtime，mock 完整 flow 成本高；用 unit test 針對 drizzle query builder 對 stubbed `hubDb` 的互動驗證即可。

## Affected Entity Matrix

### Entity: `user_profiles`

| Dimension       | Values                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Columns touched | `id` (行為：UPDATE stale row → 指向新 better-auth user.id)                                            |
| Roles           | admin, member, guest（所有 session 建立時都跑 hook）                                                  |
| Actions         | upsert (email_normalized 衝突時改走 migrate + update id 路徑)                                         |
| States          | normal / stale-row-exists / stale-row-migrated / rethrown-non-prod                                    |
| Surfaces        | 無 UI（hook 為 server 內部）；間接影響 `/api/chat`、`/api/admin/*`、`/api/conversations/*` 寫入成功率 |

### Entity: `conversations` / `query_logs` / `messages` / `documents`（children）

| Dimension       | Values                                                   |
| --------------- | -------------------------------------------------------- |
| Columns touched | `user_profile_id`（migrate 時 app-level UPDATE 到新 id） |
| Roles           | 依各表原有權限（本 change 不動權限）                     |
| Actions         | UPDATE（只在 stale 情境觸發；正常流程無變化）            |
| States          | normal（FK 指向有效 user_profiles.id）                   |
| Surfaces        | 無直接 UI 變化                                           |

## User Journeys

**No user-facing journey (backend-only)**

理由：本 change 修正 `session.create.before` hook 的 UNIQUE 衝突處理邏輯。從使用者視角：

- 修前（stale user_profiles row 情境）：登入成功 → 後續 `/api/chat` 500 → UI 顯示「Chat failed」
- 修後：登入成功 → 後續 `/api/chat` 200 → 正常對話

使用者看不到 hook 本身；只看得到「/api/chat 不再神秘 500」的結果。驗證方式：local dev 重現（刪 better-auth `user` row 後重新 `/_dev/login` + /api/chat），對照 hook 是否成功遷移 children 並 upsert user_profiles。

## Implementation Risk Plan

- **Truth layer / invariants**：`user_profiles.id` 必須在 session 建立後對應當前 better-auth `user.id`；children 表（`conversations.user_profile_id` 等）必須永遠 point to 有效 `user_profiles.id`。Hook 是**單一真相維持者**，若失敗則下游寫入全部踩 FK。本 change 在 email_normalized 衝突時選擇 app-level migrate children，invariant 仍成立。
- **Review tier**：**Tier 3**（auth 路徑 + 多表 UPDATE）。`spectra-audit` + code review 必跑；rethrow-in-non-prod 的行為需 `docs/decisions/` 記錄。
- **Contract / failure paths**：
  - **success path**：無 stale row → 原 insert；有 stale + 相同 id → 原 onConflictDoUpdate on id
  - **migrate path**：有 stale + 不同 id → tx (UPDATE children.user_profile_id → UPDATE user_profiles.id → commit)；失敗 → rollback + log + production 仍返（不 block login）
  - **non-production unhandled**：任何非預期 error → rethrow，讓 pnpm dev 終端立即顯示錯誤棧
  - **production unhandled**：log.error 帶 actionable hint，不 rethrow（保留現行保守行為）
- **Test plan**：
  - unit：stub `hubDb` 對 insert / update / select 的回應，覆蓋 4 條路徑 + 2 個 `NODE_ENV` 分支
  - 人工驗證（本 change 不補 integration test 但 Acceptance 必過）：local `rm .data/db/sqlite.db && ... && pnpm dev` rebuild → `/_dev/login` + /api/chat 首次 200；再手動刪 better-auth `user` row + 重 login + /api/chat 不再 500
  - 不寫 e2e — hook 環境建構成本高，單元測試覆蓋 query builder 互動即可
- **Artifact sync**：
  - `openspec/specs/auth-storage-consistency/spec.md` 新增 Requirement + 3 個 Scenario（衝突 / migrate / rethrow）
  - `docs/tech-debt.md` TD-044 Status `open` → `in-progress`（apply 時）→ `done`（archive 時）
  - `docs/decisions/YYYY-MM-DD-user-profiles-app-level-migrate.md` 記錄為何不走 ON UPDATE CASCADE
  - `openspec/ROADMAP.md` MANUAL 由 hook sync 自動處理
  - HANDOFF 不需新增（change 自己在 active changes 裡）

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth-storage-consistency`: 新增 Requirement 規範 `session.create.before` 在 `user_profiles.email_normalized` UNIQUE 衝突時的行為（email_normalized-first 查找 → app-level migrate children → upsert `user_profiles.id`），以及 `NODE_ENV !== 'production'` 時 rethrow 的契約。

## Impact

- Affected specs: `auth-storage-consistency`（新增 Requirement + 3 Scenarios）
- Affected code:
  - Modified:
    - server/auth.config.ts（`session.create.before` hook 的 `user_profiles` upsert 區段，L487-513）
  - New:
    - test/unit/auth-user-profiles-sync.spec.ts（覆蓋 4 條路徑 + 2 個 env 分支）
    - docs/decisions/2026-04-25-user-profiles-app-level-migrate.md（為何不走 ON UPDATE CASCADE）
  - Removed: (none)
- Affected runtime: better-auth `session.create.before` hook；D1 `user_profiles` + 4 children 表的寫入路徑。
- Affected config / env: 讀 `process.env.NODE_ENV` 做 rethrow 分支；不新增任何 env / binding。
- Affected documentation: `docs/tech-debt.md` TD-044 entry 的 Status + Acceptance 勾勾。
