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

- [ ] 1.1 建立 `/admin/tokens` 路由與 page guard。
- [ ] 1.2 建立 token list data loader，顯示 label、scopes、status、expires_at、last_used_at。
- [ ] 1.3 建立 token scopes 顯示元件與 status badges。
- [ ] 1.4 建立 token create form，支援 label、scope 選擇、到期設定。
- [ ] 1.5 實作 create success state，僅一次性 reveal 明文 token。
- [ ] 1.6 建立 revoke action 與確認流程。
- [ ] 1.7 補齊 token list empty / loading / error 狀態。
- [ ] 1.8 驗證非 Admin 不可進入 token 管理 UI。

## 2. Admin Query Log UI

- [ ] 2.1 建立 `/admin/query-logs` 列表頁。
- [ ] 2.2 建立 channel、outcome、query_type、redaction 狀態篩選 controls。
- [ ] 2.3 建立 redaction-safe log row 元件。
- [ ] 2.4 補齊 list empty / loading / error 狀態。
- [ ] 2.5 建立 `/admin/query-logs/[id]` 詳情頁。
- [ ] 2.6 在詳情頁顯示 request outcome、decision path、risk flags、config snapshot version。
- [ ] 2.7 確保詳情頁不顯示未遮罩原文與禁止欄位。
- [ ] 2.8 補齊 log UI 的 auth guard 與 unauthorized state。

## 3. Admin Summary Dashboard

- [ ] 3.1 建立 `/admin/dashboard` route 與 feature gate。
- [ ] 3.2 建立 summary cards：documents、queries、tokens。
- [ ] 3.3 建立粗粒度趨勢或狀態摘要，不暴露 raw rows。
- [ ] 3.4 在 feature flag 關閉時隱藏或阻擋 dashboard 導覽與 route。
- [ ] 3.5 補齊 dashboard empty / loading / error 狀態。

## 4. Shared Admin UI Polish

- [ ] 4.1 整合 admin 導覽，補上 tokens、query logs、dashboard 入口。
- [ ] 4.2 對齊 Nuxt UI 樣式 props 與 admin 頁視覺一致性。
- [ ] 4.3 補齊 token/log/dashboard 的 component / integration tests。

## 5. Design Review

- [ ] 5.1 執行 `/design improve` 對 `app/pages/admin/tokens/**`、`app/pages/admin/query-logs/**`、`app/pages/admin/dashboard/**`、相關 components。
- [ ] 5.2 修復所有 DRIFT 項目。
- [ ] 5.3 執行 `/audit` 並修正 Critical issues。
- [ ] 5.4 執行 `/review-screenshot` 驗證 admin 後置頁面。

## 人工檢查

- [ ] #1 Admin 可建立 token 並只看到一次性明文 secret reveal。
- [ ] #2 Admin 可撤銷 token，列表正確顯示 revoked 狀態。
- [ ] #3 Admin 可篩選 query logs 並查看單筆詳情。
- [ ] #4 Query logs UI 不顯示未遮罩高風險原文。
- [ ] #5 dashboard flag 關閉時頁面與導覽不應對一般流程造成影響。
