# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-22 更新）：目前 branch `main`，release 版本已升到 `v0.28.1`。本輪已完成專題報告治理、文件站部署、remote MCP OAuth connector archive，以及 production passkey reauth hotfix commit；報告 current draft 仍以 `reports/latest.md` 作為單一本體，`reports/archive/` 保存版本化快照。Open tech debt：TD-009 mid / TD-010 mid / TD-011 high / TD-012 high / TD-014 mid。
>
> **最新進度**（2026-04-22）：
>
> - **專題報告治理 / 工作區重整** 已完成並入版：報告本體與 archive 目錄完成收斂，repo root 的歷史 `main-v*` 與舊 backup 已搬移，current report / archive 路徑規則已同步到 `AGENTS.md`、`CLAUDE.md`、`docs/STRUCTURE.md` 與 governance specs。
> - **文件站正式化 + Cloudflare Pages 流程** 已完成實作：README、docs landing / onboarding / verify / runbooks / specs index 已改寫為開發者導向文件；docs deploy 已整合進主 deploy workflow，並補上 custom domain sync 與 smoke test fallback。
> - **`oauth-user-delegated-remote-mcp`** 已完成 archive：delta specs 已同步回主 specs，remote MCP OAuth connector 正式進入 archive。
> - **passkey reauth hotfix** 已於 `v0.28.1` commit：`better-auth` / `@better-auth/passkey` 升至 `1.6.7`、`better-call` 鎖至 `1.3.5`、`vite` / `vitest` 對齊 `0.1.19`，並新增 `verify-authentication` endpoint-level regression test；但 production live 驗證仍待 redeploy 後完成。
> - **既有 active changes** `fk-cascade-repair-for-self-delete` 與 `drizzle-refactor-credentials-admin-members` 仍在收尾階段，尚待 production manual closeout 與 tech debt 狀態回填。
> - **`multi-format-document-ingestion`** 已完成 proposal / design / tasks，現在由 `spectra` 標記為 `in-progress`，但尚未開始實作任務。

## Next Moves

### Release 驗證（本輪最高優先）

- [high] 監看本次 `main` push 與 `v0.28.1` tag 的 GitHub Actions，確認 app 與 docs 的 production / staging deploy 全綠
- [high] redeploy 完成後重驗 production `POST /api/auth/passkey/verify-authentication`，確認 passkey reauth hotfix 不再出現 `a14.ownKeys...` 500
- [mid] 驗證 docs custom domains：`agentic-docs.yudefine.com.tw` 與 `agentic-docs-staging.yudefine.com.tw` 均可正常開啟，必要時檢查 Pages `pages.dev` fallback

### 既有 active changes closeout

- [high] `fk-cascade-repair-for-self-delete`：production 以 passkey-only test user 實測自刪流程、確認 D1 tombstone / token cascade，完成 8.5 / 8.6 / 8.7 並回填 TD-011 狀態
- [mid] `drizzle-refactor-credentials-admin-members`：完成 local / production `/account/settings` 與 `/admin/members` manual regression，並回填 TD-010 狀態

### 專題報告與下一條開發線

- [mid] 重新讀 `reports/latest.md`，把 demo 資料現況與缺口正式寫回報告正文
- [mid] 等既有 active changes 收尾後，再開 `multi-format-document-ingestion`：shared format registry → canonical snapshot extractor → extraction-first sync orchestration

### Open tech debt / follow-ups

- [high] **TD-012** 實作 `passkey-first → link Google` 的 custom endpoint（better-auth `linkSocial` 不支援 email=NULL session）
- [mid] **TD-014** error-sanitizer 後 12 個 integration tests 拋 `evlog` logger not init — 獨立 follow-up
- [mid] **TD-009** `passkey-user-profiles-nullable-email` 仍與 TD-011 migration 鏈互斥，暫不並行

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-22T16:19:01.835Z_

4 active changes (0 ready · 2 in progress · 2 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **drizzle-refactor-credentials-admin-members** — 25/27 tasks (93%)
  - Specs: `admin-member-management-ui`, `auth-storage-consistency`, `passkey-authentication`, `responsive-and-a11y-foundation`
- **fk-cascade-repair-for-self-delete** — 41/44 tasks (93%)
  - Specs: `auth-storage-consistency`, `member-and-permission-model`, `passkey-authentication`

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

- **auth-storage-consistency** — conflict between: `drizzle-refactor-credentials-admin-members`, `fk-cascade-repair-for-self-delete`, `passkey-first-link-google-custom-endpoint`
- **passkey-authentication** — conflict between: `drizzle-refactor-credentials-admin-members`, `fk-cascade-repair-for-self-delete`, `passkey-first-link-google-custom-endpoint`

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
