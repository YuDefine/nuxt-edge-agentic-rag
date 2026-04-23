## 1. Refactor Credentials Endpoint — Credentials And Member List Endpoints Use Portable ORM Layer

> Implements Decision 1: credentials.get.ts user row 改用 drizzle select

- [x] 1.1 在 `server/api/auth/me/credentials.get.ts` 將 line 68-72 的 `db.all(sql\`SELECT email, display_name FROM "user" WHERE id = ${userId} LIMIT 1\`)` 替換為 drizzle query builder：`db.select({ email: schema.user.email, displayName: schema.user.displayName }).from(schema.user).where(eq(schema.user.id, userId)).limit(1)`（依 design.md Decision 1: credentials.get.ts user row 改用 drizzle select；實作 spec requirement「Credentials And Member List Endpoints Use Portable ORM Layer」）。**@followup[TD-010]**
- [x] 1.2 更新下游 return statement，從 `userRow.display_name` 改為 `userRow.displayName`（drizzle 回傳物件 key 是 JS side 宣告）。保留 `userRow = undefined` not found 分支的 404 throw。**@followup[TD-010]**
- [x] 1.3 保留 try/catch + `log.error(error, { step: 'fetch-user-row' })` + friendly error message（遵守 `logging.md` / `error-handling.md`，`log.error` 只記非預期錯誤）。**@followup[TD-010]**

## 2. Refactor Admin Member List Endpoint — Credentials And Member List Endpoints Use Portable ORM Layer

> Implements:
>
> - Decision 2: admin/members/index.get.ts count query 改用 drizzle + drizzle-orm `count()`
> - Decision 3: admin/members list query 採「user list + per-page batched lookup + application-layer reduce」
> - Decision 4: `toIsoOrNull` 簡化

- [x] 2.1 [P] 移除 `server/api/admin/members/index.get.ts` 的 `RawMemberRow` interface、`sql\`...\`` template fragments（`orderByClause`與`roleFilter`）。**@followup[TD-010]**
- [x] 2.2 [P] 依 Decision 2: admin/members/index.get.ts count query 改用 drizzle + drizzle-orm `count()` 改寫 count：`db.select({ n: count() }).from(schema.user)` + 條件式 `eq(schema.user.role, query.role)`。`count` 從 `drizzle-orm` import。**@followup[TD-010]**
- [x] 2.3 依 Decision 3: admin/members list query 採「user list + per-page batched lookup + application-layer reduce」Stage A 改寫 user list query：`db.select({ id, email, name, displayName, image, role, createdAt, updatedAt }).from(schema.user)` + 條件式 `where` + `orderBy(...orderByClause)` + `limit` + `offset`。`orderBy` 用 drizzle `desc` / `asc`（switch + assertNever 保留）。**@followup[TD-010]**
- [x] 2.4 依 Decision 3: admin/members list query 採「user list + per-page batched lookup + application-layer reduce」Stage B 新增 3 條並行輔助 query（`Promise.all`）：`account where providerId='google' AND userId IN pageIds`、`passkey where userId IN pageIds`、`session group by userId with max(updatedAt) where userId IN pageIds`。`inArray` / `max` 從 `drizzle-orm` import。因 `schema.session` 不由 better-auth generator 產出，額外在 `server/db/schema.ts` 宣告 local `session` drizzle 表（text columns，對齊 migration 0007 / 0009 實際 SQL）。**@followup[TD-010]**
- [x] 2.5 依 Decision 3: admin/members list query 採「user list + per-page batched lookup + application-layer reduce」Stage C 改 application-layer reduce 為 `credentialTypes` / `lastActivityAt`：用 `Set` / `Map` lookup 組裝 `AdminMemberRow[]`。保留既有 `toCredentialTypes` 與 `toIsoOrNull` helper。**@followup[TD-010]**
- [x] 2.6 依 Decision 4: `toIsoOrNull` 簡化 將 `toIsoOrNull` 型別簽章從 `unknown` 收緊為 `Date | string | number | null | undefined`，保留四支 regression guard 分支（Date / number / string / null fallback），註解標明原因是 `auth-storage-consistency` spec「Handler returns 200 with null when a timestamp is unparseable」regression guard。**@followup[TD-010]**
- [x] 2.7 保留 try/catch + `log.error(error, { step: 'list-members' })` + `createError({ statusCode: 500, message: '暫時無法載入會員清單，請稍後再試' })`。**@followup[TD-010]**

## 3. Test Mock Rewrite — Credentials And Member List Endpoints Use Portable ORM Layer

> Implements Decision 5: Test mock 策略

- [x] 3.1 依 Decision 5: Test mock 策略 改寫 `test/integration/admin-members-list.spec.ts` 的 `vi.mock('hub:db', ...)`：移除 `db.all` + `sql\`\``攔截，改為 mock drizzle query builder chain（thenable`from / where / orderBy / limit / offset / groupBy / then`）。`select(shape)` 依 shape key 分支回傳 count rows / user rows。**@followup[TD-010]**
- [x] 3.2 [P] 維持 `admin-members-list.spec.ts` 原有的兩個 scenario（golden epoch / unparseable input regression guard），斷言相同 response shape 與欄位值；不得改動斷言以配合 mock。**@followup[TD-010]**
- [x] 3.3 依 Decision 5: Test mock 策略 改寫 `test/integration/admin-members-passkey-columns.spec.ts` 的 mock：同 task 3.1 策略。`allResult` 改為分「usersResult / googleResult / passkeyResult / sessionResult」四組，依 `select(shape)` 的 shape key 分支回傳。**@followup[TD-010]**
- [x] 3.4 [P] 維持 `admin-members-passkey-columns.spec.ts` 原有四個 scenario（passkey-only user / google+passkey deterministic order / neither bound / session fallback to registeredAt），斷言相同 response shape 與欄位值；不得改動斷言以配合 mock。兩檔 mock chain duplication 約 60 行，但 inlining 比 helper 更好讀（test 專用 stub 輕量），決定不抽 helper。**@followup[TD-010]**

## 4. New Integration Test — Credentials And Member List Endpoints Use Portable ORM Layer

> Implements Decision 6: 新增 `account-settings-credentials.spec.ts`

- [x] 4.1 依 Decision 6: 新增 `account-settings-credentials.spec.ts` 新增 `test/integration/account-settings-credentials.spec.ts`。mock `hub:db` drizzle chain（same pattern as task 3.1）+ mock `requireUserSession`。覆蓋 6 個 scenario：happy path（email + displayName + 2 passkeys + google） / no google / no passkey / passkey-only / user not found → 404 / unauthenticated → 401（實際擴增為 7 scenarios，加上 500 friendly message DB error path）。**@followup[TD-010]**
- [x] 4.2 TDD red phase 確認失敗 → 實作 credentials drizzle refactor → green phase 全綠。**@followup[TD-010]**

## 5. Local Verification — Credentials And Member List Endpoints Use Portable ORM Layer

- [x] 5.1 `pnpm dev` 啟動 local（port 3010），`curl -b cookies.txt http://localhost:3010/api/auth/me/credentials` 以有 session 的 cookie 驗證 → **200** with `{ data: { email: "admin@test.local", displayName: "Test Admin", hasGoogle: false, passkeys: [] } }`。**@followup[TD-010]**
- [x] 5.2 `curl -b cookies.txt 'http://localhost:3010/api/admin/members?page=1&pageSize=20'` 以 admin cookie 驗證 → **200** with `{ data: [17 rows], pagination: { page: 1, pageSize: 20, total: N } }`。每筆 row 含 `displayName` / `credentialTypes` / `registeredAt` / `lastActivityAt`。**@followup[TD-010]**
- [x] 5.3 Playwright CLI 拍 `/account/settings` 與 `/admin/members` 的 xs (360) / md (768) / xl (1280) 響應式 happy path 截圖（6 張皆 happy path，非 error state），確認 refactor 解除 passkey-authentication §16 Design Review responsive happy path blocker。截圖輸出到 `screenshots/local/drizzle-refactor-credentials-admin-members/`。**@followup[TD-010]**

## 6. Tier 2 Review — Credentials And Member List Endpoints Use Portable ORM Layer

- [x] 6.1 執行 `spectra-audit`（3-role：Scoundrel / Lazy Dev / Confused Dev）對兩個 endpoint + 3 份 test 檔案做安全與型別檢查。結果 **Critical: 0 / High: 0 / Medium: 0 / Low: 0**，audit verdict CLEAN。Drizzle query builder 實際提升 type safety（無 stringly-typed column refs）。觀察項：`toIsoOrNull` 4-branch regression guard 依 `auth-storage-consistency` spec 保留；test mock `userIdCall` 計數器是 test-only 耦合，非 production risk。**@followup[TD-010]**
- [x] 6.2 內聯 code-review 覆蓋五個 focus 點（主線已持有完整 context，dispatch subagent = N 倍 token 浪費，依 CLAUDE.md fan-out 規則走主線）：drizzle query semantics 等價性（EXISTS ↔ Set.has、MAX COALESCE ↔ ?? fallback chain 皆逐條對照 SQL 原語義）、N+1 risk（Stage B 三條 query 全走 `inArray(pageUserIds)` batched，非 per-user；round-trip 從 2 增為 5，但 Promise.all 並行等效 2）、test mock 完整度（3 份 spec 的 mock shape 皆 mirror 真實 select projection，無 partial mock）、log.error 使用時機（僅 5xx catch 內呼叫，一次；401/404 分支不記錄）、handleDbError 行為（本 refactor 維持 `createError` pattern 未引入 handleDbError，與 pre-refactor 一致）。Verdict CLEAN。**@followup[TD-010]**
- [x] 6.3 跑 `pnpm check`（format / lint / typecheck 全綠；`pnpm check` 本身不跑 test，另跑 `pnpm test:integration` 確認本 change 的 3 個 spec 全綠——pre-existing 12 個 evlog Logger 錯誤為 v0.25.0 error-sanitizer plugin 引入的獨立問題，已登記為 **@followup[TD-014]**，不在 TD-010 scope）。**@followup[TD-010]**

## 人工檢查

> 以下項目 NEVER 自行標記完成。由主線派遣 screenshot-review agent + 使用者逐項確認後才能勾。
>
> 2026-04-21 continuation evidence（未自動勾選，待使用者確認）：local dev `http://localhost:3010` 以 `/api/_dev/login` 建立 `admin@test.local` session 後，`/api/auth/me/credentials` 回 200 `{ email: "admin@test.local", displayName: "Test Admin", hasGoogle: false, passkeys: [] }`；`/api/admin/members?page=1&pageSize=20` 回 200 且 `data.length = 17`。Playwright 重新載入 `/account/settings` 與 `/admin/members` 皆 HTTP 200、停留在目標 URL、未偵測 `error state` / `暫時無法` / `無法載入` / `500` 等已知 error text；截圖位於 `screenshots/local/td010-continuation/account-settings.png` 與 `screenshots/local/td010-continuation/admin-members.png`。
>
> 2026-04-23 production evidence（使用者手動確認）：在 production admin session 下，`https://agentic.yudefine.com.tw/account/settings` happy path 正常，頁面可見 email / display name / passkey 區塊 / Google 綁定區塊，無 error state。`https://agentic.yudefine.com.tw/admin/members` happy path 正常，頁面可見會員列表 / role badge / credential badges / last activity；本次資料量全部落在單頁，無第 2 頁可切換；列表載入過程未出現 `500`、`暫時無法載入會員清單` 或其他 error state。此證據由使用者在 SSH 協作情境下實機回報，主線依使用者確認勾選。

- [x] 7.1 `/account/settings` 在 local dev 可載入 happy path（顯示 email / displayName / passkey list / Link Google 區塊），無 error state
- [x] 7.2 `/admin/members` 在 local dev 可載入 happy path（顯示會員列表、credential badges、last activity），無 error state
- [x] 7.3 Production D1 回歸：deploy 後對 `/account/settings` 與 `/admin/members` 實際操作無行為漂移（response shape / UI / 排序 / 分頁一致）
- [x] 7.4 passkey-authentication §16 Design Review 可在 local 跑完整響應式 pipeline（xs / md / xl 三 breakpoint happy path 截圖皆可拍到非 error state）
- [x] 7.5 TD-010 entry 於 `docs/tech-debt.md` 更新 Status: done（archive 前最後一步）
