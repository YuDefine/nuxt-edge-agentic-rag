## Why

Migration 0010（fk-cascade-repair-for-self-delete）在重建 mcp_tokens / query_logs / citation_records / messages 四張表時，子表的 FK 文字寫成 `REFERENCES *_new(id)`，假設後續 `ALTER TABLE ... RENAME` 會把 `_new` 改寫回 canonical 名稱。此假設在 Cloudflare D1（modern SQLite，`legacy_alter_table = OFF`）成立，但在 NuxtHub local dev 用的 libsql（預設 `legacy_alter_table = 1`）失敗——FK 文字殘留 `_new`，而 `_new` 表已被 RENAME，任何 INSERT 直接炸 `SQLITE_ERROR: no such table: main.*_new`。

TD-051（migration 0012）已修了 `account` / `session` / `passkey` 三張對 `user_new` 的同類問題，但漏掉 `mcp_tokens_new` / `query_logs_new` 鏈上的三張。發現於 `add-sse-resilience` §7.1 local heartbeat 驗證：`POST /api/chat` 的 `createQueryLog` / `createMessage` / `createCitationRecord` 都連環炸。

Production D1 不受影響（FK 文字已是 canonical 名稱）；fresh local libsql DB 全炸——本地 chat / MCP 工具流任何 query_log + message + citation 寫入都不能跑。

## What Changes

- 新增 `server/database/migrations/0015_fk_rebuild_query_logs_chain.sql`，仿 migration 0012 的 explicit-FK rebuild pattern：
  - 開頭 `PRAGMA legacy_alter_table = OFF` + `PRAGMA defer_foreign_keys = ON`。
  - 對三張表分別 rebuild：`query_logs_v15`（FK → `mcp_tokens(id)` ON DELETE SET NULL）、`citation_records_v15`（FK → `query_logs(id)` ON DELETE CASCADE）、`messages_v15`（FK → `query_logs(id)` ON DELETE SET NULL）。
  - Build 三張 `_v15` → INSERT SELECT → 子→父順序 DROP（messages → citation_records → query_logs）→ RENAME 三張 → recreate 五個索引（`idx_query_logs_channel_created_at`、`idx_messages_query_log_id`、`idx_messages_conversation_created_at`、`idx_citation_records_query_log_id`、`idx_citation_records_expires_at`）→ 收尾 `PRAGMA foreign_key_check`。
- 結果上 idempotent：對已正確的 production D1 → 慢 no-op；對 FK 殘留 `_new` 的 fresh local libsql → 修正 FK ref。
- TD-055 entry 在 `docs/tech-debt.md` 從 Status: open 翻為 Status: done（Acceptance 條件全部達成）。

## Non-Goals

- **不新增、不刪除、不重命名任何 column**。三張表的 column shape 完全保留 0010 + 0011（`workers_ai_runs_json`）+ 0013（`refused`）+ 0014（`refusal_reason`）後的最終 schema。
- **不改 application code、drizzle schema、API contract、shared types**。drizzle `server/db/schema.ts` 的 `queryLogs` / `messages` / `citationRecords` 已經宣告 canonical FK ref，本 migration 只是讓 live DB 的 FK text 對齊這個宣告。
- **不嘗試一次性偵測並掃除任何「其他 `_new` 殘留」**。Discovery 用 `.dump | grep "REFERENCES [a-z_]*_new("` 已確認只有這三張漏網（mcp_tokens 自身的 created_by_user_id 已 OK、user 子表已被 0012 修復）。若未來再發現其他漏網，另起 change 處理，不擴張本 change scope。
- **不調整 `member_role_changes`**。0010 已把它改成「無 FK」，不在本 fix 範圍。
- **不啟用 `PRAGMA foreign_keys = ON`**。NuxtHub local libsql 預設 foreign_keys = 0，這是 SQLite 預設值；改變這個設定屬於另一條獨立工作（會影響全 repo 的 DROP TABLE 流程）。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth-storage-consistency`: 補一條新的 Requirement「Live DDL Foreign Key References Match Canonical Table Names」——把「`PRAGMA foreign_key_list` 顯示的 FK 已綁正確 `ON DELETE` policy」這個既有 requirement 推進一步，要求 `sqlite_master.sql` 的 stored DDL **文字本身**不得殘留 `*_new` 字樣。先前 `Rebuild Migration Preserves Row Counts And Integrity` 只檢查 row count + `foreign_key_check`，未檢查 DDL 文字；TD-055 漏網表的 FK 雖然 `foreign_key_list` 顯示「指向 mcp_tokens / query_logs」，但 stored CREATE TABLE 文字仍是 `REFERENCES *_new(id)`，runtime 解析時定址到不存在的 `_new` 表（這是 libsql 的 `legacy_alter_table = 1` 行為）。新 requirement 顯式擋住這類 silent drift。

## Impact

- Affected specs: `auth-storage-consistency`（ADDED 一條新 Requirement，無 MODIFIED / REMOVED）
- Affected code:
  - New: `server/database/migrations/0015_fk_rebuild_query_logs_chain.sql`
  - Modified: `docs/tech-debt.md`（TD-055 翻 done + Resolved 註記；register Index 表 Status 同步）
  - Removed: (none)
- Affected runtime / data:
  - Production D1：DDL 文字無變化（FK 已是 canonical），三張表全 rebuild 為慢 no-op；資料量級下預期 < 30 秒。
  - Local libsql：DDL 文字 `REFERENCES *_new(id)` → `REFERENCES <canonical>(id)`；所有現有 row 透過 INSERT SELECT 完整搬移。
  - 受影響表：`query_logs`、`messages`、`citation_records`（三張完全 rebuild）。
  - 受影響索引：上述五個 named index recreate；`UNIQUE` constraint 跟著 column 走無需顯式 recreate。
- Backend-only：**No user-facing journey (backend-only)**。理由：純 DB DDL 修補，所有觀察面（Web chat、MCP tool 呼叫、admin dashboard）的 API contract 不變；僅修復 fresh local libsql 的 INSERT 路徑。
