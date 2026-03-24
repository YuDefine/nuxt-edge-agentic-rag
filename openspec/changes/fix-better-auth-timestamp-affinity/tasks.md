## 1. Phase 1 — Endpoint 防禦性修法（止血）

- [x] 1.1 納入既有本機修改：`server/api/admin/members/index.get.ts` 加 `toIsoOrNull()` helper 並以 `sql<>` template 繞過 drizzle `timestamp_ms` mapper，直接拿 driver raw value（對應 design § Why endpoint fix 不能取代 migration）
- [x] 1.2 納入既有本機修改：`test/integration/admin-members-list.spec.ts` 覆蓋 TEXT `"<ms>.0"` drift / numeric epoch / null / unparseable 四種情境，對齊 spec `Requirement: Admin Member List Tolerates Timestamp Drift`
- [x] 1.3 跑 `pnpm check` 全綠（format / lint / typecheck / check:vue-components）
- [x] 1.4 跑 `pnpm test:integration` 確認 49 test files / 240+ passed
- [x] 1.5 Tier 3 review：`spectra-audit` + `code-review` agent（對應 design § Rollback 策略 Phase 1 row 與 .claude/rules/review-tiers.md）— `/commit` skill 0-A 階段已包含 code-review agent；本次 audit discipline 三角色 check 無 finding
- [x] 1.6 `/commit` 分組：endpoint fix + test 一個 commit（type=fix，繁體中文訊息描述 RangeError root cause）— commit `e45cf95`
- [x] 1.7 Deploy v0.18.2 — production `/api/admin/members` 從 500 變 200 — deploy commit `dc6d447`

## 2. Phase 2 — D1 migration（table rebuild，治本）

- [x] 2.1 確認 Open Question Q3 / Q4：盤點 better-auth 全表 column 型別，結果記於 design §Open Questions。結論：migration scope = `user` + `account`（session / verification 有 TEXT drift 但不經 drizzle mapper，不 crash，不納入）；account 除 createdAt/updatedAt 外，`accessTokenExpiresAt` / `refreshTokenExpiresAt` 亦需 rebuild 為 INTEGER
- [x] 2.2 [P] 撰寫 `server/database/migrations/0007_better_auth_timestamp_affinity.sql`，依 SQLite table rebuild recipe（對應 design § SQLite table rebuild recipe）：因 D1 不支援 `PRAGMA foreign_keys = OFF`，改用 `PRAGMA defer_foreign_keys = ON` → 建 `user_new`（createdAt / updatedAt / banExpires = INTEGER）+ `account_new`（createdAt / updatedAt / accessTokenExpiresAt / refreshTokenExpiresAt = INTEGER）→ `INSERT ... SELECT` with CASE threshold（容錯 TEXT `"<ms>.0"` 與 ISO datetime 兩種格式）→ `DROP` 舊表 → `RENAME` 新表 → `CREATE INDEX account_userId_idx`（drizzle 宣告但 production 從缺）→ `PRAGMA foreign_key_check` → implicit COMMIT 觸發 deferred FK 檢查
- [x] 2.3 [P] 撰寫 dry-run 驗證腳本 `scripts/checks/verify-auth-storage-consistency.sh`（`--remote` / `--local` 兩模式），覆蓋 spec `Requirement: Better-auth Tables Storage Type Matches Drizzle Declaration` 的前兩個 scenario（PRAGMA type / typeof 存值）與 `Table Rebuild Migration Preserves Rows And Foreign Keys` 的 FK integrity scenario；「新 insert 型別」 scenario 留給 4.2 人工檢查
- [x] 2.4 以 `wrangler d1 export agentic-rag-db --remote --output tmp/prod-backup-pre-affinity-fix.sql` 備份 production — 448 行、4 筆 user/account INSERT
- [x] 2.5 本機 dry run：backup 匯入 `tmp/dry-run.sqlite` → 執行 0007 migration（exit 0）→ 驗證 spec scenarios 通過：所有 7 個 column INTEGER affinity、user/account rows 2/2 preserved、0 FK violations、admin id `dh9UCNGLmzRlSMXenEFmNvOMknwDx4XA` 對應 email 不變、account_userId_idx 已建
- [x] 2.6 Tier 3 review：migration 0007 重寫為 **Option V**（8-table cascade rebuild）並通過 dry-run + preflight 驗證
  - 2026-04-19 第一輪：agent 回報 2 Critical / 1 High / 4 Medium / 3 Low，全部修復（FK 子表清單、CASE `>=` threshold + NULL/empty handling、pre-flight assertion 抽到 verify script、`account.updatedAt` DB default、rollback 步驟含 d1_migrations 刪除、identifier quoting 一致、legacy_alter_table 註解）；修復後 preflight + happy dry-run 綠，poison dry-run（empty createdAt / orphan mcp_token）被 preflight 攔下
  - 2026-04-20 第二輪 Critical 發現（阻擋 apply）：`/commit` 流程中 code-review agent 發現 migration 0007 在 D1 FK=ON runtime 下 `DROP TABLE "user"` 會被擋。確認 `defer_foreign_keys=ON` 只 defer row-level violation 到 COMMIT，對 DDL-time「DROP parent 仍被 child 指向」無效
  - 2026-04-20 晚 D1 實測（用真實 miniflare D1，不是 sqlite3 CLI）：
    - Option A `PRAGMA foreign_keys = OFF`：D1 **靜默忽略**（PRAGMA 接受但讀回仍是 1），canonical SQLite recipe 不適用
    - Option B 純 FK children rebuild（session / account / mcp_tokens / member_role_changes）：實測撞到 **mcp_tokens 是 query_logs 的 parent**（HANDOFF 漏列），DROP mcp_tokens 被 query_logs 擋
    - Option C `PRAGMA writable_schema = ON`：D1 reject `SQLITE_AUTH`，schema-text workaround 不可用
    - **Option V (採用)**：rebuild 完整 FK cascade（user + account + session + mcp_tokens + query_logs + citation_records + messages + member_role_changes，共 8 tables；`messages` 納入是因為它對 query_logs 的 FK 是 `ON DELETE SET NULL`，DROP query_logs 時會靜默清掉 70 筆 message → query_log 連結，必須在 query_logs 之前先 DROP messages）。建 `_new` 表（FK 指向 user_new / mcp_tokens_new / query_logs_new）→ INSERT 資料 → DROP 舊表 children-first → RENAME `_new` 到 canonical 時 SQLite 自動 rewrite FK refs。實測 dry-run 全綠（用 prod backup `tmp/prod-backup-0420.sql`）
  - migration 0007 重寫位置：`server/database/migrations/0007_better_auth_timestamp_affinity.sql`（~ 380 行 Option V，drafts/ 已刪除）
  - verify script 從 draft 移正：`scripts/checks/verify-auth-storage-consistency.sh`（補 query_logs FK orphan check + 5 indexes 校驗 + RENAME auto-rewrite stale ref check）
  - dry-run 結果：column affinity 7/7 = INTEGER、typeof rows 全 integer、0 FK violations、5 indexes present、0 stale `_new` refs、row counts 2/2/2/7/64/31/2 全保留
  - preflight 對 production 結果：0 orphan FK、0 unparseable timestamps、PREFLIGHT PASSED
- [x] 2.7 `/commit` migration 檔 — commit `24da045`（含 Option V cascade rebuild + 9 CHECK constraints + verify script + drafts/ 刪除）
- [x] 2.8 部署窗口安排：本 session 一氣完成 endpoint hotfix 已穩定 24h+，直接 deploy v0.18.4 後 apply migration
- [x] 2.9 執行 production migration：`pnpm exec wrangler d1 migrations apply agentic-rag-db --remote` — 42 commands / 9.98ms ✅
- [x] 2.10 Post-deploy 驗證：`bash scripts/checks/verify-auth-storage-consistency.sh --remote` PASSED — column affinity 7/7 = INTEGER、typeof rows 全 integer、0 FK violations、7 indexes present、無 stale `_new` refs、row counts 2/2/2/7/64/31/70/2 全保留、messages.query_log_id 70 → 70 preserved（C1 fix 真實在 production 生效）

## 3. Phase 3 — Endpoint cleanup

- [x] 3.1 `server/api/admin/members/index.get.ts` 移除 `sql<>` raw select，改回 `createdAt: schema.user.createdAt` / `updatedAt: schema.user.updatedAt`
- [x] 3.2 簡化 `toIsoOrNull` helper 分支至單一 `instanceof Date && !NaN → ISO else null`（對應 design § 是否保留 `toIsoOrNull` 作為 defensive — 保留但簡化）
- [x] 3.3 `test/integration/admin-members-list.spec.ts`：保留 `emits ISO string for valid Date instance from drizzle mapper (golden path)` + `returns null instead of crashing on Invalid Date (regression guard)`，移除 `<ms>.0` raw-value 測試（migration 0007 後 drizzle mapper 直接拿到 Date instance，raw-value path 不再可重現）
- [x] 3.4 跑 `pnpm check` + `pnpm test:integration` 全綠（49 test files / 240 passed / 1 skipped）
- [x] 3.5 Tier 2 review：`/commit` skill 0-A 階段含 simplify + code-review agent；Phase 3 changes 很 mechanical（移 sql<>、簡化 helper、test 改 fixture），無 finding
- [x] 3.6 `/commit` + deploy v0.18.5

## 4. 人工檢查

- [ ] 4.1 Phase 1 部署後：Admin 登入 production → 開啟 `/admin/members` → 確認列表出現、時間欄顯示正確 ISO
- [ ] 4.2 Phase 2 部署後：重新整理 `/admin/members` → 確認列表仍正常、新 user 登入後欄位 typeof 為 integer（由 Admin 配合一次新帳號登入測試）
- [ ] 4.3 Phase 3 部署後：Admin 再次進 `/admin/members` → 行為與 Phase 2 後完全一致（使用者無感知）
