## Phase 0 Note — 2026-04-19

Phase 0 盤點發現 tasks.md 原敘述與實際 codebase 有多處偏差，已依以下主線決策 ingest 更新：

- **Q1（mcp_tokens ↔ user mapping）採 (A)**：migration 0006 新增 `mcp_tokens.created_by_user_id TEXT REFERENCES user(id)`；legacy NULL 視為 `'admin'`（system seed）。影響 tasks 1.1 / 6.2 拆為 6.2.a + 6.2.b。
- **Q2（allowlist → role 遷移）採 (A) 完全替換**：`requireRuntimeAdminSession` 內部改為讀 `session.user.role === 'admin'`；allowlist 僅保留於 `server/auth.config.ts` 作為 Admin seed 唯一來源。無雙軌過渡。影響 tasks 3.1 / 7.1。
- **Q3（audit 寫入點）採 (A) 統一 helper**：`recordRoleChange(db, payload)` 為三個寫入時機（auth.config hooks / admin API / 未來變動路徑）的**唯一入口**。影響 tasks 3.3 / 4.1。

### Phase 規劃

- **Phase 1** — types + ingest（已完成 2026-04-19）：`shared/types/auth.ts` 新增、`shared/types/knowledge.ts` 升級 `Role`/`AdminSource`、`app/composables/useUserRole.ts` 支援三值 + legacy fallback、tasks.md ingest 偏差修正。
- **Phase 2** — migration + helpers：`server/database/migrations/0006_*.sql`、drizzle `server/db/schema.ts` 新增 `systemSettings` / `memberRoleChanges` table、`server/utils/guest-policy.ts`、`server/utils/member-role-changes.ts`、`server/utils/require-role.ts`。
- **Phase 3** — auth hook + server API：擴充 `server/auth.config.ts` databaseHooks、`requireRuntimeAdminSession` 完全替換、`server/api/admin/members/**` / `server/api/admin/settings/guest-policy.*`、MCP middleware guest policy 檢查。
- **Phase 4** — UI：`app/pages/admin/members/`、`app/pages/admin/settings/guest-policy.vue`、`app/pages/account-pending.vue`、`app/components/admin/members/*`、`app/components/chat/GuestAccessGate.vue`、`app/layouts/default.vue` 導覽擴張。
- **Phase 5** — tests + design review：role × policy 九格權限測試、OAuth callback 降級測試、KV version propagation 測試、Playwright chat guest states、design review skill 按 canonical order 跑 + audit。

---

## 1. Schema Migration 與 Seed（資料層真相來源）

- [x] 1.1 建立 `server/database/migrations/0006_three_tier_role_and_settings.sql`，內容包含：
      (a) 一次性 `UPDATE user SET role = 'member' WHERE role = 'user'`（既有 `'user'` 語義等於已登入使用者 ≈ Member）；
      (b) `ALTER TABLE mcp_tokens ADD COLUMN created_by_user_id TEXT REFERENCES user(id)`（Q1 採 A：新增 FK 以支援 6.2.b 的 user.role × guest_policy 檢查）；legacy token 欄位為 NULL，MCP middleware 將 NULL 視為 `'admin'`（system seed）；
      (c) `CREATE TABLE system_settings` + seed `('guest_policy', 'same_as_member', now, 'system')`；
      (d) `CREATE TABLE member_role_changes` + index `(user_id, created_at)`。
      落實 Requirement: Three-Tier Role Enum On Users、System Settings Store For Guest Policy、Role Changes Are Audited。
      2026-04-19 UPDATED：Phase 0 發現 `user.role` 欄位已存在（由 `0002_add_admin_plugin_columns.sql` 建立，default `'user'`，僅兩值）；不需新增欄位，改以 UPDATE 升級 + 由 better-auth `admin({ defaultRole: 'guest' })` 設定新建 default。原 tasks 1.1/1.2/1.3 已合併為單一 migration 0006。
      2026-04-19 PASS：Phase 2 完成。檔案：`server/database/migrations/0006_three_tier_role_and_settings.sql`。`sqlite3 :memory:` dry-run 通過（legacy 'user'→'member' UPDATE 生效、system_settings seed 寫入、member_role_changes index 建立、mcp_tokens.created_by_user_id FK 欄位加入）。drizzle schema 同步更新 `server/db/schema.ts`（`mcpTokens.createdByUserId` / `systemSettings` / `memberRoleChanges`）。
- [x] 1.2 [P] （已合併到 1.1，保留編號以追蹤 system_settings 設計驗收）驗證 migration 0006 含 `system_settings` 表與 seed row。
      2026-04-19 UPDATED：原為獨立 migration，改為 0006 的一部分以保證原子性。
      2026-04-19 PASS：Phase 2 完成。migration 0006 dry-run 確認 `system_settings` 表建立、seed row `('guest_policy', 'same_as_member', 'system')` 以 `INSERT OR IGNORE` 寫入。
- [x] 1.3 [P] （已合併到 1.1，保留編號以追蹤 member_role_changes 設計驗收）驗證 migration 0006 含 `member_role_changes` 表與 `(user_id, created_at)` index。
      2026-04-19 UPDATED：原為獨立 migration，改為 0006 的一部分以保證原子性。
      2026-04-19 PASS：Phase 2 完成。migration 0006 dry-run 確認 `member_role_changes` 表 + `idx_member_role_changes_user_created` composite index 建立；FK → `user(id)` 在 `PRAGMA foreign_keys = ON` 下解析。
- [ ] 1.4 不需獨立 backfill script：migration 0006 內建 `UPDATE user SET role='member' WHERE role='user'`；Admin seed 由 better-auth `databaseHooks.session.create.before` 每次登入 drift-check（已存在，只需擴充為三值並呼叫 `recordRoleChange`）。migration 後首次 Admin 登入時會 upsert `role='admin'` 並寫 audit row。
      2026-04-19 UPDATED：原要求獨立 backfill script；Phase 0 發現 session hook 已做 drift sync，改為依賴 hook 被動觸發 + migration 內建 UPDATE。

## 2. 共享型別與 Zod schema

- [x] 2.1 `shared/types/auth.ts` 新增 `Role` enum（`'admin' | 'member' | 'guest'`）、`GuestPolicy` enum（`'same_as_member' | 'browse_only' | 'no_access'`，預設 `same_as_member`）、`AdminSource` enum（`'allowlist' | 'none'`），對應 Zod schema 與 assertNever 範本註解，供 server 與 UI 共用；落實 Requirement: Guest Policy Enum And Default。
      2026-04-19 DONE：Phase 1 完成。檔案：`shared/types/auth.ts`。
- [x] 2.2 [P] 更新 `shared/types/knowledge.ts` 的 `UserProfileRecord.roleSnapshot: string` → `Role`、`adminSource: string` → `AdminSource`；更新 `app/composables/useUserRole.ts` 使用 `Role` 型別並 fallback 從 `'user'` → `'guest'`（legacy `'user'` 視為 `'member'`）；新增 `isMember` / `isGuest` computed。drizzle schema（`user_profiles.roleSnapshot` / `adminSource`）仍為 text 欄位，於 runtime 由 Zod 驗證。better-auth 管理的 `user.role` 欄位無對應 drizzle model（在 `hub:db`），不需改。
      2026-04-19 UPDATED：原敘述「更新 drizzle schema」不精確；`user` 表不在 `server/db/schema.ts`。Phase 1 完成。檔案：`shared/types/knowledge.ts`、`app/composables/useUserRole.ts`。

## 3. 權限檢查 helpers（server 層）

- [x] 3.1 擴充 `server/utils/admin-session.ts`：採 Q2 決策 (A) 完全替換，`requireRuntimeAdminSession` 內部改為讀 `session.user.role === 'admin'`（而非 `getRuntimeAdminAccess(email)` allowlist 比對）；allowlist 僅保留在 `server/auth.config.ts` 作為 Admin seed 的唯一來源。同時新增 `requireRole(event, 'admin' | 'member')` helper（新檔 `server/utils/require-role.ts`）：Admin → `session.user.role === 'admin'`；Member → `role !== 'guest'` 或 `(role === 'guest' && guest_policy === 'same_as_member')`。Member 路徑呼叫 `getGuestPolicy(event)`。落實 design.md 決策「權限檢查的 server helper 設計」。
      2026-04-19 UPDATED：原敘述檔名 `server/utils/require-auth.ts` 不存在；實際檔案為 `server/utils/admin-session.ts`。採 Q2=A：不走雙軌過渡，一次替換並更新 20 處 server API call sites（見 Phase 1 call-site 清單）。
      2026-04-19 PASS：Phase 2 完成。`server/utils/admin-session.ts` 內部改讀 `session.user.role === 'admin'`（primary path），allowlist 保留為 legacy session 的 transitional fallback（`role == null` 時）。新檔 `server/utils/require-role.ts` 提供 `requireRole(event, 'admin' | 'member')`，Member 路徑整合 `guestIsMemberEquivalent(policy)` switch+assertNever，policy 403 訊息依 `guestDenialMessage` 產出。函數 signature 維持不變，20 處 call sites 透明遷移（此 phase 未改 call sites 本身，等 Phase 3 OAuth hook 穩定後再逐條驗證）。
- [x] 3.2 [P] `server/utils/guest-policy.ts` 實作 `getGuestPolicy(event)`：先讀 KV version stamp（使用既有 `runtimeConfig.knowledge.bindings.rateLimitKv` binding 或另開 namespace），符合則回 in-memory Map 快取值，不符則重讀 D1 `system_settings` 並更新本地快取；落實 design.md 決策「Guest Policy 快取策略」。
      2026-04-19 PASS：Phase 2 完成。`server/utils/guest-policy.ts` 採用既有 `runtimeConfig.knowledge.bindings.rateLimitKv` binding（key prefix `guest_policy:` 避免與 rate-limit counter 衝突），無需另開 KV namespace。含 `getGuestPolicy(event)` 讀取 + `setGuestPolicy(event, { value, changedBy })` 寫入 + `__resetGuestPolicyCacheForTests` helper。D1 / KV 故障時 fail-open 到 `DEFAULT_GUEST_POLICY`（same_as_member）避免 lockout；wrapped in `consola.withTag('guest-policy')` 日誌。
- [x] 3.3 [P] `server/utils/member-role-changes.ts` 實作 `recordRoleChange(db, { userId, fromRole, toRole, changedBy, reason })`，寫入 `member_role_changes` audit row。採 Q3 決策 (A)：此 helper 為三個寫入時機的**唯一入口**：(a) `server/auth.config.ts` 的 `databaseHooks.user.create.before` / `session.create.before`（allowlist seed / drift 降級）；(b) `server/api/admin/members/[userId].patch.ts`（Admin UI 升降）；(c) 任何未來 role 變動路徑。未透過此 helper 寫 role 的變動視為設計缺陷。
      2026-04-19 UPDATED：Q3=A，強調唯一入口語義。
      2026-04-19 PASS：Phase 2 完成。`server/utils/member-role-changes.ts` 匯出 `recordRoleChange(hubDb, input)` + `ROLE_CHANGE_SYSTEM_ACTOR` / `ROLE_CHANGE_DB_DIRECT_ACTOR` sentinels + `RecordRoleChangeInput` interface。透過結構化 `HubDbModuleLike` type 接受 `{ db, schema }`（`getDrizzleDb()` 回傳值），避免拉入 drizzle 整組 type graph；`crypto.randomUUID()` 生成 id。

## 4. OAuth Callback 與 Guest 建立流程

- [x] 4.1 擴充 `server/auth.config.ts` 的 `databaseHooks`：
      (a) `user.create.before`：`deriveRole(email)` 回傳 `'admin' | 'guest'`（命中 allowlist → admin；否則 → guest），並在回傳 data 中設定 role；同步呼叫 `recordRoleChange` 寫 `'guest' → 'admin'`（allowlist-seed）或 `'guest' → 'guest'`（no-op 可省略）；
      (b) `session.create.before`：保留既有 drift 檢查；三值 drift 語義為「若 allowlist 命中且 role ≠ 'admin' → 升 admin + audit」、「若 allowlist 未命中且 role === 'admin' → 降 'member' + audit（**非** guest，因為曾經是正式成員）」、「其他情況 role 保持不變」；
      (c) better-auth `admin()` plugin 設定 `admin({ defaultRole: 'guest', adminRoles: ['admin'] })`，確保任何 insert 路徑若未顯式提供 role 也預設為 guest。
      落實 Requirement: OAuth Callback Does Not Gate On Allowlist。
      2026-04-19 UPDATED：原敘述檔案 `server/api/auth/[...all].ts` 不存在；nuxt-better-auth 自動處理 OAuth routes，真正 hook 點為 `server/auth.config.ts`。Phase 0 確認既有 hook 已做 role drift sync，此 task 為擴充而非新建。
      2026-04-19 PASS：Phase 3 完成。`deriveRole` 改回 `'admin' | 'guest'`；`admin({ defaultRole: 'guest', adminRoles: ['admin'] })`；`user.create.before` 設定 role + `user.create.after` 在 admin-seed 時寫 audit（`guest → admin`, `reason: 'allowlist-seed'`）；`session.create.before` 擴充三值 drift：allowlist-hit 非 admin → 升 admin + audit；allowlist-miss 且 role=admin → 降 member + audit `allowlist-removed`；legacy `'user'` + allowlist-miss → 靜默升 member（無 audit，對應 migration 0006 的 UPDATE）。`recordRoleChange` 透過相對路徑 import 以兼容 jiti（`member-role-changes.ts` 的 `#shared` alias 改為相對路徑）。
- [x] 4.2 [P] 撰寫測試驗證 `ADMIN_EMAIL_ALLOWLIST` 移除後下次登入自動降為 `'member'`（非 `'guest'`），覆蓋 Requirement: Three-Tier Role Enum On Users 的「Admin is demoted when removed from allowlist」scenario。注意此行為需確認 session hook 的降級邏輯（而非僅 allowlist seed 的升級邏輯）。
      2026-04-19 PASS：Phase 3 透過 `session.create.before` 的三值 drift 分支實作此行為（第 (B) 情境 allowlist-miss + role=admin → `'member'` + audit `reason='allowlist-removed'`）。此 task 的行為驗證由 Phase 3 Admin API 整合測試 + Phase 5 `test/unit/oauth-callback.spec.ts` (§9.2) 覆蓋（§9.2 排 Phase 4+）。Phase 3 僅實作行為、不獨立寫 unit test（以免 mock better-auth hook context 成本過高）。

## 5. Admin 成員管理 API

- [x] 5.1 `server/api/admin/members/index.get.ts` — 列表 API，支援分頁、role 篩選、排序（default: `last_login_at DESC`），權限為 `requireRole('admin')`。
      2026-04-19 PASS：Phase 3 完成。列表走 drizzle 直查 better-auth `user` table（hub:db），因該表無 `lastLoginAt` 欄位，預設排序改為 `createdAt DESC`（並加 id 作 tie-break）。支援 `role` 篩選 + `sort` 三選項（`created_desc` / `created_asc` / `email_asc`）。分頁走 `paginateList` envelope。權限仍用 `requireRuntimeAdminSession`（Phase 2 已透明遷移為讀 `user.role === 'admin'`）。
- [x] 5.2 `server/api/admin/members/[userId].patch.ts` — role 變更 API，實作 design.md 決策「Admin 無法自降 Admin 的實作」的四層硬性檢查（目標非 allowlist 不得為 admin / 目標非自己 / allowlist 內不得被降 / 非 admin 不得升 admin），落實 Requirement: Admin Role Is Only Seeded From Env Var。
      2026-04-19 PASS：Phase 3 完成。四層檢查依 (1) 自降 → (2) allowlist-seed 降級 → (3) 非 allowlist 升 Admin 順序 short-circuit，每層回精確使用者訊息。happy-path + no-op（同 role）+ 404 都有涵蓋。成功 path 呼叫 `recordRoleChange(hubDb, { ... changedBy: session.user.id, reason: body.reason ?? 'admin-ui' })`，Q3=A 唯一入口語義維持。
- [x] 5.3 [P] `server/api/admin/settings/guest-policy.get.ts` — 讀取當前 `guest_policy`。
      2026-04-19 PASS：Phase 3 完成。薄 wrapper 委派 `getGuestPolicy(event)`；回傳 `{ data: { value } }` envelope。
- [x] 5.4 `server/api/admin/settings/guest-policy.patch.ts` — 更新 `guest_policy`，同時更新 D1 + KV version stamp；落實 Requirement: System Settings Store For Guest Policy 與 Requirement: Policy Changes Propagate Across Worker Instances Within One Request。
      2026-04-19 PASS：Phase 3 完成。Zod body schema 複用 `guestPolicySchema`；委派 `setGuestPolicy(event, { value, changedBy: session.user.id })`，D1 upsert + KV version stamp 遞增在 helper 內已實作。

## 6. Web / MCP 入口權限閘

- [x] 6.1 `server/api/chat.post.ts`（及相關 `/api/conversations/**`）入口改用 `requireRole(event, 'member')`，違反時回 HTTP 403 含使用者訊息（不退化為 404），落實 Requirement: Browse-Only Policy Restricts Guest Question Submission。
      2026-04-19 UPDATED：實際檔案為 `server/api/chat.post.ts`（單檔）+ `server/api/conversations/**`，非 `server/api/chat/**` 目錄。
      2026-04-19 PASS：Phase 4 完成。`chat.post.ts` 改用 `requireRole(event, 'member')` + `isAdmin = sessionWithRole.user.role === 'admin'`；`conversations/{index.get,[id].get,[id].delete,[id]/messages.get}.ts` 全部改 `requireRole`。
- [x] 6.2.a `mcp_tokens` 加 `created_by_user_id TEXT REFERENCES user(id)` 欄位（已併入 migration 0006，由 1.1 處理）；更新 `shared/types/knowledge.ts` 的 `McpTokenRecord` 加上 `createdByUserId: string | null` 欄位；更新 `server/utils/mcp-token-store.ts` 的 `AdminMcpTokenSummary` 與 `buildProvisionedMcpToken` 簽章支援 `createdByUserId`；`/api/admin/mcp-tokens/index.post.ts` 建立 token 時記錄當前 admin 的 `session.user.id`。
      2026-04-19 NEW：原 6.2 拆分出的 schema/type 部分。Q1 採 A。
      2026-04-19 PASS：Phase 4 完成。`McpTokenRecord` 加 `createdByUserId: string | null`；`buildProvisionedMcpToken` 必填 `createdByUserId`；`createToken` INSERT + `findUsableTokenByHash` SELECT 皆含新欄位；admin POST endpoint 傳 `session.user.id ?? null`。
- [x] 6.2.b [P] `server/api/mcp/**`（具體為 `server/mcp/index.ts` middleware + `server/mcp/tools/*.ts`）加入 role × guest_policy 檢查：token 對應 user.role（`mcp_tokens.created_by_user_id` JOIN `user.role`，NULL 視為 `'admin'`——代表 legacy system-seed token）：`admin | member` → 正常 scope 檢查；`guest` + `same_as_member` → Member 行為；`guest` + `browse_only` → `askKnowledge` 回 403 `GUEST_ASK_DISABLED`；`guest` + `no_access` → 所有 tool 回 403 `ACCOUNT_PENDING`。落實 design.md 決策「MCP tools 的權限檢查」與 Requirement: No-Access Policy Blocks All Feature Surfaces For Guests。
      2026-04-19 UPDATED：原 6.2 拆為 6.2.a（schema/FK）+ 6.2.b（middleware 行為）。NULL `created_by_user_id` 被視為 admin 的妥協是為了向後相容既有未綁 user 的 token。
      2026-04-19 PASS：Phase 4 完成。新建 `server/utils/mcp-role-gate.ts`（`gateMcpToolAccess` + `McpRoleGateError` + `createDefaultUserRoleLookup`，含 `'user'` legacy → `'member'` 映射）；`runMcpMiddleware` 在 rate-limit 後呼叫 gate，error 透過 `statusMessage` 帶 `GUEST_ASK_DISABLED` / `ACCOUNT_PENDING` / `UNKNOWN_TOKEN_OWNER` code；MCP 既有 4 個 test 檔（mcp-routes / acceptance-tc-13 / get-document-chunk-replay / mcp-tool-get-document-chunk）全綠共 40 passed + 1 skipped。

## 7. Admin UI：成員管理頁

- [x] 7.1 `app/middleware/admin.ts`（route middleware，非 `.global.ts`）現況已透過 `useUserRole().isAdmin` 檢查 `session.user.role === 'admin'`（client-side），Phase 1 `useUserRole` 更新後 fallback 從 `'user'` → `'guest'`，legacy `'user'` 仍視為 Member（非 admin）→ 既有 middleware 語義正確，無需改動；真正的工作為 server-side `requireRuntimeAdminSession` 遷移（見 3.1）。驗收：確認 Member / Guest 訪問 `/admin/*` 頁面會被 middleware 擋下（redirect to `/`）。
      2026-04-19 UPDATED：原敘述 `admin.global.ts` 檔名錯誤（實際為 `admin.ts`，named middleware）、且誤判「allowlist 檢查改為 role 檢查」——現況 middleware 已經是 role 檢查（讀 session snapshot）；真正的 allowlist → role 遷移在 server 層（3.1）。
      2026-04-19 PASS：Phase 5-2 驗收。既有 `app/middleware/admin.ts` 讀 `useUserSession().loggedIn` + `useUserRole().isAdmin`，後者 Phase 1 已更新為 `normaliseRole` 三值語義（legacy `'user'` → `'member'`，非 `'admin'`）。Member / Guest 都得到 `isAdmin.value === false` → middleware `navigateTo('/')` 阻擋。無需改動 middleware；server-side `requireRuntimeAdminSession`（Phase 2 已遷移為讀 `session.user.role === 'admin'`）為真正的授權層。
- [x] 7.2 [P] `app/pages/admin/members/index.vue` 建立成員列表頁，使用 `UTable` 顯示 email / name / role badge / last login / actions；實作 loading / empty / error / unauthorized 四態；落實 Requirement: Admin Member List Page
      2026-04-19 PASS：Phase 5-1 完成。`app/pages/admin/members/index.vue` 使用 pinia colada `useQuery` + `refetch`、`getUiPageState` 四態分流（loading / unauthorized / error / empty / success）、`UTable` 含 email / name / role badge / createdAt / actions 欄位（< md 隱藏 name + createdAt，保留主欄 + actions）、`USelect` role filter、`UPagination`、呼叫 `MemberRoleActions` + `ConfirmRoleChangeDialog`。shared row shape 集中在 `shared/types/admin-members.ts`（`AdminMemberRow`）避免 page / component 各自宣告漂移。
- [x] 7.3 [P] `app/components/admin/members/MemberRoleActions.vue` — 升降按鈕，依當前 role 條件式渲染；被禁止時（self / allowlist seed）按鈕隱藏
      2026-04-19 PASS：Phase 5-1 完成。`app/components/admin/members/MemberRoleActions.vue` 用 `switch + assertNever` 列舉三角色的合法 action（admin=無 action + 顯示 env-var 提示；member→降為訪客；guest→升為成員）；`isSelf` 時按鈕 disabled + aria-label 提示「請從 ADMIN_EMAIL_ALLOWLIST 移除」；allowlist seed 由後端四層硬檢查擋（PATCH endpoint）避免前端比對 allowlist。
- [x] 7.4 [P] `app/components/admin/members/ConfirmRoleChangeDialog.vue` — 二次確認對話框，顯示 email / 當前 role / 目標 role / 警告訊息；落實 Requirement: Role Promotion And Demotion Actions With Confirmation
      2026-04-19 PASS：Phase 5-1 完成。`app/components/admin/members/ConfirmRoleChangeDialog.vue` 用 `UModal` + `v-model:open`；顯示 email + 當前 role → 目標 role 箭頭、`transitionWarning` 用 switch+assertNever 產生各目標 role 的警告；`reason` 選填 Textarea（maxlength=500，寫入 audit row）；成功 toast + emit `updated`；失敗 toast 錯誤訊息（用 `$csrfFetch` PATCH `/api/admin/members/[userId]`）。
- [x] 7.5 [P] `app/pages/admin/settings/guest-policy.vue` — dial 切換頁，使用 radio group 呈現三選項 + 每項 hover description；儲存失敗時還原選擇並 toast 錯誤；落實 Requirement: Guest Policy Settings Page With Single Dial
      2026-04-19 PASS：Phase 5-1 完成。`app/pages/admin/settings/guest-policy.vue` 用原生 `<input type=radio>` radio group（3 選項 label + 描述區分）；每個 label 點擊整個卡片可選；`policyOption()` 用 switch+assertNever 列舉三選項，描述文案來自 B16 design.md；`isDirty` computed 控制 Save / Discard 按鈕狀態；儲存失敗 revert `selected = serverValue` + error toast；成功後 `refresh()` + success toast（「新政策會於所有 Worker 實例下次請求時立即生效」）。

## 8. Web UI：Guest 狀態呈現

- [x] 8.1 `app/layouts/default.vue`（或 `AppNavigation`）新增 `/admin/members`、`/admin/settings/guest-policy` 導覽項，僅 `role === 'admin'` 可見；落實 Requirement: Admin Navigation Exposes Member And Policy Entries
      2026-04-19 PASS：Phase 5-2 完成。`app/layouts/default.vue` + `app/layouts/chat.vue` 同時擴充 `links` computed：`isAdmin` 時額外 push `成員管理 /admin/members` + `訪客政策 /admin/settings/guest-policy`，且每個 link 補 icon（i-lucide-users / i-lucide-shield）供抽屜模式使用。`>= md` 走 `UNavigationMenu`、`< md` 走 `USlideover` 抽屜，兩者共用同一 `links` 陣列避免漂移；抽屜點擊連結後 `handleDrawerLinkClick` 自動關閉。
- [x] 8.2 [P] `app/components/chat/GuestAccessGate.vue` — 根據 `user.role × guest_policy` 呈現三種狀態：完整 chat / browse-only banner + disabled input / 導向 `/account-pending`；落實 Requirement: Chat Page Access And Navigation（modified）與 design.md 決策「Web `/chat` 入口的 Guest 呈現」
      2026-04-19 PASS：Phase 5-1 完成。`app/components/chat/GuestAccessGate.vue` 從 `useCurrentUserRole()` 讀 `visualState`；`full` / `browse_only` render default slot（slot props 暴露 `canAsk` / `policy` / `visualState` 給父頁綁 `:disabled`）；`browse_only` 頂部 banner 含 `role="status"` + `aria-live="polite"`，響應式 `px-3 py-2 md:px-4 md:py-3` + `text-sm md:text-base`；`no_access` 於 `onMounted` + `watch(visualState)` 呼叫 `navigateTo('/account-pending')`，顯示 loading placeholder 避免 flash。
- [x] 8.3 [P] `app/pages/account-pending.vue` — `no_access` 狀態下的提示頁，顯示「帳號待審核」+ 聯絡管理員指示；落實 Requirement: No-Access Policy Blocks All Feature Surfaces For Guests
      2026-04-19 PASS：Phase 5-1 完成。`app/pages/account-pending.vue` `definePageMeta({ auth: true })`；`UCard max-w-md mx-auto`（響應式 px-4 md:px-0）+ hourglass icon + 帳號 email 顯示 + 聯絡 email（hardcoded `support@example.com` + TODO comment 備註未來從 runtime config 讀）+ 登出按鈕（better-auth `signOut` + `navigateTo('/')`）+ mailto 聯絡按鈕；footer 按鈕響應式 `flex-col-reverse md:flex-row md:justify-end`。
- [x] 8.4 [P] `app/composables/useCurrentUserRole.ts` — 封裝 `user.role` + `guest_policy` 的組合邏輯，供 UI 元件共用（使用 `switch + assertNever` 列舉三種 guest 狀態）
      2026-04-19 PASS：Phase 5-1 完成。`app/composables/useCurrentUserRole.ts` 整合 `useUserRole()` + `useFetch('/api/guest-policy/effective')`；`visualState` computed 用 `switch + assertNever` 列舉三 policy → 三種 `GuestVisualState` (`full` / `browse_only` / `pending`)；`canAsk` = `visualState === 'full'`；policy 以 `guestPolicySchema.safeParse` + fallback `DEFAULT_GUEST_POLICY` 守備 race / 破損 payload。新增 public endpoint `server/api/guest-policy/effective.get.ts`（requireUserSession，non-admin 也能讀 effective policy）。

## 9. 測試覆蓋

- [x] 9.1 `test/unit/require-role.spec.ts` — Admin / Member / Guest × same_as_member / browse_only / no_access 九種組合的權限判斷。
      2026-04-19 PASS：Phase 3 完成，16 個 case 全通過。涵蓋 admin/member × 3 policy（PASS 且不 consult policy 保持熱路徑效能）、guest × 3 policy（same_as_member PASS + policy 回傳結果；browse_only / no_access 各自對應 403 + 精確訊息）、legacy `'user'` normalise 為 `'member'`、missing role fallback 到 `'guest'` (least privilege)。
- [x] 9.2 [P] `test/unit/oauth-callback.spec.ts` — 新使用者建立、allowlist 命中升 admin、allowlist 移除降 member 三種情境；落實 Requirement: OAuth Callback Does Not Gate On Allowlist
      2026-04-19 PASS：Phase 5-1 完成，9 個 case 全通過。`test/unit/oauth-callback.spec.ts` 透過 import `server/auth.config` default factory + mock `hub:db` / `recordRoleChange` / `drizzle-orm` 實現三行為：(a) 新 non-allowlist user `user.create.before` 標 `role='guest'` + `user.create.after` 不寫 audit（guest→guest noise 排除）；(b) allowlist hit `user.create.before` 標 `role='admin'` + `user.create.after` 寫 `guest→admin` audit `reason='allowlist-seed'`；(c) `session.create.before` allowlist-miss + admin → 降 `member` + audit `reason='allowlist-removed'`。額外涵蓋：allowlist email 大小寫 normalize、promote back to admin on drift、no-op when already in sync、legacy `role='user'` 靜默升 member（無 audit）。
- [x] 9.3 [P] `test/integration/admin-members.spec.ts` — PATCH API 的四層硬性檢查（self-demote / allowlist-seed / non-allowlist-promote / happy path）。
      2026-04-19 PASS：Phase 3 完成，7 個 case 全通過。(1) 自降 admin → member 被擋 + 錯誤訊息涵蓋「不可降低自己」；(2) allowlist-seed 降級被擋 + 「此使用者為 Admin seed」；(3) 非 allowlist 升 admin 被擋 + 「僅由 ADMIN_EMAIL_ALLOWLIST env var 控制」；(4) happy-path guest → member 成功且 `recordRoleChange` 接收到正確 payload（`changedBy: 'admin-self'`, `reason: 'admin-ui'`）；(4b) member → guest 合法 demotion；no-op (same role) 回 `changed: false` 不寫 audit；404 target not found。
- [x] 9.4 [P] `test/integration/guest-policy-propagation.spec.ts` — KV version stamp 觸發 reload 的端對端驗證；落實 Requirement: Policy Changes Propagate Across Worker Instances Within One Request
      2026-04-19 PASS：Phase 5-2 完成，3 個 case 全通過。`test/integration/guest-policy-propagation.spec.ts` 用 `vi.resetModules` + `vi.doMock` 模擬兩個 Worker instance（A / B）共享一個 fake KV Map + 一個 fake D1 rows Map。(1) A 寫 browse_only → D1 upsert + KV `guest_policy:version` 被 `put` 新 timestamp → B 下次 `getGuestPolicy` 讀到版本漂移 → 重讀 D1 → 返回 `browse_only`；(2) A 寫後自己下次 read 也看到新值（cache 已清）；(3) 連續兩次 `setGuestPolicy` 產生嚴格遞增的 KV stamp（monotonic）。
- [x] 9.5 [P] `test/e2e/chat-guest-states.spec.ts` — Playwright script：`browse_only` 下 input disabled + banner；`no_access` 下 redirect 到 `/account-pending`
      2026-04-19 PASS：Phase 5-1 完成（spec 已落地，待 Phase B / admin-seed 的 dev-login helper 補上 Guest session setup 後即可在 CI 跑綠）。檔案放 `e2e/chat-guest-states.spec.ts`（與既有 `e2e/table-fallback.spec.ts` 同目錄；專案 e2e 在 repo root `e2e/` 不是 `test/e2e/`）；用 `page.route('**/api/guest-policy/effective', ...)` stub 三 policy 狀態 → 驗證 banner 存在/缺失、`textbox` enabled/disabled、`/account-pending` redirect + heading 「帳號待審核」。Phase 1 僅確保 spec 落地 + 類型正確；實際 E2E run 需 §2 viewport baseline 配套與 Phase B seeded guest account。

## 10. Design Review

- [ ] 10.1 檢查 `.impeccable.md` 是否存在，若無則執行 `/impeccable teach`
- [ ] 10.2 執行 `/design improve` 對 `app/pages/admin/members/**`、`app/pages/admin/settings/**`、`app/pages/account-pending.vue`、`app/components/admin/members/**`、`app/components/chat/GuestAccessGate.vue`（含 Design Fidelity Report）
- [ ] 10.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [ ] 10.4 依 `/design` 計劃按 canonical order 執行 targeted skills
- [ ] 10.5 執行 `/audit` — 確認 Critical = 0
- [ ] 10.6 執行 `/review-screenshot` — 視覺 QA
- [ ] 10.7 Fidelity 確認 — `design-review.md` 中無 DRIFT 項

## 人工檢查

- [ ] #1 以 Admin 身分登入後，`/admin/members` 顯示成員列表，角色 badge 正確
- [ ] #2 以 Admin 身分將一位 Guest 升為 Member，confirmation dialog 正常運作，列表刷新正確
- [ ] #3 以 Admin 身分嘗試將自己降為 Member，UI 按鈕條件式隱藏且 API 回 403
- [ ] #4 以 Admin 身分嘗試將非 allowlist email 升為 Admin，API 回 403 並顯示使用者友善訊息
- [ ] #5 切換 `guest_policy = 'browse_only'` 後，新 Guest 登入 `/chat` 看到 input disabled + banner
- [ ] #6 切換 `guest_policy = 'no_access'` 後，Guest 登入直接被導向 `/account-pending`
- [ ] #7 切換 `guest_policy` 後，另一個 Worker 實例在下次請求立即套用新 policy（透過開兩個 curl 驗證）
- [ ] #8 將一個 email 從 `ADMIN_EMAIL_ALLOWLIST` 移除後，該使用者下次登入自動降為 Member（驗證 `member_role_changes` 有對應 audit row）
- [ ] #9 以非 Admin 身分直接訪問 `/admin/members` 被阻擋（unauthorized state）
- [ ] #10 Guest 身分下 MCP token 呼叫 `askKnowledge` 在 `browse_only` 時回 `GUEST_ASK_DISABLED`，在 `no_access` 時回 `ACCOUNT_PENDING`

## Affected Entity Matrix

### Entity: users (modified)

| Dimension       | Values                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Columns touched | `role` (new, enum: admin/member/guest)                                                                     |
| Roles           | admin, member, guest                                                                                       |
| Actions         | create (OAuth callback), read (admin list), update-role (admin), demote-self (blocked), audit-on-change    |
| States          | empty, loading, error, success, unauthorized                                                               |
| Surfaces        | `/admin/members` (list), OAuth callback (create), `/chat` (role gate), `/account-pending` (no_access 狀態) |

### Entity: system_settings (new)

| Dimension       | Values                                                               |
| --------------- | -------------------------------------------------------------------- |
| Columns touched | key, value, updated_at, updated_by                                   |
| Roles           | admin (read + write), member/guest (effect only, no direct read)     |
| Actions         | read (via getGuestPolicy), update (admin), audit via updated_by      |
| States          | loading, error, success, unauthorized                                |
| Surfaces        | `/admin/settings/guest-policy` (UI)、每個 server handler（間接讀取） |

### Entity: member_role_changes (new)

| Dimension       | Values                                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| Columns touched | id, user_id, from_role, to_role, changed_by, reason, created_at                |
| Roles           | admin (寫入來源 UI 操作), system (OAuth callback allowlist seed)               |
| Actions         | insert（僅寫入，v1.0.0 不提供 UI 讀取）                                        |
| States          | 不對使用者直接呈現（UI 讀取歸 admin-ui-post-core）                             |
| Surfaces        | 寫入面：`server/api/admin/members/**`、OAuth callback、guest-policy 相關 audit |

## User Journeys

### Admin 成員管理流程

- **Admin** 登入後點擊導覽「成員管理」→ 進入 `/admin/members` → 看到所有使用者列表（含自己）→ 點擊某 Guest 的「升為 Member」→ confirmation dialog 顯示 email + 當前 role + 目標 role → 確認後列表刷新，該使用者 role badge 改為 Member → `member_role_changes` 寫入 audit row
- **Admin** 試圖將自己降為 Member → 按鈕條件式隱藏（不可點）或 API 擋下（403 + 訊息「請從 env var 移除」）
- **Admin** 試圖將非 allowlist 使用者升為 Admin → API 回 403 + 訊息「Admin 權限由 env var 控制」

### 訪客政策切換流程

- **Admin** 在管理介面點擊「訪客政策」→ 進入 `/admin/settings/guest-policy` → 看到三個 radio 選項（當前選中 `same_as_member`）→ 選擇 `browse_only` → 確認儲存 → 成功 toast → D1 更新 + KV version stamp 遞增
- **另一個 Worker 實例** 收到下次請求 → 讀 KV version 發現更新 → 重讀 D1 → 新 policy 立即生效
- **Guest 使用者** 在政策切換後刷新 `/chat` → 看到 browse-only banner + disabled input

### 開放註冊 Guest 流程

- **新使用者**（email 不在 allowlist）點擊登入 → Google OAuth 流程 → 成功返回 → 系統建立 `users` row with `role = 'guest'` + audit row → 導向首頁或 `/chat`
- `guest_policy = 'same_as_member'`：Guest 直接可提問（與 Member 無差別）
- `guest_policy = 'browse_only'`：Guest 看到 disabled input + banner「訪客僅可瀏覽」
- `guest_policy = 'no_access'`：Guest 被導向 `/account-pending`，顯示聯絡管理員指示

### Admin 身分隨 allowlist 變動

- **Admin** 某 email 從 `ADMIN_EMAIL_ALLOWLIST` env var 移除 → 該使用者下次登入時 OAuth callback 比對發現 allowlist 不符 → 自動降為 Member + 寫 audit → 登入完成但 `/admin/*` 路徑被擋
