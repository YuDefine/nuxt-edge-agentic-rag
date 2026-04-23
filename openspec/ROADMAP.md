# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-23 更新）：目前 branch `main`，最新 release 已到 `v0.28.12`。`reports/latest.md` 仍是 current report single source of truth，`reports/archive/` 保存版本化快照。Open tech debt 現況：TD-010 mid / TD-012 high / TD-014 mid。
>
> **最新進度**（2026-04-23）：
>
> - **專題報告治理 / 工作區重整** 已完成並入版：報告本體與 archive 目錄完成收斂，repo root 的歷史 `main-v*` 與舊 backup 已搬移，current report / archive 路徑規則已同步到 `AGENTS.md`、`CLAUDE.md`、`docs/STRUCTURE.md` 與 governance specs。
> - **文件站正式化 + Cloudflare Pages 流程** 已完成實作：README、docs landing / onboarding / verify / runbooks / specs index 已改寫為開發者導向文件；docs deploy 已整合進主 deploy workflow，並補上 custom domain sync 與 smoke test fallback。
> - **`oauth-user-delegated-remote-mcp`** 已完成 archive：delta specs 已同步回主 specs，remote MCP OAuth connector 正式進入 archive。
> - **passkey reauth / self-delete hotfix chain** 已在 production 收斂完成：`better-auth` / `@better-auth/passkey` 升至 `1.6.7`、`better-call` 鎖至 `1.3.5`，並經歷 safe logger、exact route、`auth.handler(new Request(...))` forwarding、`session.cookieCache.enabled = false` 等多輪 mitigation。最終 `v0.28.12` 以 Playwright virtual authenticator 重放 production full flow 已通過：passkey-first 註冊成功、`generate-authenticate-options` / `verify-authentication` / `account/delete` / `sign-out` 全為 `200`，且自刪後透過 hard redirect 正確回到 `/` 登入頁。
> - **`fk-cascade-repair-for-self-delete`** 的 production D1 closeout 已完成：latest tombstone `reason = 'self-deletion'` 保留，該 test user 的 `"user"` / `passkey` / `mcp_tokens` count 皆為 `0`，TD-011 已回填為 `done`。
> - **deploy 現況**：`v0.28.11` 與 `v0.28.12` app deploy 均成功；workflow 仍會因 docs custom domain sync 的 Cloudflare API `403 Authentication error` 顯示失敗，另外 GitHub runner 執行 smoke-test 時也會被 Cloudflare WAF/Bot protection 回 `403`，需以人工 canary 補判，但不影響 app production 站點實際上線。
> - **staging 環境真相已同步回 repo**：新增 `docs/decisions/2026-04-23-recognize-staging-as-active-environment.md` 作為新 decision，正式以 `local` / `staging` / `production` 三環境描述目前系統；`wrangler.staging.jsonc` 的 `NUXT_KNOWLEDGE_AI_GATEWAY_ID` 已修正為 `agentic-rag-staging`，deploy workflow 註解也不再把 staging 寫成 illustrative。
> - **verify / runbook 已完成 staging 對齊**：`ACCEPTANCE_RUNBOOK`、`CONVERSATION_LIFECYCLE_VERIFICATION`、`CONFIG_SNAPSHOT_VERIFICATION`、`RETENTION_*`、`rollout-checklist` 等文件現已以 `BASE_URL` / `DB_NAME` / `WRANGLER_CONFIG` 參數化，可直接切換 staging / production；debug surface / smoke / deploy checklists 也已承認 staging 為現有環境。
> - **既有 active changes** 目前共有 3 條：`drizzle-refactor-credentials-admin-members` 待收尾；`multi-format-document-ingestion` 與 `passkey-first-link-google-custom-endpoint` 在 `spectra list --json` 皆顯示為 `in-progress`，但因 tasks 仍為 `0/N`，`roadmap-sync` 的 auto stage 目前仍將兩者歸類為 `draft`。
> - **下一條主線候選** 目前有兩條：`passkey-first-link-google-custom-endpoint` 對應 high-priority `TD-012`、屬真實功能缺口；`multi-format-document-ingestion` 則是 demo / 文件 ingestion story 的下一條實作線。

## Next Moves

### 既有 active changes closeout

- [mid] `drizzle-refactor-credentials-admin-members`：完成 local / production `/account/settings` 與 `/admin/members` manual regression，並回填 TD-010 狀態

### Deploy follow-up

- [mid] 驗證 docs custom domains：`agentic-docs.yudefine.com.tw` 與 `agentic-docs-staging.yudefine.com.tw` 均可正常開啟，必要時檢查 Pages `pages.dev` fallback
- [mid] 對齊 staging / production admin allowlist：確認 Worker secret `ADMIN_EMAIL_ALLOWLIST` 與 GitHub Actions `PROD_ADMIN_EMAIL_ALLOWLIST` / `STAGING_ADMIN_EMAIL_ALLOWLIST` 沒有漂移
- [mid] 以 staging / production 各跑一次 canary，補齊 workflow smoke-test 因 Cloudflare WAF / Bot protection `403` 無法自動判斷的空缺

### 專題報告與下一條開發線

- [mid] 重新讀 `reports/latest.md`，把 demo 資料現況與缺口正式寫回報告正文
- [high] `drizzle-refactor-credentials-admin-members` 收尾後，預設優先啟動 `passkey-first-link-google-custom-endpoint`：custom OAuth link endpoint → callback state validation → account/settings UI 分流
- [mid] 若當前重點改為 demo / ingestion story，則改先做 `multi-format-document-ingestion`：shared format registry → canonical snapshot extractor → extraction-first sync orchestration

### Open tech debt / follow-ups

- [high] **TD-012** 實作 `passkey-first → link Google` 的 custom endpoint（better-auth `linkSocial` 不支援 email=NULL session）
- [mid] **TD-014** error-sanitizer 後 12 個 integration tests 拋 `evlog` logger not init — 獨立 follow-up

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-22T20:23:48.699Z_

3 active changes (0 ready · 1 in progress · 2 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **drizzle-refactor-credentials-admin-members** — 25/27 tasks (93%)
  - Specs: `admin-member-management-ui`, `auth-storage-consistency`, `passkey-authentication`, `responsive-and-a11y-foundation`

### Draft

- **multi-format-document-ingestion** — 0/21 tasks (0%)
  - Specs: `admin-document-management-ui`, `document-ingestion-and-publishing`
- **passkey-first-link-google-custom-endpoint** — 0/45 tasks (0%)
  - Specs: `auth-storage-consistency`, `passkey-authentication`

### Blocked

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

- `multi-format-document-ingestion`

### Mutex (same spec touched)

- **auth-storage-consistency** — conflict between: `drizzle-refactor-credentials-admin-members`, `passkey-first-link-google-custom-endpoint`
- **passkey-authentication** — conflict between: `drizzle-refactor-credentials-admin-members`, `passkey-first-link-google-custom-endpoint`

### Blocked by dependency

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/parallelism -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parked -->

## Parked Changes

> 已 `spectra park` 的 changes。檔案暫時從 `openspec/changes/` 移出，
> metadata 保留在 `.spectra/spectra.db`。`spectra unpark <name>` 可取回。

_No parked changes._

<!-- SPECTRA-UX:ROADMAP-AUTO:/parked -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

_(none — 2026-04-19 下午 8 個 parked change 全部 unpark 處理完畢：2 個刪除、1 對合併、5 個留作 active。)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
