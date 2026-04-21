## Why

Migration 0009 為 `member_role_changes.user_id` 與 `mcp_tokens.created_by_user_id` 加上 FK 時漏寫 `ON DELETE` 子句，SQLite 預設 `NO ACTION = RESTRICT`。造成：

- **Passkey-only 使用者自刪**（`POST /api/auth/account/delete`）在 **production + local** 皆回 500（`Failed query`），功能等同失效
- **Admin 從管理頁刪除使用者**撞同一顆石頭（雖然目前 `DELETE /api/admin/members/[userId]` 尚未實作，但 `PATCH` 路徑在降級流程中同樣會觸發 audit 寫入 → FK restrict）
- **`passkey-authentication` Requirement §17.8 承諾的 audit tombstone 機制完全無效**——tombstone 本應寫入「刪除意圖」後使 user row 可安全刪除，但 FK restrict 讓 tombstone 反而變成阻擋刪除的障礙
- 本次 session 已對 local D1 套用 rebuild patch，但 **production D1 仍未修**，合規承諾與使用者功能皆破損中

TD-011 登記於 `docs/tech-debt.md` Status: open，Priority: high，必須在本 change 內 squash 為 migration 0010。

## What Changes

- 新增 migration `server/database/migrations/0010_fk_cascade_repair.sql`，語意變更對**三張表**，連帶 FK re-bind **兩張表**，總計五張表 rebuild：
  - **（語意變更）`member_role_changes`**：rebuild 後**移除** `user_id` 的 FOREIGN KEY constraint（改為純 text reference），讓 audit tombstone 在 user row 刪除後仍得以存活。獨立於 mcp_tokens 鏈。
  - **（語意變更）`mcp_tokens`**：rebuild 後將 `created_by_user_id` 改為 `REFERENCES "user"(id) ON DELETE CASCADE`，token 隨建立者 user 刪除自動清除
  - **（語意變更）`query_logs`**：rebuild 後將 `mcp_token_id` 改為 `REFERENCES "mcp_tokens"(id) ON DELETE SET NULL`（TDD red 測試發現：若保持 `NO ACTION` 則 user cascade 觸發 `DELETE FROM mcp_tokens` 時會被此 FK RESTRICT，TD-011 的 bug 只會往下移動一層）。Observability log 保留，token 歸屬在 token 已刪除後 NULL 化；audit 由 `channel` + `created_at` + `query_redacted_text` + `environment` 支撐
  - **（連帶 FK re-bind，語意不變）`citation_records` / `messages`**：這兩張表 FK 指向 `query_logs`；DROP `query_logs` 前必須先 rebuild 它們使 FK 指向 `query_logs_new`。Columns 與 `ON DELETE` 子句完全保持 0009 狀態（mirror 0008 rebuild pattern）。
  - 五表 rebuild 依 0007 / 0008 / 0009 的 canonical pattern：`PRAGMA defer_foreign_keys = ON` → 建 `*_new` → `INSERT SELECT` → children-first DROP（`messages → citation_records → query_logs → mcp_tokens`；`member_role_changes` 獨立 DROP）→ RENAME → 重建 indexes → 結尾 `PRAGMA foreign_key_check`
  - Rebuild 不變更任何 column affinity、既有 index / unique constraint、或既有資料列內容
- Drizzle schema (`server/db/schema.ts`) 同步調整：`memberRoleChanges.userId` 已無 `.references()` 呼叫、`mcpTokens.createdByUserId` 亦無 FK declaration（ORM 側本來就不聲明 FK；變更僅反映在 SQL migration 層），本次只需確保註解與 SQL 意圖一致
- Release checklist：production D1 apply 前確認備份 + 五張表 row count 對照（`member_role_changes` / `mcp_tokens` / `query_logs` / `citation_records` / `messages`；與 `user` 一併記錄）
- 新 integration test `test/integration/passkey-self-delete.spec.ts` 覆蓋「audit tombstone 存在時能成功刪除 user」
- 不變更任何 API handler 程式碼（`server/api/auth/account/delete.post.ts` / `server/api/admin/members/*` 已經寫對，是 DB 層阻擋它們）

## Non-Goals

- **NEVER** 在本 change 內修 `user_profiles.email_normalized` nullability（那是 TD-009 的獨立 scope，兩者互斥不可合併）
- **NEVER** 調整任何其他 FK cascade policy（`account` / `session` / `passkey` 的 ON DELETE CASCADE 是 0009 已正確寫入的，不變）
- **NEVER** 更動 `member_role_changes` 的 column schema（只移除 FK，不調欄位）
- **NEVER** 新增或刪除 audit 邏輯——audit 行為在 `recordRoleChange()` 已就緒，本 change 只修 DB constraint 讓它能正常寫入
- **NEVER** 實作 `DELETE /api/admin/members/[userId]` endpoint——該 endpoint 目前不存在，且不在本 scope；本 change 只確保未來實作時 DB 不會阻擋
- **NEVER** 做 orphan tombstone 清理（`user_id` 指向已刪 user 的 audit rows）——tombstone 本意就是要保留，清理屬合規保留期限的另一議題

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `passkey-authentication`: 將 Requirement 「Passkey-Only Account Self-Deletion Requires Reauth」scenario 拆解補強——明確宣告 audit tombstone 寫入與 user row 刪除的順序、cascade 範圍，並加入「`member_role_changes` 不因 user 刪除而消失」與「`mcp_tokens` 隨 user 刪除 cascade」的新 scenario
- `auth-storage-consistency`: 新增 Requirement「FK Cascade Policy Supports Account Deletion」——定義哪些 FK 必須是 `ON DELETE CASCADE`、哪些必須完全無 FK constraint（audit rows），以及 rebuild migration 必須通過 `PRAGMA foreign_key_check` 的檢驗
- `member-and-permission-model`: 補充 Requirement「Audit Trail Survives User Deletion」——`member_role_changes` 的 `user_id` 是純 reference 而非 FK，tombstone row 在 user row 刪除後仍存活供合規查詢

## Impact

- **Affected specs**: `passkey-authentication` / `auth-storage-consistency` / `member-and-permission-model`（三者皆 MODIFIED，無 ADDED / REMOVED）
- **Affected code**:
  - `server/database/migrations/0010_fk_cascade_repair.sql`（新增）
  - `server/db/schema.ts`（註解同步；無結構異動）
  - `test/integration/passkey-self-delete.spec.ts`（新增）
- **Affected runtime**: Production D1（`agentic-rag-db`，`wrangler.jsonc` database_id `3036df7f-d54b-4d36-a33d-ecbb551fc278`）必須執行 `wrangler d1 migrations apply --remote` → 操作屬於後續 apply 階段，不在本 proposal scope
- **Affected user journeys**（UX-facing recovery）:
  - Passkey-only user 在 `/account/settings` 點「刪除帳號」→ 目前 500，修完後成功跳轉 `/`
  - Admin 未來若實作刪除 member 功能，DB 層不再阻擋
- **Risk**:
  - Rebuild 過程中 `*_new` / DROP / RENAME 鏈若中斷，保留 SQLite atomic transaction 回滾能力（0007 / 0008 已驗證的 pattern）
  - Production apply 前需手動對照五張表 row count，防止 migration SELECT 漏行
  - 初版設計錯誤宣稱 mcp_tokens 是獨立 root（修正於 design.md Decision 3 / Risks；rebuild 範圍由 2 表擴為 5 表為還原正確依賴鏈的必要手段，非 scope 擴張）
- **Review tier**: Tier 3（migration + FK policy 變更），必須走 `spectra-audit` + `code-review` agent
- **Follow-up marker**: 所有 tasks 帶 `@followup[TD-011]`
