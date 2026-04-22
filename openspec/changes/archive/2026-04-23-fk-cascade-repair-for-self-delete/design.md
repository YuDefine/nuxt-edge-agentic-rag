## Context

Migration 0009（`0009_passkey_and_display_name.sql`）在 rebuild 過程中重新宣告了 `member_role_changes.user_id` 與 `mcp_tokens.created_by_user_id` 的 FK，但兩者皆**漏寫 `ON DELETE` 子句**：

```sql
-- 0009 line ~304 (member_role_changes_new)
FOREIGN KEY (user_id) REFERENCES user_new(id)   -- 預設 NO ACTION = RESTRICT

-- 0009 line ~183 (mcp_tokens_new)
created_by_user_id TEXT NOT NULL REFERENCES user_new(id)   -- 預設 NO ACTION = RESTRICT
```

SQLite 預設 `NO ACTION`，在 `foreign_keys = ON`（NuxtHub D1 預設 ON）下等同 `RESTRICT`：當子表存在 row 時，`DELETE FROM parent` 會以 `SQLITE_CONSTRAINT_FOREIGNKEY` 失敗。

### 實際症狀

`server/api/auth/account/delete.post.ts` 的正確執行順序是：

1. 檢查 session reauth ≤ 5 min
2. `recordRoleChange()` 寫入 `member_role_changes`（reason='self-deletion'） → audit tombstone
3. Delete `user_profiles`
4. Delete `user`（原設計預期 `account` / `session` / `passkey` CASCADE 清除）

步驟 2 成功寫入 tombstone 後，步驟 4 因 FK restrict 失敗 → HTTP 500。Production + local 皆如此。Session 內已對 local D1 套用 ad-hoc rebuild patch 恢復功能，production D1 仍破損。

### 真相來源對照

| 欄位                            | Drizzle schema（`server/db/schema.ts`）              | 0009 SQL 結果                                           |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `member_role_changes.user_id`   | 無 `.references()`（pure text）                      | **有 FK，無 ON DELETE**（錯）                           |
| `mcp_tokens.created_by_user_id` | 無 `.references()`（pure text；註解說 FK 在 SQL 層） | **有 FK，無 ON DELETE**（錯，應為 `ON DELETE CASCADE`） |

Drizzle schema 側本身沒問題（對 ORM query plan 無影響），但 SQL 層與 ORM 的意圖不一致。

---

## Goals / Non-Goals

**Goals:**

- 提供 migration 0010，讓 `member_role_changes` 不再以 FK 綁住 `user`，`mcp_tokens` 在 user 刪除時 cascade
- 修復 production + local 上的 passkey-only 自刪 500 錯誤
- 讓 audit tombstone 機制（`reason = 'self-deletion'`）真正落地：tombstone 寫入後 user row 可被刪除，tombstone 留存
- 保留既有 row 資料一位元不變、既有 index 不變、既有 column 類型不變
- Rebuild pattern 與 0007 / 0008 一致，供未來 reviewer 直接對照

**Non-Goals:**

- **NEVER** 更改任何 column 的 affinity、nullability、check constraint 或 default
- **NEVER** 同時對 `user_profiles.email_normalized` 做 rebuild（那是 TD-009 互斥 scope）
- **NEVER** 調整 `account` / `session` / `passkey` 的 FK 政策（0009 已寫對）
- **NEVER** 實作 `DELETE /api/admin/members/[userId]` handler（本 change 只負責 DB 層不阻擋）
- **NEVER** 清理 production 已存在的 orphan tombstone row（tombstone 本就該保留）

---

## Decisions

### Decision 1: member_role_changes 完全移除 FK 而非改 ON DELETE CASCADE

**Choice**：rebuild `member_role_changes` 時**完全移除** `FOREIGN KEY (user_id) REFERENCES user(id)` 子句，`user_id` 變成純 text column。

**Why not `ON DELETE CASCADE`**：audit tombstone 的合規意圖是「user 被刪除後**仍保留刪除紀錄**」。CASCADE 會把 audit 一起刪掉，語意完全顛倒。

**Why not `ON DELETE SET NULL`**：`member_role_changes.user_id` 目前 `NOT NULL`，且 tombstone 紀錄就是要指向「那個消失的 user id」，SET NULL 會喪失可追溯性。

**Why not `ON DELETE NO ACTION` + 應用層先 DELETE tombstone**：會讓 audit 在刪除過程中短暫消失，違反合規。而且手動先 DELETE audit 也要再寫新 tombstone，徒增應用層複雜度。

**結論**：「pure text reference」最直接——SQLite 允許 column 值指向不存在的 row（這本來就是 audit 的期望狀態）。`idx_member_role_changes_user_created` index 保留，admin 仍可查詢 `WHERE user_id = <deleted>`。

### Decision 2: mcp_tokens.created_by_user_id 改 ON DELETE CASCADE

**Choice**：rebuild `mcp_tokens` 時把 `created_by_user_id` 的 FK 加上 `ON DELETE CASCADE`。

**Why CASCADE not SET NULL**：Migration 0008 剛把這個 column 改成 `NOT NULL`（TD 清理歷史），SET NULL 會破壞 0008 的保證。

**Why CASCADE not 移除 FK**：token 有明確 owner 語意，user 刪除後 token 應連帶失效。保留 FK 可在 DB 層保證不會出現 orphan token（`created_by_user_id` 指向不存在 user 的悬垂引用）。

**Side effect 承擔（2026-04-21 TDD red 測試修正）**：初版此段錯誤宣稱「`query_logs.mcp_token_id` 會保留 orphan 引用」。實測 SQLite 行為：`query_logs.mcp_token_id REFERENCES mcp_tokens(id)` 自 0001 起**無任何 `ON DELETE` 子句 → 預設 `NO ACTION = RESTRICT`**；因此當 user → mcp_tokens CASCADE 觸發 `DELETE FROM mcp_tokens` 時，`query_logs` 的 FK 會 RESTRICT，**使整個 user 刪除鏈再度失敗**。等於 TD-011 的 bug 只往下移動一層。

**修正**：migration 0010 必須同時把 `query_logs.mcp_token_id` 的 FK 改為 `ON DELETE SET NULL`。理由：

- query_logs 是 observability / compliance record，`retention-cleanup-governance` spec 的前提就是 log 不隨 token / user 消失
- `messages.query_log_id ON DELETE SET NULL` 已是同 repo 內的 proven pattern（0007 / 0008 / 0009 皆維持此語意），於此同質套用
- `query_logs.mcp_token_id` 自 0001 起就 nullable，無 consumer 假設 NOT NULL
- Audit attribution 由 `channel = 'mcp'` + `created_at` + `query_redacted_text` + `environment` 支撐；token-level attribution 在 token 已 cascade 清除 / user 已刪除後本就無 responsible party 可追

`citation_records.query_log_id ON DELETE CASCADE` 與 `messages.query_log_id ON DELETE SET NULL` 保持 0009 狀態不動（citation 綁 query_log 語意正確；message NULL 化語意正確）。

### Decision 3: 依 0007 / 0008 / 0009 的 canonical rebuild pattern 實作 0010

**（2026-04-21 修正）初版設計錯誤宣稱 `mcp_tokens` 是獨立 root；實際 `query_logs.mcp_token_id REFERENCES "mcp_tokens"(id)` 存在（0009 line ~205；live prod schema 確認）。Migration 0010 因此必須 mirror 0008 pattern，以 5 表 rebuild 鏈處理 mcp_tokens 的 children 再造，並另行獨立處理 member_role_changes。**

**FK 依賴鏈（繼承 0009 header line 17-26）**：

```
user(id)
  ├─ account.userId                  ON DELETE CASCADE   — 0009 正確，本次不動
  ├─ session.userId                  ON DELETE CASCADE   — 0009 正確，本次不動
  ├─ passkey.userId                  ON DELETE CASCADE   — 0009 正確，本次不動
  ├─ member_role_changes.user_id     FK（無 ON DELETE）  — 0010 移除 FK（Decision 1）
  └─ mcp_tokens.created_by_user_id   FK（無 ON DELETE）  — 0010 改 ON DELETE CASCADE（Decision 2）
       └─ query_logs.mcp_token_id                     FK（無 ON DELETE） — 0010 改 ON DELETE SET NULL（Decision 2 修正；不改此子句則 user cascade 仍被 RESTRICT）
            ├─ citation_records.query_log_id         ON DELETE CASCADE — 0010 只 FK re-bind（語意不變）
            └─ messages.query_log_id                 ON DELETE SET NULL — 0010 只 FK re-bind（語意不變）；child-first DROP 避免 SET NULL 誤觸
```

**Rebuild 骨架**（mirror 0008 section (1)-(6)）：

```sql
PRAGMA defer_foreign_keys = ON;

-- Independent root: member_role_changes（無 children FK）
-- (A) 建 member_role_changes_new（無 FK）
-- (B) INSERT SELECT（完整 column list）
-- (C) DROP member_role_changes
-- (D) RENAME member_role_changes_new → member_role_changes
-- (E) 重建 idx_member_role_changes_user_created

-- Chain root: mcp_tokens（4 表級聯 rebuild）
-- (1) mcp_tokens_new — created_by_user_id 加 ON DELETE CASCADE；其他 columns 完全比照 post-0009
-- (2) query_logs_new — FK re-bind mcp_tokens_new，mcp_token_id 加 ON DELETE SET NULL；columns 完全比照 post-0009
-- (3) citation_records_new — FK re-bind query_logs_new；columns 完全比照 post-0009
-- (4) messages_new — FK re-bind query_logs_new；columns 完全比照 post-0009（messages.query_log_id 維持 ON DELETE SET NULL）
-- (5) Children-first DROP 順序（避免 SET NULL 靜默吞 message.query_log_id；0007/0008 已驗證的 pattern）：
--       DROP TABLE messages;
--       DROP TABLE citation_records;
--       DROP TABLE query_logs;
--       DROP TABLE mcp_tokens;
-- (6) RENAME _new 對 (1)-(4) 四張表回 canonical name（SQLite 自動改寫 FK REFERENCES 字串）

-- Post-rebuild
-- (F) 重建 indexes（0009 line 388-410 的 subset，與 mcp_tokens chain 相關者）
-- (G) PRAGMA foreign_key_check; — migration 尾部加 self-check（可回 no row）
```

**為什麼不 in-place `ALTER TABLE`**：SQLite 不支援修改 FK。必須 rebuild。

**為什麼必須 child-first DROP**：`messages.query_log_id` 的 `ON DELETE SET NULL` 會在 parent `query_logs` 被 DROP 時觸發，靜默把所有 `messages.query_log_id` null 掉（0007 WARNING，0008 header line 31-44 詳述）。Children-first DROP 讓 SET NULL 永遠不會觸發。

**為什麼 `member_role_changes` 獨立於 chain**：`member_role_changes` 沒有任何其他表 FK references 它，也不 FK reference `user` 鏈上任何東西（改後連 user FK 都移除）。可在 mcp_tokens chain 之前或之後獨立 rebuild，順序無所謂。

**為什麼使用 `PRAGMA defer_foreign_keys = ON`**：對照 0009 line 57（`PRAGMA defer_foreign_keys = ON;`），0008 用 `PRAGMA foreign_keys = ON` + 顯式 `_new` / DROP / RENAME 順序也能達成。本 migration 跟 0009 更近（含 FK re-bind），採 `defer_foreign_keys` 讓 transaction 結束前才 enforce FK，符合「single transaction rebuild chain」的 idiom。

### Decision 4: FK dependency tree 變更對照表

**語意變更（真正改動）**：

| 表                    | Column               | 0009 狀態                                      | 0010 目標                                        | 原因                                                                        |
| --------------------- | -------------------- | ---------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `member_role_changes` | `user_id`            | `REFERENCES user(id)`（無 ON DELETE）          | **無 FK**                                        | Audit tombstone 合規保留                                                    |
| `mcp_tokens`          | `created_by_user_id` | `REFERENCES user(id) NOT NULL`（無 ON DELETE） | `REFERENCES user(id) ON DELETE CASCADE NOT NULL` | Owner 連動刪除                                                              |
| `query_logs`          | `mcp_token_id`       | `REFERENCES mcp_tokens(id)`（無 ON DELETE）    | `REFERENCES mcp_tokens(id) ON DELETE SET NULL`   | TDD red 測試發現：不改則 user cascade 仍被 RESTRICT；observability log 保留 |

**連帶 rebuild（只 FK re-bind 到 `query_logs_new`，columns 與 ON DELETE 完全保持 0009 狀態）**：

| 表                 | Column         | 0009 狀態                                      | 0010 狀態 | 原因                                                                    |
| ------------------ | -------------- | ---------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| `citation_records` | `query_log_id` | `REFERENCES query_logs(id) ON DELETE CASCADE`  | 同上      | DROP query_logs 前必須 rebind                                           |
| `messages`         | `query_log_id` | `REFERENCES query_logs(id) ON DELETE SET NULL` | 同上      | DROP query_logs 前必須 rebind + child-first DROP 避免 SET NULL 靜默觸發 |

**不動的 user(id) children（0009 已正確）**：

| 表        | Column   | 0009 狀態           | 0010 狀態 |
| --------- | -------- | ------------------- | --------- |
| `account` | `userId` | `ON DELETE CASCADE` | 不變      |
| `session` | `userId` | `ON DELETE CASCADE` | 不變      |
| `passkey` | `userId` | `ON DELETE CASCADE` | 不變      |

### Decision 5: Drizzle schema 側只同步註解

`server/db/schema.ts` 的 `memberRoleChanges.userId` 本來就沒有 `.references()`（註解早已說明「FK 在 SQL 層」）。`mcpTokens.createdByUserId` 同樣無 `.references()`。本 change 不改 schema.ts 結構，只更新相關註解明確說明：

- `member_role_changes.user_id`：**無 FK**（由 migration 0010 確立），意圖是 audit 保留
- `mcp_tokens.created_by_user_id`：**FK ON DELETE CASCADE**（由 migration 0010 確立），意圖是 token 連動刪除

### Decision 6: Test coverage 策略

新增 `test/integration/passkey-self-delete.spec.ts`，使用 in-memory libsql fixture 覆蓋 migration 0010 的 DB-layer invariants：

1. 建立 post-0010 目標 schema fragment（只包含 FK cascade 測試必要表與欄位）
2. Seed 使用者、`member_role_changes` tombstone、`mcp_tokens`、`query_logs`、`citation_records`、`messages`
3. 驗證：
   - `member_role_changes.user_id` 無 FK，`idx_member_role_changes_user_created` 保留
   - `mcp_tokens.created_by_user_id` 是 `ON DELETE CASCADE`
   - `query_logs.mcp_token_id` 是 `ON DELETE SET NULL`
   - `DELETE FROM "user"` 會讓 tombstone 存活、tokens cascade、query_logs 存活且 token attribution NULL 化
   - 直接 `DELETE FROM mcp_tokens` 也會讓 `query_logs.mcp_token_id = NULL` 而不刪 log row
   - `PRAGMA foreign_key_check` 0 rows

不在此 spec 內重建 browser WebAuthn ceremony 或直接呼叫 `/api/auth/account/delete`；真實 reauth gate / redirect / session invalidation 由本 change 的 8.x 人工檢查覆蓋。

---

## Risks / Trade-offs

- **[Root-cause note 1] 初版設計錯誤宣稱 mcp_tokens 是 FK 獨立 root** → 2026-04-21 spectra-apply subagent 實測 prod schema（`sqlite_master` + 0009 line 205）發現 `query_logs.mcp_token_id REFERENCES "mcp_tokens"(id)`，child-first DROP order 實際必要。已於 Decision 3 / Decision 4 修正，migration 範圍由 2 表擴為 5 表（mcp_tokens chain + member_role_changes 獨立）。
- **[Root-cause note 2] 初版 Decision 2 錯誤假設 SQLite 會為無 ON DELETE 子句的 FK 保留 orphan 引用** → TDD red 測試（`test/integration/passkey-self-delete.spec.ts`）實測：`query_logs.mcp_token_id` 預設 `NO ACTION = RESTRICT`；user cascade 觸發 `DELETE FROM mcp_tokens` 時會被此 FK 擋下，**TD-011 的 bug 只會往下移動一層**。已於 Decision 2 / Decision 4 修正，加入 `query_logs.mcp_token_id → ON DELETE SET NULL`，語意變更表由 2 列擴為 3 列。
- **[Trade-off] query_logs 在 user 刪除後喪失 token attribution**（`mcp_token_id` 變 NULL）→ Accepted：query_logs 是 observability record 而非 token audit 載體；user 已刪除則 token-level responsible party 本就不存在。Audit 仍可由 `channel = 'mcp'` + `created_at` + `query_redacted_text` + `environment` 支撐。`retention-cleanup-governance` 的 log 保留要求高於 token 歸屬的偵查價值。
- **[Risk] Production D1 apply 過程中斷，五表處於不一致 rebuild 中間狀態** → Mitigation：SQLite/D1 每個 migration 檔案為 atomic transaction；中斷 → 全回滾。Apply 前 operator 手動執行 `wrangler d1 export --remote` 備份 + 對照五張表 row count。
- **[Risk] INSERT SELECT 過程中 source table 有新寫入** → Mitigation：production apply 視窗安排在低流量時段；migration 內無 `COMMIT` 分段（單一 transaction 涵蓋五表 rebuild）。
- **[Risk] `messages.query_log_id` 的 ON DELETE SET NULL 在 DROP `query_logs` 時靜默觸發** → Mitigation：沿用 0007 / 0008 的 children-first DROP 順序（`messages → citation_records → query_logs → mcp_tokens`），讓 SET NULL 永遠不會觸發。
- **[Trade-off] member_role_changes 失去 FK 保護 → 理論上未來程式碼 bug 可能寫入指向不存在 user 的 audit row** → Accepted：應用層 `recordRoleChange()` 只在 user 存在時呼叫；即使插入 orphan row，對 audit 查詢也不構成錯誤（WHERE user_id = X 照樣運作）。
- **[Trade-off] mcp_tokens CASCADE 會在 user 刪除時「失去 token 審計軌跡」** → Accepted：token 本身不是合規 audit 載體，`query_logs.mcp_token_id` 仍保留（orphan 引用在既有設計下是允許的）；若未來需要 token 刪除稽核，另起 change。
- **[Risk] 如果 production 已有 orphan `mcp_tokens.created_by_user_id` 指向不存在 user**（過去 NULL 清理殘留） → Mitigation：migration 0008 header 已記錄 2026-04-20 prod 清理歷史（0 NULL rows）。若 apply 0010 時 `INSERT SELECT` 發現 FK 違規，transaction 會整體回滾並報錯，operator 手動調查。
- **[Risk] Local `.data/db/sqlite.db` 的 ad-hoc patch 只 rebuild 了 member_role_changes + mcp_tokens 兩表，query_logs 的 FK 可能已 rot**（reference 指向已 DROP 的舊 mcp_tokens rowid） → Mitigation：local apply 0010 前先 `PRAGMA foreign_key_check` 檢查；必要時整顆 `.data/db/sqlite.db` 砍掉讓 init migrations 從頭重跑。

---

## Migration Plan

### Local（已套用 ad-hoc patch，本 change landing 時重跑 0010 覆蓋）

**Local 狀態盤點**（2026-04-21 task 1.2）：

- `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`（wrangler `--local` 實際使用）：`member_role_changes` 無 FK（已 patched）；`mcp_tokens` 無 ON DELETE CASCADE（patch 未完成）
- `.data/db/sqlite.db`（nuxthub-module 相容層）：兩表皆已是 TD-011 目標形狀，但 query_logs/citation_records/messages 未重綁 FK → 很可能 rot

**Apply 步驟**：

1. 先跑 `PRAGMA foreign_key_check` 確認現況；若出現 orphan 行 → 整顆 D1 砍掉讓 init migrations 重跑（`rm .data/db/sqlite.db` + `rm -rf .wrangler/state/v3/d1/miniflare-D1DatabaseObject` 再 `pnpm exec wrangler d1 migrations apply DB --local`）
2. 若 D1 乾淨則 `pnpm exec wrangler d1 migrations apply DB --local` 會偵測 0010 為新 migration 並自動 apply
3. 若 apply 中途 `CREATE TABLE *_new` 衝突（前次失敗殘留）→ `pnpm exec wrangler d1 execute DB --local --command "DROP TABLE IF EXISTS messages_new; DROP TABLE IF EXISTS citation_records_new; DROP TABLE IF EXISTS query_logs_new; DROP TABLE IF EXISTS mcp_tokens_new; DROP TABLE IF EXISTS member_role_changes_new;"` 清 dangling 再 retry

### Production

1. **Pre-apply backup**：`wrangler d1 export agentic-rag-db --remote --output=backup-pre-0010-$(date +%Y%m%d).sql`（`wrangler.jsonc` production D1 database_name）
2. **Pre-apply row count**：記錄五張表 `member_role_changes` / `mcp_tokens` / `query_logs` / `citation_records` / `messages` 以及 `"user"` 的 `count(*)`
3. **Apply**：`wrangler d1 migrations apply agentic-rag-db --remote`
4. **Post-apply integrity**：
   - `PRAGMA foreign_key_check` → 必須 empty
   - `PRAGMA foreign_key_list(member_role_changes)` → 必須 empty
   - `PRAGMA foreign_key_list(mcp_tokens)` → 必須顯示 `created_by_user_id` with `on_delete = 'CASCADE'`
   - `PRAGMA foreign_key_list(query_logs)` → 必須顯示 `mcp_token_id` 指向新 `mcp_tokens`，`on_delete = 'SET NULL'`
   - `PRAGMA foreign_key_list(citation_records)` → `query_log_id` 指向新 `query_logs`，`on_delete = 'CASCADE'`
   - `PRAGMA foreign_key_list(messages)` → `query_log_id` 指向新 `query_logs`，`on_delete = 'SET NULL'`
   - 五張表 row count 逐筆對照 step 2 數字
5. **Smoke test**：從 `/account/settings` 對 test user 實測自刪流程（§17.8 人工檢查 production 部分）

### Rollback

- **Rollback window**：single migration = single transaction。`wrangler d1 migrations apply` 失敗 → 自動回滾，D1 回到 0009 結束狀態
- **Post-commit rollback**：若 apply 成功但後續功能有 regression，撰寫 migration 0011 回復 0009 樣態（不建議：0009 樣態就是 broken）
- **Safer path**：production apply 前先在 staging D1 驗證整個流程（如果已設定 staging env）

---

## Open Questions

- **Q1**: Production D1 是否存在 `mcp_tokens.created_by_user_id` 指向不存在 user 的 orphan row？ → Apply 前由 operator 執行 `SELECT t.id FROM mcp_tokens t LEFT JOIN "user" u ON u.id = t.created_by_user_id WHERE u.id IS NULL` 驗證（預期 0 rows；若有，先決定 DELETE 或手動補 user 再 apply）。
- **Q2**: 未來是否要把 `member_role_changes.user_id` 改成允許 `NULL` 並在 tombstone 寫入時設 NULL？ → 現階段不改；保留 `NOT NULL` + 純 text reference 是最小變更，tombstone 仍帶可查 id。
- **Q3**: `test/integration/passkey-self-delete.spec.ts` 是否需要額外覆蓋「Admin 刪除 member」情境？ → 不需要，因為 `DELETE /api/admin/members/[userId]` handler 目前不存在。待未來實作時由對應 change 補測。
