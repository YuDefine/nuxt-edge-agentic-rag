# Handoff

## In Progress

- [ ] `drizzle-refactor-credentials-admin-members` 仍未 archive；`tasks.md` 目前 25/27，剩 production regression（7.3）與 `docs/tech-debt.md` TD-010 狀態回填（7.5）
- [ ] `multi-format-document-ingestion` 目前由 `spectra list --json` 標記為 `in-progress`，但 `tasks.md` 仍是 0/21；proposal / design / tasks 已齊，尚未開始實作，可獨立並行
- [ ] `passkey-first-link-google-custom-endpoint` 目前也由 `spectra list --json` 標記為 `in-progress`，但 `tasks.md` 仍是 0/45；對應高優先 TD-012，尚未開始實作

## Completed This Round

- 已完成 commit / release：`54f0104`（移除 Stop hook 並保留相容 shim）、`aa8f933`（修正 admin allowlist build-time / runtime 漂移）、`7a8de37`（同步 staging 環境與驗證文件）、`a2a3f74`（deploy `v0.28.13`），tag `v0.28.13` 已推送
- 已修正 staging 真設定錯配：`wrangler.staging.jsonc` 的 `NUXT_KNOWLEDGE_AI_GATEWAY_ID` 改為 `agentic-rag-staging`，與 `.github/workflows/deploy.yml` 的 `Build (staging)` env 對齊
- 已新增 `test/unit/deploy-workflow-config.test.ts`，鎖住 staging deploy path 與 staging AI gateway / environment 設定，並驗證 production / staging build env 都有 `ADMIN_EMAIL_ALLOWLIST`
- 已同步 `docs/verify/` 主流程文件：`ACCEPTANCE_RUNBOOK`、`CONVERSATION_LIFECYCLE_VERIFICATION`、`CONFIG_SNAPSHOT_VERIFICATION`、`RETENTION_*`、`rollout-checklist`、`KNOWLEDGE_SMOKE`、`DEBUG_SURFACE_VERIFICATION`、`DEPLOYMENT_RUNBOOK`、`production-deploy-checklist` 現已承認 staging 為現有環境，且多數通用命令已改成 `BASE_URL` / `DB_NAME` / `WRANGLER_CONFIG` 參數化
- 已新增 decision [docs/decisions/2026-04-23-recognize-staging-as-active-environment.md](/Users/charles/offline/yuntech-project/repo/nuxt-edge-agentic-rag/docs/decisions/2026-04-23-recognize-staging-as-active-environment.md:1)，正式 supersede `2026-04-19-collapse-environments-to-local-and-production.md`；`admin-token-management-ui`、`admin-query-log-ui`、`admin-observability-dashboard` 三份 spec 的 decision reference 已改指向新檔

## Blocked

- `drizzle-refactor-credentials-admin-members` task 7.3 屬 `## 人工檢查` 區塊，依 `.claude/rules/manual-review.md` 不能自行勾選；需要 production `/account/settings` 與 `/admin/members` 的截圖／實測證據 + 使用者確認
- 若要恢復 `charles.yudefine@gmail.com` 的 admin 權限，需由 operator 更新 production `ADMIN_EMAIL_ALLOWLIST` secret，然後重新登入；Cloudflare `secret list` 無法回傳明文值，只能確認 secret 名稱存在
- 需由 operator 實際把 GitHub Actions secret `PROD_ADMIN_EMAIL_ALLOWLIST` / `STAGING_ADMIN_EMAIL_ALLOWLIST` 與各自 Worker secret `ADMIN_EMAIL_ALLOWLIST` 同步成同一份名單，否則 build-time / runtime 仍可能漂移
- workflow 自動 smoke-test 仍會被 Cloudflare WAF / Bot protection 擋成 `403`；production / staging 站點健康仍需人工 canary 補判

## Next Steps

1. 由 operator 同步 production `ADMIN_EMAIL_ALLOWLIST`（Worker secret）與 `PROD_ADMIN_EMAIL_ALLOWLIST`（GitHub Actions secret）；若 staging 也要驗，連同 `STAGING_ADMIN_EMAIL_ALLOWLIST` 一起同步
2. 重新 deploy production（必要時 staging 一併 deploy），並重新登入 `charles.yudefine@gmail.com` 驗證是否回到 admin
3. 取得可用的已登入 production admin profile
4. 用該 profile 對 production `/account/settings` 與 `/admin/members` 跑 manual regression，蒐集 `drizzle-refactor-credentials-admin-members` task 7.3 證據
5. 若使用者確認 task 7.3 通過，再回填 `docs/tech-debt.md` 的 TD-010 狀態並完成 change archive
6. `drizzle-refactor-credentials-admin-members` archive 後，預設轉做 `passkey-first-link-google-custom-endpoint`

## Current Recommendation

- 文件與 staging 真相來源這輪已同步完成；現在最短路徑是先解 production admin allowlist / manual regression，把 `drizzle-refactor-credentials-admin-members` 收掉
- 下一條主線預設建議優先 `passkey-first-link-google-custom-endpoint`，因為 TD-012 是 high priority 且屬真實功能缺口；若當前重點改成 demo / ingestion story，再改做 `multi-format-document-ingestion`
