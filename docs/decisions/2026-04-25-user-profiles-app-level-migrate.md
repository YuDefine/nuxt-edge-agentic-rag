# User Profiles App-Level Migrate For Session ID Drift (TD-044)

## Decision

當 `session.create.before` hook 在 `user_profiles` 同步時撞到 `UNIQUE(email_normalized)` 衝突（stale row 的 `id` 與當前 better-auth `user.id` 不同），採用**應用層事務遷移**子表的 FK，不改 SQLite schema 的 FK cascade 規則：

1. 用 `email_normalized` 當入口查現有 row（取代原 `onConflictDoUpdate` on id 的 catch-swallow pattern）
2. 無 row → INSERT；id 相同 → UPDATE 非 id 欄位；id 不同 → 進 migrate transaction
3. Migrate tx 順序：`conversations` / `query_logs` / `messages` 的 `user_profile_id`、`documents.created_by_user_id` 先指到新 id，最後把 `user_profiles.id` flip 到新 id
4. Catch handler 在 `process.env.NODE_ENV !== 'production'` 時 rethrow（local / staging / preview 顯性失敗）；production swallow + actionable log hint（redacted email + 固定 hint 字串）

具體實作 locked 在 `server/utils/user-profile-sync.ts` 的 `syncUserProfile`，hook 只負責組 input 並呼叫。

## Context

Bug 發現於 `consolidate-conversation-history-config` §7.4 人工檢查：local dev 多次 `/_dev/login` + reset DB 後，`/api/chat` 隨機 500 `FOREIGN KEY constraint failed`。Root cause：`user_profiles.email_normalized` 有 `NOT NULL UNIQUE`，但原 `onConflictDoUpdate` 的 target 是 `user_profiles.id`。當 DB 內有同 `email_normalized` 但不同 `id` 的 stale row（better-auth `user` 刪重建會觸發），UNIQUE 衝突被 catch swallow → 新 user 在 `user_profiles` 完全沒 row → 任何依 `user_profile_id` FK 的寫入全 500。

Schema 限制（`server/database/migrations/0001_bootstrap_v1_core.sql`）：`conversations` / `query_logs` / `messages.user_profile_id` 與 `documents.created_by_user_id` 全是 bare `REFERENCES user_profiles(id)`，SQLite 預設 `NO ACTION` — 也就是 parent `id` 改動會讓 children 直接變孤兒或 FK fail。

## Alternatives Considered

- **方案 A — Schema 改 `ON UPDATE CASCADE`**
  - 優：parent `id` 一 flip，children 自動跟上，hook 邏輯單純
  - 缺：SQLite 改 FK cascade 需對每張 child 表走 new-table + copy + drop + rename（參見 `0010_fk_cascade_repair.sql` 的 300+ 行 SQL 量級）；總 migration 成本高，觸動面大
  - 否決：本 bug 觸發頻率低（stale row 只發生在 better-auth user 手動刪重建），用 Tier 3 migration 成本換掉可控的 app-level 修復不划算

- **方案 B — `onConflictDoUpdate` target 改 `email_normalized` + `SET id = excluded.id`**
  - 優：改動最小
  - 缺：不改 FK cascade 的話，`UPDATE user_profiles SET id = ...` 會在 children 仍指向舊 id 時直接 FK fail（SQLite `NO ACTION`）
  - 否決：要讓它 work 必須先有方案 A 的 cascade，與原本想避免的代價一樣

- **方案 C — 本方案（app-level SELECT → migrate tx → upsert）**
  - 優：stale 情境才會觸發 migrate；正常 path 成本只多一次 `SELECT`；完全不動 schema；測試好寫（可用 drizzle builder spy 驗呼叫順序與參數）
  - 缺：app-level 事務語意依賴 `db.transaction(...)` 在 D1 / NuxtHub runtime 的實作保證（drizzle 對 D1 底層走 `BEGIN ... COMMIT`）；若未來要加 per-table retry 需要 re-evaluate
  - 採用

## Reasoning

本 bug 的 cost function 不對稱：

- **資料安全**：children 若變孤兒（方案 A/B 若沒完整 cascade）是不可逆損害；app-level migrate 在 tx 內原子操作，失敗就全 rollback，沒有部分成功的污染狀態
- **日常路徑成本**：hook 在每次 login 都跑；多一次 `SELECT ... LIMIT 1` 的 overhead 可忽略（primary key + unique index 查詢）
- **觸發頻率**：stale row 情境只在手動刪 `user` 表後才發生，實務上只有 local dev / 極端運維；production 正常流程根本不會踩
- **可測試性**：app-level 邏輯能在 vitest 用 drizzle builder spy 覆蓋 4 個分支 + 2 個 env，無需整套 D1 runtime

`NODE_ENV` env-gate rethrow 是另一個不對稱：dev miss bug 的 cost（反覆撞隨機 500 無法定位真因）> prod 偶發 block-login 的 cost（hook transient failure 可能來自 D1 timeout 等 infra 瞬斷），所以選保守：非 production 都 rethrow，production 維持現行保守行為 + 補 actionable log hint。

## Trade-offs Accepted

- **Schema 未對齊「FK cascade 保證 parent-id 安全更新」這個抽象 invariant**。未來若有同類需求再出現（例如其他表需要 id 重綁），每次都要在應用層寫 migrate，無法靠 schema 提供預設安全網。若未來 TD-009 或其他 migration 觸動 `user_profiles` schema，順帶把 `ON UPDATE CASCADE` 補上是合理後續。
- **`db.transaction` 的 D1 / NuxtHub 原子性依賴 drizzle 實作**。若 runtime 底層不支援 SAVEPOINT，migrate tx 只能整成或整敗，本 change 沒寫 per-table retry 邏輯（依據 proposal Non-Goals 排除）。實務上「整成或整敗」已足夠：失敗後 log 出 hint，下次 login 會自然重試（WHERE 條件冪等）。
- **Production catch 仍 swallow**。理論上某些 hook error 到 production 仍無從告警（除了 log.error 出現 hint 字串以外）。Observability 的長期解法屬 evlog / Sentry 升級議題，不在本 change scope。

## Supersedes

無。本文件是 TD-044 的首次決策記錄。若未來評估方案 A（cascade migration）落地，可 supersede 本文件的 Schema 判斷段落。
