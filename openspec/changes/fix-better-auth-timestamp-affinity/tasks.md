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
- [ ] 2.6 Tier 3 review：`spectra-audit` + `code-review` agent 審 migration SQL
- [ ] 2.7 `/commit` migration 檔（type=fix 或 migrate，繁體中文描述 table rebuild）
- [ ] 2.8 部署窗口安排：依 design § Phase 部署順序：先 endpoint，後 migration — Phase 1 穩定 24h+ 後的低流量時段
- [ ] 2.9 執行 production migration：`wrangler d1 migrations apply agentic-rag-db --remote`（或 nuxthub deploy pipeline auto-apply）
- [ ] 2.10 Post-deploy 驗證：`PRAGMA table_info(user)` / `PRAGMA table_info(account)` 回 INTEGER、admin 登入測試新 `typeof(createdAt)` 為 integer

## 3. Phase 3 — Endpoint cleanup

- [ ] 3.1 `server/api/admin/members/index.get.ts` 移除 `sql<>` raw select，改回 `createdAt: schema.user.createdAt` / `updatedAt: schema.user.updatedAt`
- [ ] 3.2 簡化 `toIsoOrNull` helper 分支至單一 `instanceof Date && !NaN → ISO else null`（對應 design § 是否保留 `toIsoOrNull` 作為 defensive — 保留但簡化）
- [ ] 3.3 `test/integration/admin-members-list.spec.ts`：保留 `parses TEXT "<ms>.0" drift values back to ISO (production case)` 作為回歸 guard（以 real Date instance 餵入即可），移除不適用的 raw-value 測試
- [ ] 3.4 跑 `pnpm check` + `pnpm test:integration` 全綠
- [ ] 3.5 Tier 2 review：`spectra-audit` + `code-review` agent（Phase 3 不涉 migration，降為 Tier 2）
- [ ] 3.6 `/commit` + deploy v0.18.3

## 4. 人工檢查

- [ ] 4.1 Phase 1 部署後：Admin 登入 production → 開啟 `/admin/members` → 確認列表出現、時間欄顯示正確 ISO
- [ ] 4.2 Phase 2 部署後：重新整理 `/admin/members` → 確認列表仍正常、新 user 登入後欄位 typeof 為 integer（由 Admin 配合一次新帳號登入測試）
- [ ] 4.3 Phase 3 部署後：Admin 再次進 `/admin/members` → 行為與 Phase 2 後完全一致（使用者無感知）
