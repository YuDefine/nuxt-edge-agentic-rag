## 1. Pre-flight 與資料盤點（Context 實際症狀 對照 / 真相來源對照）

- [x] 1.1 對照 design.md「實際症狀」段落，確認 TD-011 entry（`docs/tech-debt.md` line 462-506）Status 為 `open`、Priority `high`；若 session 期間被其他 change 改動則 rebase 本 change 描述 **@followup[TD-011]**
- [x] 1.2 依 design.md「真相來源對照」表進行 local D1 盤點 **@followup[TD-011]**
  - `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/...sqlite`（wrangler `--local` 實際使用的 DB）：
    - `member_role_changes`：**已無 FK**（session 早期手動 rebuild 過，與 TD-011 目標一致）
    - `mcp_tokens.created_by_user_id`：`REFERENCES "user"(id)` **沒有** `ON DELETE CASCADE`（ad-hoc patch 漏做）
  - `.data/db/sqlite.db`（舊 nuxthub-module 相容層資料庫，非 wrangler 主要使用路徑）：
    - 兩表皆已是 TD-011 目標形狀（`member_role_changes` 無 FK；`mcp_tokens` 有 CASCADE）
  - 結論：miniflare D1 狀態不完整，migration 0010 必須能正確處理「已 patched member_role_changes」+「尚未 patched mcp_tokens」的混合狀態。canonical rebuild pattern（CREATE \_new → INSERT SELECT → DROP → RENAME）對兩種輸入狀態皆可正規化成目標狀態。
- [x] 1.3 Production D1 盤點：實際 wrangler D1 名稱為 `agentic-rag-db`（`wrangler.jsonc` database_id `3036df7f-d54b-4d36-a33d-ecbb551fc278`；task 舊稱 `nuxt-edge-agentic-rag-prod` 已修正於後續 runbook）。2026-04-21 remote baseline：`member_role_changes=2`, `mcp_tokens=3`, `query_logs=72`, `citation_records=37`, `messages=81`, `"user"=2`；所有查詢 meta `changed_db=false`。**@followup[TD-011]**
- [x] 1.4 Production D1 orphan 檢查：`SELECT t.id FROM mcp_tokens t LEFT JOIN "user" u ON u.id = t.created_by_user_id WHERE u.id IS NULL` 於 `agentic-rag-db --remote` 回 `[]`（0 rows），Q1 無需 DELETE 或補 user 再 apply；meta `changed_db=false`。**@followup[TD-011]**

## 2. Migration 0010 撰寫（Decision 3: 依 0007 / 0008 / 0009 的 canonical rebuild pattern 實作 0010）

**範圍**：語意變更對 `member_role_changes` + `mcp_tokens` + `query_logs` 三表（Decision 1 / Decision 2 / Decision 2 修正）；`citation_records` + `messages` 為連帶 FK re-bind（columns 與 ON DELETE 子句完全保持 0009 狀態）。Mirror migration 0008 已驗證過的五表 rebuild pattern。

- [x] 2.1 建立檔案 `server/database/migrations/0010_fk_cascade_repair.sql`，header 註解引用「Decision 4: FK dependency tree 變更對照表」描述語意變更（3 表）與連帶 FK re-bind（2 表）、TD-011 脈絡、及 2026-04-21 TDD red 測試發現 `query_logs.mcp_token_id` RESTRICT 連鎖問題的 design 修正註記 **@followup[TD-011]**
- [x] 2.2 Migration 頭部加 `PRAGMA defer_foreign_keys = ON;`（對齊 0009 line 57），符合 Decision 3 的 canonical rebuild pattern **@followup[TD-011]**
- [x] 2.3 依「Decision 1: member_role_changes 完全移除 FK 而非改 ON DELETE CASCADE」rebuild `member_role_changes`（獨立 root）：建 `member_role_changes_new` 時**完全移除** `FOREIGN KEY (user_id) REFERENCES user(id)` 子句，column list 完全比照 post-0009 schema **@followup[TD-011]**
- [x] 2.4 `member_role_changes` rebuild：`INSERT INTO member_role_changes_new (id, user_id, from_role, to_role, changed_by, reason, created_at) SELECT ... FROM member_role_changes;` 完整 column list；`DROP TABLE member_role_changes;` `ALTER TABLE member_role_changes_new RENAME TO member_role_changes;` **@followup[TD-011]**
- [x] 2.5 `member_role_changes` rebuild 後重建 `idx_member_role_changes_user_created ON member_role_changes(user_id, created_at)` index（支援 Audit Trail Survives User Deletion 的 orphan 查詢效能需求） **@followup[TD-011]**
- [x] 2.6 依「Decision 2: mcp_tokens.created_by_user_id 改 ON DELETE CASCADE」先建 `mcp_tokens_new`：`created_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE`，其他 column 完全比照 post-0009 schema；INSERT SELECT 完整 column list 搬資料 **@followup[TD-011]**
- [x] 2.7 建 `query_logs_new`：FK `mcp_token_id TEXT REFERENCES mcp_tokens_new(id) ON DELETE SET NULL`（Decision 2 修正；不加 SET NULL 則 user cascade 仍被 RESTRICT，TDD red 測試已證實），`user_profile_id` 指向 `user_profiles(id)` 保持原樣；其他 columns 完全比照 post-0009（含 0005 observability cols）；INSERT SELECT 搬資料 **@followup[TD-011]**
- [x] 2.8 建 `citation_records_new`：FK `query_log_id TEXT NOT NULL REFERENCES query_logs_new(id) ON DELETE CASCADE`，其他 FK 指向 `document_versions(id)` / `source_chunks(id)` 保持原樣；columns 完全比照 post-0009；INSERT SELECT 搬資料 **@followup[TD-011]**
- [x] 2.9 建 `messages_new`：FK `query_log_id TEXT REFERENCES query_logs_new(id) ON DELETE SET NULL`，其他 FK 指向 `user_profiles(id)` / `conversations(id) ON DELETE CASCADE` 保持原樣；columns 完全比照 post-0009；INSERT SELECT 搬資料 **@followup[TD-011]**
- [x] 2.10 Children-first DROP 順序：`DROP TABLE messages; DROP TABLE citation_records; DROP TABLE query_logs; DROP TABLE mcp_tokens;`（避免 messages.query_log_id 的 ON DELETE SET NULL 在 DROP query_logs 時靜默觸發，見 design.md Risks 與 0007 WARNING） **@followup[TD-011]**
- [x] 2.11 RENAME 四張 `_new` 回 canonical name：`mcp_tokens_new → mcp_tokens`, `query_logs_new → query_logs`, `citation_records_new → citation_records`, `messages_new → messages`（SQLite 自動改寫 FK REFERENCES 字串） **@followup[TD-011]**
- [x] 2.12 重建 mcp_tokens chain 相關 indexes（0009 line 388-410 的 subset）：`idx_query_logs_channel_created_at`, `idx_citation_records_query_log_id`, `idx_citation_records_expires_at`, `idx_messages_query_log_id`, `idx_messages_conversation_created_at`；`mcp_tokens` 的 `token_hash UNIQUE` 由 `_new` column 定義自動帶過來 **@followup[TD-011]**
- [x] 2.13 Migration 尾部加 `PRAGMA foreign_key_check;` integrity report（對齊 0007 / 0008 / 0009；diagnostic output，真正 FK 違規由 implicit COMMIT 的 deferred-FK enforcement abort；post-apply 仍需人工確認 zero rows） **@followup[TD-011]**

## 3. Drizzle schema 註解同步（Decision 5: Drizzle schema 側只同步註解）

- [x] 3.1 依「Decision 5: Drizzle schema 側只同步註解」更新 `server/db/schema.ts` `memberRoleChanges.userId` 的 JSDoc：標註**無 FK constraint**（由 migration 0010 確立），意圖是 audit tombstone 保留，對應 Audit Trail Survives User Deletion requirement **@followup[TD-011]**
- [x] 3.2 `server/db/schema.ts` `mcpTokens.createdByUserId` 的 JSDoc 補充：FK 為 `ON DELETE CASCADE`（由 migration 0010 確立），user 刪除時 token 連動失效，對應 FK Cascade Policy Supports Account Deletion requirement **@followup[TD-011]**

## 4. Test 覆蓋（Decision 6: Test coverage 策略）

- [x] 4.1 [P] 依「Decision 6: Test coverage 策略」建立 `test/integration/passkey-self-delete.spec.ts`，使用 in-memory libsql fixture 建立 post-0010 目標 schema fragment，覆蓋 migration 0010 的 DB-layer FK invariants；真實 WebAuthn reauth / `/api/auth/account/delete` flow 留在 8.x 人工檢查。**@followup[TD-011]**
- [x] 4.2 Spec 補 case：`DELETE FROM "user"` 後 user row gone，`member_role_changes` tombstone 保留且 `reason = 'self-deletion'`（對應 Audit tombstone survives user deletion scenario 與 Audit Trail Survives User Deletion） **@followup[TD-011]**
- [x] 4.3 Spec 補 case：`mcp_tokens` 中 `created_by_user_id = <user id>` 的 rows 於刪除後 cascade 清除；`PRAGMA foreign_key_check(mcp_tokens)` 回 0 rows（對應 MCP tokens cascade on user deletion scenario 與 Rebuild Migration Preserves Row Counts And Integrity） **@followup[TD-011]**
- [x] 4.4 Spec 補 case：`query_logs.mcp_token_id` 在 user cascade 與直接 `DELETE FROM mcp_tokens` 兩種路徑皆 SET NULL，且 query_logs / citation_records / messages 保留正確語意；reauth gate / redirect / session invalidation 留在 8.x 人工檢查。**@followup[TD-011]**

## 5. Local apply 與驗證（Local（已套用 ad-hoc patch，本 change landing 時重跑 0010 覆蓋））

- [x] 5.1 `pnpm check`（format / lint / typecheck / test）全綠 **@followup[TD-011]**
- [x] 5.2 Local apply 前檢查：`pnpm exec wrangler d1 execute DB --local --command "PRAGMA foreign_key_check;"`；若回非 empty（local `.data/db/sqlite.db` 的 ad-hoc patch 只 rebuild 兩表，query_logs 的 FK 可能 rot） → 砍掉 local DBs (`rm -f .data/db/sqlite.db; rm -rf .wrangler/state/v3/d1/miniflare-D1DatabaseObject`) 讓 migrations 從頭重跑 **@followup[TD-011]**
- [x] 5.3 清 dangling：`pnpm exec wrangler d1 execute DB --local --command "DROP TABLE IF EXISTS messages_new; DROP TABLE IF EXISTS citation_records_new; DROP TABLE IF EXISTS query_logs_new; DROP TABLE IF EXISTS mcp_tokens_new; DROP TABLE IF EXISTS member_role_changes_new;"`；再跑 `pnpm exec wrangler d1 migrations apply DB --local`（依「Local（已套用 ad-hoc patch，本 change landing 時重跑 0010 覆蓋）」小節指示） **@followup[TD-011]**
- [x] 5.4 Local PRAGMA 驗證：`PRAGMA foreign_key_list(member_role_changes)` 必須回 empty；`PRAGMA foreign_key_list(mcp_tokens)` 必須回一筆 `on_delete = 'CASCADE'` 指向 `user(id)`；`PRAGMA foreign_key_list(query_logs)` 顯示 `mcp_token_id` 指向新 `mcp_tokens` 且 `on_delete = 'SET NULL'`；`PRAGMA foreign_key_list(citation_records)` 顯示 `query_log_id ON DELETE CASCADE` 指向新 `query_logs`；`PRAGMA foreign_key_list(messages)` 顯示 `query_log_id ON DELETE SET NULL` 指向新 `query_logs`（對應 FK Cascade Policy Supports Account Deletion 的 PRAGMA scenarios） **@followup[TD-011]**
- [x] 5.5 Local `PRAGMA foreign_key_check` 必須回 empty（對應 Rebuild Migration Preserves Row Counts And Integrity 的 Foreign key integrity check passes scenario） **@followup[TD-011]**
- [x] 5.6 Local row count 對照 task 1.2 baseline：五張 rebuild 表（`member_role_changes` / `mcp_tokens` / `query_logs` / `citation_records` / `messages`）row count 不變；特別驗證 messages 中 `query_log_id IS NOT NULL` 的 row 在 migration 前後數量一致（對應 Row count preserved / messages.query_log_id survives children-first DROP order scenarios） **@followup[TD-011]**
- [x] 5.7 `test/integration/passkey-self-delete.spec.ts` 執行通過 **@followup[TD-011]**

## 6. Tier 3 Review（migration + FK policy）

- [x] 6.1 跑 `spectra-audit` skill 針對本 change 的 migration SQL + schema.ts + test spec；三視角檢查結果：無 Critical / High / Medium；修正 0010 尾端 `PRAGMA foreign_key_check` 註解，避免把 diagnostic output 誤寫成會直接 abort 的 gate **@followup[TD-011]**
- [x] 6.2 派遣 review subagent 審查 migration 0010（專用 `code-review` agent 因 ChatGPT account 不支援其 opus model 失敗，改派一般 subagent 以 code-review prompt 執行 Tier 3 review）。Review finding：`passkey-self-delete.spec.ts` 實際為 DB-layer fixture，但 design/tasks 文字曾承諾 endpoint integration；另缺直接 `DELETE FROM mcp_tokens` → `query_logs.mcp_token_id = NULL` 覆蓋。**@followup[TD-011]**
- [x] 6.3 修復 audit / review 發現的所有 Critical / Warning 問題：補 `direct DELETE FROM mcp_tokens also nulls query_logs.mcp_token_id without deleting logs` 測試，並更新 design/tasks 明確定義本 spec 為 DB-layer invariant test，真實 WebAuthn reauth / endpoint flow 留在 8.x 人工檢查。`pnpm test:integration test/integration/passkey-self-delete.spec.ts` 11 tests passed。**@followup[TD-011]**

## 7. Production apply 作業書與 Rollback 準備

- [x] 7.1 Pre-apply backup：`wrangler d1 export agentic-rag-db --remote --output=backups/backup-pre-0010-20260421.sql` 已成功下載，檔案大小 179K，作為 0010 apply 前 rollback 素材。**@followup[TD-011]**
- [x] 7.2 Pre-apply 對照 task 1.3 row counts 後，執行 `wrangler d1 migrations apply agentic-rag-db --remote`；Wrangler 回報 `0010_fk_cascade_repair.sql ✅`，後續 `wrangler d1 migrations list agentic-rag-db --remote` 回 `No migrations to apply!`。**@followup[TD-011]**
- [x] 7.3 Post-apply 在 production D1 執行完整 PRAGMA 驗證：`PRAGMA foreign_key_check` 回 empty；`member_role_changes` FK list empty；`mcp_tokens.created_by_user_id` → `"user"(id) ON DELETE CASCADE`；`query_logs.mcp_token_id` → `mcp_tokens(id) ON DELETE SET NULL`；`citation_records.query_log_id` → `query_logs(id) ON DELETE CASCADE`；`messages.query_log_id` → `query_logs(id) ON DELETE SET NULL`。**@followup[TD-011]**
- [x] 7.4 Post-apply 六筆 row counts 與 task 1.3 baseline 一致：`member_role_changes=2`, `mcp_tokens=3`, `query_logs=72`, `citation_records=37`, `messages=81`, `"user"=2`；無需啟動 rollback。**@followup[TD-011]**

## 8. 人工檢查

- [x] 8.1 Local `/account/settings` 以 passkey-first test user `td011-mo8ftwv1` 實測「刪除帳號」→ Playwright virtual authenticator 完成 WebAuthn reauth → `POST /api/auth/account/delete` HTTP 200 → 自動導回 `/`，session sign-out；截圖 `screenshots/local/td011-self-delete-local.png`。對應 `passkey-authentication` §17.8 人工檢查的 local 分支（Passkey-Only Account Self-Deletion Requires Reauth / Passkey-only user deletes their account after reauth）
- [x] 8.2 Local D1 檢視：`SELECT user_id, reason FROM member_role_changes WHERE user_id = 'Vwp8ovTJBjy174coh73nnPUs3qBY8ii1' ORDER BY created_at DESC LIMIT 1` 回傳 `reason = 'self-deletion'`（Audit tombstone survives user deletion）
- [x] 8.3 Local D1 檢視：刪除前為 user `Vwp8ovTJBjy174coh73nnPUs3qBY8ii1` 插入 local `mcp_tokens` row `td011-token-mo8fu0s6`；刪除後 `SELECT count(*) FROM mcp_tokens WHERE created_by_user_id = 'Vwp8ovTJBjy174coh73nnPUs3qBY8ii1'` 回 0（MCP tokens cascade on user deletion）。同輪也修正 `.data/db/sqlite.db` local compatibility DB 的 query_logs/citation_records/messages FK rebind，使 `query_logs.mcp_token_id` 指向 canonical `mcp_tokens(id) ON DELETE SET NULL`。
- [x] 8.4 Local 逾時 reauth 測試：使用者人工確認 2026-04-21 流程「完成 Passkey 重新驗證 → 等超過 5 分鐘 → 按確認刪除」如預期回 HTTP 403；帳號未刪除，對應 Deletion without reauth is refused。
- [ ] 8.5 Production 以同一流程實測 passkey-only test user 自刪（§17.8 人工檢查 production 分支）
- [ ] 8.6 Production D1 檢視 tombstone 保留 + token cascade（同 8.2 / 8.3）
- [ ] 8.7 TD-011 entry 狀態更新：`docs/tech-debt.md` Status 由 `open` → `done`；保留條目作歷史
