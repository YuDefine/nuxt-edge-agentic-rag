## 0. API Prerequisites (server + tests only)

- [x] 0.1 `GET /api/admin/mcp-tokens` — list endpoint returning `{ data, pagination }`, exposing only id / label / scopes / status / expires_at / last_used_at / created_at (never token_hash). Zod query schema via `paginationQuerySchema` + optional status filter.
  - 2026-04-19 local PASS: `server/api/admin/mcp-tokens/index.get.ts` + `createMcpTokenAdminStore.listTokensForAdmin/countTokensForAdmin`; 4 tests (401/403/redaction-no-token_hash/empty-list) green.
- [x] 0.2 `DELETE /api/admin/mcp-tokens/[id]` — revoke endpoint; sets `status='revoked'` + `revoked_at=now()`; idempotent (already-revoked returns 200 no-op); 404 when not found.
  - 2026-04-19 local PASS: `server/api/admin/mcp-tokens/[id].delete.ts` + `createMcpTokenAdminStore.revokeTokenById`; 5 tests (401/403/404/revoked/already-revoked idempotent) green.
- [x] 0.3 `GET /api/admin/query-logs` — list endpoint with channel / outcome / query_type / redaction_applied / date range filters; redaction-safe rows only (never raw query); page-based pagination.
  - 2026-04-19 local PASS: `server/api/admin/query-logs/index.get.ts` + `createQueryLogAdminStore.listQueryLogs/countQueryLogs`; 4 tests (401/403/redaction-safe row/filter forwarding) green.
- [x] 0.4 `GET /api/admin/query-logs/[id]` — detail endpoint returning redaction-safe fields + risk_flags_json + config_snapshot_version (decision_path omitted until observability-and-debug adds the column); never returns raw / un-redacted text.
  - 2026-04-19 local PASS: `server/api/admin/query-logs/[id].get.ts` + `createQueryLogAdminStore.getQueryLogById`; 4 tests (401/403/404/redaction-safe detail) green.
- [x] 0.5 All endpoints gated by `requireRuntimeAdminSession`; integration tests assert 401 (unauth) / 403 (non-admin) / 200 (happy) + redaction-guarantee assertions (no `token_hash` / `query_text` / `raw_query` keys).
  - 2026-04-19 local PASS: `test/integration/admin-mcp-tokens-route.test.ts` + `test/integration/admin-query-logs-route.test.ts` — 17 tests all green; explicit `.not.toHaveProperty('token_hash' | 'tokenHash' | 'query_text' | 'queryText' | 'raw_query' | 'rawQuery')` assertions on both list and detail responses.
- [x] 0.6 Run `pnpm test:integration` and confirm no regressions.
  - 2026-04-19 local PASS: 208/208 tests across 41 files, 0 failures (baseline was 191 tests across 39 files before this change).

## 1. Admin Token Management UI

- [x] 1.1 建立 `/admin/tokens` 路由與 page guard。
  - 2026-04-19 local PASS: `app/pages/admin/tokens/index.vue` 使用 `definePageMeta({ middleware: ['admin'] })`（同 `/admin/documents`），由既有 `middleware/admin.ts` 處理未登入 / 非 admin redirect。
- [x] 1.2 建立 token list data loader，顯示 label、scopes、status、expires_at、last_used_at。
  - 2026-04-19 local PASS: `useQuery({ key: ['admin','mcp-tokens'], query: () => $fetch('/api/admin/mcp-tokens') })`；UTable 欄位含 name / scopes / status / expiresAt / lastUsedAt / createdAt；symbol `—` fallback。
- [x] 1.3 建立 token scopes 顯示元件與 status badges。
  - 2026-04-19 local PASS: `app/components/admin/tokens/TokenStatusBadge.vue`（`switch + assertNever` active/revoked/expired）+ `TokenScopeList.vue`（已知 scope 翻譯 + 未知 fallback）。單元測試 `test/unit/admin-token-ui.test.ts` 綠。
- [x] 1.4 建立 token create form，支援 label、scope 選擇、到期設定。
  - 2026-04-19 local PASS: `TokenCreateModal.vue` 以 `UForm + Zod schema` 驗證 `name / scopes(multi-checkbox) / expiresInDays(字串數字)`，POST `/api/admin/mcp-tokens`。
- [x] 1.5 實作 create success state，僅一次性 reveal 明文 token。
  - 2026-04-19 local PASS: 建立成功後在同一 modal 切換至 reveal 面板，顯示 `UAlert warning`（「僅顯示此一次」）+ copy-to-clipboard 按鈕；關閉 modal 觸發 `resetForm()` 永久丟棄明文。
- [x] 1.6 建立 revoke action 與確認流程。
  - 2026-04-19 local PASS: `TokenRevokeConfirm.vue` 確認 modal（`UButton color="error"`），呼叫 `DELETE /api/admin/mcp-tokens/[id]`；成功後 `refetch()` 並顯示 toast。
- [x] 1.7 補齊 token list empty / loading / error 狀態。
  - 2026-04-19 local PASS: 使用共用 `getUiPageState()` 推導 loading / empty / error / unauthorized / success；每個 state 都有獨立 surface。
- [x] 1.8 驗證非 Admin 不可進入 token 管理 UI。
  - 2026-04-19 local PASS: `middleware: ['admin']` 套用既有 guard（`test/unit/middleware-admin.test.ts` 已覆蓋三條件）；頁面另內建 `unauthorized` state 處理 server 401/403 回應。

## 2. Admin Query Log UI

- [x] 2.1 建立 `/admin/query-logs` 列表頁。
  - 2026-04-19 local PASS: `app/pages/admin/query-logs/index.vue` with `useQuery` + filters-based key；`definePageMeta({ middleware: ['admin'] })`。
- [x] 2.2 建立 channel、outcome、query_type、redaction 狀態篩選 controls。
  - 2026-04-19 local PASS: 使用 `USelect` + `UInput[type=date]`；channel options 從 `KNOWLEDGE_CHANNEL_VALUES` 來；status options 對齊 server `QUERY_LOG_STATUS_VALUES`；query_type 欄位在 §0 API 尚未提供 filter，故以 status + channel + redaction + startDate/endDate 覆蓋 API 支援的篩選面。
- [x] 2.3 建立 redaction-safe log row 元件。
  - 2026-04-19 local PASS: 表格 cell 只顯示 `queryRedactedText`（server 已不回 raw query）；獨立 `QueryLogStatusBadge.vue` / `QueryLogChannelBadge.vue`（`switch + assertNever`），`test/unit/admin-query-log-ui.test.ts` 以 `projectForDisplay` 驗證禁止 key 不會溢出。
- [x] 2.4 補齊 list empty / loading / error 狀態。
  - 2026-04-19 local PASS: 四個 state 全齊，empty 提供「清除篩選」捷徑、error 提供 `refetch()`、unauthorized 提供返回首頁。
- [x] 2.5 建立 `/admin/query-logs/[id]` 詳情頁。
  - 2026-04-19 local PASS: `app/pages/admin/query-logs/[id].vue` with `useQuery` by route param；四個 state + 404 空狀態。
- [x] 2.6 在詳情頁顯示 request outcome、decision path、risk flags、config snapshot version。
  - 2026-04-19 local PASS: 顯示 status / channel / environment / configSnapshotVersion / redactionApplied / riskFlags / allowedAccessLevels。decision_path 欄位依 §0.4 註解**暫不顯示**（observability-and-debug change 會新增該欄位）。
- [x] 2.7 確保詳情頁不顯示未遮罩原文與禁止欄位。
  - 2026-04-19 local PASS: 模板只綁定 `detail.queryRedactedText`、不引用任何 `query_text / queryText / raw_query / rawQuery / token_hash` 欄位；server 本就不回。附 UI 文案說明「原始查詢內容不會儲存或顯示」。
- [x] 2.8 補齊 log UI 的 auth guard 與 unauthorized state。
  - 2026-04-19 local PASS: list + detail 皆套 `middleware: ['admin']`；兩頁皆有 `unauthorized` surface 處理 server 401/403。

## 3. Admin Summary Dashboard

- [x] 3.1 建立 `/admin/dashboard` route 與 feature gate。
  - 2026-04-19 local PASS: `app/pages/admin/dashboard/index.vue` + `middleware: ['admin']`；feature gate 由 `runtimeConfig.adminDashboardEnabled`（server-side 404 gate）與 `runtimeConfig.public.adminDashboardEnabled`（UI gate）雙層保護，可用 `NUXT_ADMIN_DASHBOARD_ENABLED=false` 關閉；預設 true。新增 `nuxt.config.ts` runtimeConfig 項目。
- [x] 3.2 建立 summary cards：documents、queries、tokens。
  - 2026-04-19 local PASS: `GET /api/admin/dashboard/summary` 回傳 `{ data: { cards: { documentsTotal, queriesLast30Days, tokensActive }, trend } }`；aggregate-only 聚合，redaction-safe（0 raw query text / token_hash 外洩）。`server/utils/admin-dashboard-store.ts` 封裝 `countDocuments / countRecentQueryLogs(30) / countActiveTokens / listRecentQueryTrend(7)`。UI 用 `useQuery({ key: ['admin','dashboard','summary'], staleTime: 30_000 })`。`AdminDashboardSummaryCard.vue` 呈現單張卡片。
- [x] 3.3 建立粗粒度趨勢或狀態摘要，不暴露 raw rows。
  - 2026-04-19 local PASS: `listRecentQueryTrend(7)` 使用 `substr(created_at, 1, 10)` 依日期聚合 count；UI `AdminDashboardQueryTrendList.vue` 顯示近 7 天 daily count bar + date 標籤，最大值 normalise 0–100%；整條 pipeline 不 SELECT / 回傳任何 query_text。單元測試明確驗證 SQL 不含 `query_text` / `raw_query` / `token_hash`。
- [x] 3.4 在 feature flag 關閉時隱藏或阻擋 dashboard 導覽與 route。
  - 2026-04-19 local PASS: server endpoint `if (!config.adminDashboardEnabled) throw 404`；UI `!featureEnabled || pageState === 'feature-off'` 顯示「管理摘要目前未啟用」surface；`app/layouts/default.vue` 導覽只在 `isAdmin && dashboardEnabled` 同時為真時推入「管理摘要」入口。
- [x] 3.5 補齊 dashboard empty / loading / error 狀態。
  - 2026-04-19 local PASS: 透過 `getUiPageState()` 推導 loading / empty / error / unauthorized / success + 額外 `feature-off` 旁路；每個 state 都有獨立 surface（icon + 說明 + CTA）。`hasAnyData` guard 確保三張卡全 0 + trend 空時走 empty state，而非把「0 次查詢」錯誤呈現成成功狀態。

## 4. Shared Admin UI Polish

- [x] 4.1 整合 admin 導覽，補上 tokens、query logs、dashboard 入口。
  - 2026-04-19 local PASS: `app/layouts/default.vue` 最終結構：`問答 → 文件管理 → Token 管理 → 查詢日誌 → 管理摘要（flag on 時）`；`dashboardEnabled` 透過 `useRuntimeConfig().public.adminDashboardEnabled` 取值，flag off 時整個連結不出現在 `UNavigationMenu`。
- [x] 4.2 對齊 Nuxt UI 樣式 props 與 admin 頁視覺一致性。
  - 2026-04-19 local PASS: 審視 `app/pages/admin/tokens/**`、`app/pages/admin/query-logs/**`、`app/pages/admin/dashboard/**` 與對應 `app/components/admin/**`；所有 `UButton / UBadge / UInput / USelect / UCard` 都明確寫出 `color` + `variant` + `size`（或透過 `:color` 綁定 config 物件，例如 `TokenStatusBadge` / `QueryLogStatusBadge`）。Dashboard 新增元件遵守相同慣例（`UButton color="neutral" variant="outline" size="md"` 等）。documents/ 頁面不在本 change scope，屬於其他 change，保持不動。
- [x] 4.3 補齊 token/log/dashboard 的 component / integration tests。
  - 2026-04-19 local PASS: 整合新增 `test/integration/admin-dashboard-summary-route.test.ts`（5 tests：401 / 403 / feature off 404 / aggregate response + redaction guarantee / auth-before-feature order）；單元新增 `test/unit/admin-dashboard-store.test.ts`（7 tests：isoDaysAgo × 2、count helpers × 3、trend、SQL redaction guarantee）+ `test/unit/admin-dashboard-ui.test.ts`（9 tests：bar 百分比 × 4、maxCount × 2、nav link 列表 × 3）。總計新增 21 tests。整套 `pnpm exec vp test run` 84 test files / 426 tests 0 失敗。

## 5. Design Review

- [x] 5.1 執行 `/design improve` 對 `app/pages/admin/tokens/**`、`app/pages/admin/query-logs/**`、`app/pages/admin/dashboard/**`、相關 components。
  - 2026-04-19 local PASS: 以 `.impeccable.md` 作為 anchor 做靜態 design review，產出 `openspec/changes/admin-ui-post-core/design-review.md`（含 Design Fidelity Report 段落，8/8 通過、0 DRIFT）。因 worktree 無 dev server，screenshot-based fidelity 留到 Phase 4。Surface inventory 覆蓋 tokens list / create modal / revoke confirm / badges、query-logs list + detail / badges、dashboard page / SummaryCard / QueryTrendList。
- [x] 5.2 修復所有 DRIFT 項目。
  - 2026-04-19 local PASS: Review 期間單一 finding = `SummaryCard.vue` 原用 `bg-primary/10 text-primary` 打破 empty-state icon-circle 的 `bg-muted text-default` 既定 convention；已 inline 改為 `bg-muted text-default`。修復後重掃 `grep -nE 'text-gray|dark:|text-black|text-white|bg-black|bg-white' app/**/admin/**` 0 matches，Fidelity 仍為 8/8。
- [x] 5.3 執行 `/audit` 並修正 Critical issues。
  - 2026-04-19 local PASS: 靜態 audit 涵蓋 accessibility（aria-label / aria-hidden / focus state / keyboard flow）、performance（v-for key 穩定、staleTime 合理）、theming（僅用 Nuxt UI 語意 token）、responsive（`md:grid-cols-3`、`flex-wrap`）、anti-patterns（0 `.skip`、0 `if/else` enum、0 `process.env`）。Critical = 0、Warning = 0。詳見 `design-review.md` `/audit — Technical Quality Findings` 段落。
- [ ] 5.4 執行 `/review-screenshot` 驗證 admin 後置頁面。
  - 2026-04-19 local **skip — 需 dev server + 人工驗收**: 依 worktree 分工，screenshot-based visual QA 與人工檢查清單走在主線 Phase 4（merge 回 main 之後由使用者驅動 `screenshot-review` agent）。worktree 內靜態 review 已在 §5.1–§5.3 完成並留下 `design-review.md`。

## 人工檢查

- [ ] #1 Admin 可建立 token 並只看到一次性明文 secret reveal。
- [ ] #2 Admin 可撤銷 token，列表正確顯示 revoked 狀態。
- [ ] #3 Admin 可篩選 query logs 並查看單筆詳情。
- [ ] #4 Query logs UI 不顯示未遮罩高風險原文。
- [ ] #5 dashboard flag 關閉時頁面與導覽不應對一般流程造成影響。
