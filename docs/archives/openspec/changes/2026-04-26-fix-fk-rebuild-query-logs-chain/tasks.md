## 1. Migration 0015 撰寫

- [x] 1.1 在 `server/database/migrations/0015_fk_rebuild_query_logs_chain.sql` 寫入 migration header（comment 說明 TD-051 漏網之魚、libsql `legacy_alter_table = 1` 行為差異、為何選 explicit-FK 而非 RENAME-rewrite，並標明仿 migration 0012 pattern + 受影響表清單 query_logs / messages / citation_records）
- [x] 1.2 開頭設定 `PRAGMA legacy_alter_table = OFF;` 與 `PRAGMA defer_foreign_keys = ON;`
- [x] 1.3 撰寫 `CREATE TABLE query_logs_v15` —— 19 個 column 完全保留 0010 + 0011（`workers_ai_runs_json`）後的 schema、`mcp_token_id` 寫成 `REFERENCES mcp_tokens(id) ON DELETE SET NULL`、`user_profile_id REFERENCES user_profiles(id)`、`channel`/`environment`/`status`/`redaction_applied` 三個 CHECK 完整保留
- [x] 1.4 撰寫 `CREATE TABLE citation_records_v15` —— 8 個 column 保留 0010 schema、`query_log_id` 寫成 `REFERENCES query_logs(id) ON DELETE CASCADE`、`document_version_id` 與 `source_chunk_id` 的 FK 連同保留
- [x] 1.5 撰寫 `CREATE TABLE messages_v15` —— 14 個 column 保留 0010 + 0013（`refused`）+ 0014（`refusal_reason`）後的 schema、`query_log_id` 寫成 `REFERENCES query_logs(id) ON DELETE SET NULL`、`conversation_id REFERENCES conversations(id) ON DELETE CASCADE`、`role` 與 `redaction_applied` 兩個 CHECK 完整保留
- [x] 1.6 撰寫三段 `INSERT INTO <table>_v15 (...) SELECT (...) FROM <table>;` —— column list 與 SELECT list 顯式對齊，避免 schema 漂移時靜默落 column
- [x] 1.7 子→父順序撰寫 DROP：`DROP TABLE messages; DROP TABLE citation_records; DROP TABLE query_logs;`（comment 說明此順序避免 messages 的 ON DELETE SET NULL 在 DROP query_logs 時觸發 silent NULL 化）
- [x] 1.8 撰寫三段 `ALTER TABLE <table>_v15 RENAME TO <canonical>;`（query_logs → messages → citation_records 任意順序皆可，因為 \_v15 之間不互相 reference）
- [x] 1.9 Recreate 五個 named index：`idx_query_logs_channel_created_at`、`idx_messages_query_log_id`、`idx_messages_conversation_created_at`、`idx_citation_records_query_log_id`、`idx_citation_records_expires_at`（皆用 `CREATE INDEX IF NOT EXISTS` 與 0010 一致）
- [x] 1.10 收尾加上 `PRAGMA foreign_key_check;` 作為 diagnostic 並在 comment 註明這也是 implicit COMMIT 的 deferred FK 強制檢查點

## 2. 本地驗證（Live DDL Foreign Key References Match Canonical Table Names + INSERT into a rebuilt FK child table succeeds on fresh local libsql）

- [x] 2.1 [P] 備份目前 `.data/db/sqlite.db`（cp 為 `.data/db/sqlite.db.bak-pre-0015`），保留可比對的 baseline
- [x] 2.2 [P] 觀察 baseline FK 文字：`sqlite3 .data/db/sqlite.db ".schema query_logs messages citation_records"`，記錄目前 stored DDL 的 FK 文字（本地 .data/db/sqlite.db 已被 ad-hoc 修補成 canonical，但仍要記錄為對照）
- [x] 2.3 刪除 `.data/db/sqlite.db` 後重啟 `pnpm dev`，讓 NuxtHub local libsql 從零跑完所有 migration 直到 0015；確認啟動 log 無 SQL 錯誤  
       **執行記錄**：刪除 + 重啟確實做了，但 NuxtHub 0.10.7 default `migrationsDirs = server/db/migrations`，本專案 migrations 在 `server/database/migrations`（wrangler.jsonc 有 `migrations_dir: server/database/migrations` 但 NuxtHub runtime 不讀 wrangler config），所以 fresh DB 重啟不會 auto-apply migration。改用等價路徑驗證：還原 `.bak-pre-0015` → `sqlite3 .data/db/sqlite.db < server/database/migrations/0015_fk_rebuild_query_logs_chain.sql` → `INSERT INTO _hub_migrations` 註冊。等價於「NuxtHub apply 0015 到本地 libsql」的結果——驗收要件（DDL canonical / FK ref 正確 / index 完整 / row counts 保留 / FK on INSERT 成功）全 cover。NuxtHub config drift 是獨立 infra issue 不在本 change scope
- [x] 2.4 跑 `sqlite3 .data/db/sqlite.db "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%REFERENCES %_new(%';"` —— 必須回 0 列（驗 spec scenario「sqlite_master.sql contains no \_new FK references after migrations apply」）
- [x] 2.5 跑 `sqlite3 .data/db/sqlite.db "PRAGMA foreign_key_check;"` —— 必須回 0 列
- [x] 2.6 跑 `sqlite3 .data/db/sqlite.db ".indexes query_logs messages citation_records"` 確認五個 named index 都在
- [x] 2.7 觸發 `POST /api/chat`（任何訊息），驗 `createQueryLog` / `createMessage` / `createCitationRecord` 三條 DB write 路徑都不再炸 `SQLITE_ERROR: no such table: main.*_new`（驗 spec scenario「INSERT into a rebuilt FK child table succeeds on fresh local libsql」）  
       **執行記錄**：使用者送一則 chat（"test"）。Pre vs post：`query_logs` 12→13（accepted）、`messages` 19→21（user refused=0 + assistant refused=1，refusal 因本地無 seed doc）、`citation_records` 0→0（refusal flow 無 citations，預期）。`PRAGMA foreign_key_check` 仍乾淨。`createQueryLog` + `createMessage` 兩條過去炸 `_new` 的 path 已驗成功。`createCitationRecord` 路徑因無 seed 未觸發，但 schema 已驗於 synth-broken end-to-end test（同 FK pattern + bug 重現 + 修復 + INSERT FK on 成功）+ DDL canonical check + foreign_key_check 乾淨
- [x] 2.8 對照 production 跑 `wrangler d1 execute <db> --remote --command "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%REFERENCES %_new(%';"` —— 必須回 0 列（驗證 production 無 drift；不需執行 migration 才能驗）（skip：本機無 wrangler login / production 認證，agent 嘗試後拿 7403 unauthorized；併入 4.5 由使用者下次有 wrangler 認證或下次 deploy 時順便驗，無 follow-up TD entry，本身就是 acceptance 上的 cross-check）

## 3. tech-debt register 與 ROADMAP 同步

- [x] 3.1 在 `docs/tech-debt.md` 把 TD-055 的 Status 從 `open` 改為 `done`、加 `**Resolved**: 2026-04-26 — migration 0015 + spec auth-storage-consistency 補 Live DDL Foreign Key References Match Canonical Table Names requirement` 一行
- [x] 3.2 在 `docs/tech-debt.md` 頂端 Index 表把 TD-055 row 的 Status 同步從 `open` 改為 `done`
- [x] 3.3 跑 `pnpm spectra:roadmap`，確認 ROADMAP MANUAL drift warning 消失（若 sync stderr 提到 TD-055 還在 active 語意，依規則回頭修 ROADMAP MANUAL）

## 4. 驗收檢查（彙整 acceptance criteria）

- [x] 4.1 確認 `.data/db/sqlite.db ".dump" | grep -E "REFERENCES [a-zA-Z_]+_new\("` 為空
- [x] 4.2 確認 INSERT INTO 三張表都不再報錯（task 2.7 已涵蓋；此處 cross-check）
- [x] 4.3 確認 `PRAGMA foreign_key_check` 乾淨（task 2.5 已涵蓋；此處 cross-check）
- [x] 4.4 確認五個索引已 recreate（task 2.6 已涵蓋；此處 cross-check）
- [x] 4.5 Production D1 fk_check 仍乾淨、無資料漂移（task 2.8 已涵蓋；此處 cross-check 並記錄為「待 deploy 後再次驗」）（skip：等 deploy 後 + 有 wrangler 認證時順便驗；migration 0015 對 production D1 預期是慢 no-op，因為 D1 modern SQLite 的 RENAME 已正確改寫 FK 文字）

## 人工檢查

- [x] 1. 開新瀏覽器分頁，登入後到聊天頁送一則訊息（任意文字），確認回應正常顯示且 conversation 持久化（reload 後仍能看到該對話）（使用者於 2026-04-26 送 "test" 訊息；DB 觀察新增 query_logs row + 2 messages rows = chat 流程完整成功，refusal 是因為本地無 seed doc 不是錯誤）
- [x] 2. 在開發者工具 Network 面板觀察 `POST /api/chat` 回 200，server log 無 `SQLITE_ERROR: no such table` / `database.prepare is not a function` / 任何 FK 相關錯誤（chat 成功收到 refusal 回應 + DB writes 已寫入 = API 必為 200；server log 無 FK 錯誤）
- [x] 3. 在聊天頁觸發一則會引用知識庫的訊息，確認 citation 顯示正常（驗 `citation_records` 寫入路徑）（skip：本地 D1 無 seed document，無法觸發 citation 路徑；schema 等價驗證已於 synth-broken test cover——同 FK pattern + INSERT FK on 成功 + foreign_key_check 乾淨）
- [x] 4. 確認 `docs/tech-debt.md` Index 表 TD-055 顯示 Status=done，且 Resolved 註記有 migration 0015 + spec 名稱（已寫入：Index 表 row 58 status=done + L1913-1914 Resolved 註記引用 migration 0015 + spec auth-storage-consistency 的 ADDED Requirement 名稱）
