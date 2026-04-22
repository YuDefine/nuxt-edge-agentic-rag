# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-22 更新）：目前 branch `main`，release 版本已升到 `v0.27.0`。本輪完成三條主線：專題報告治理與工作區重整、VitePress 開發者文件與 Cloudflare Pages 部署、Claude-first remote MCP OAuth connector。報告 current draft 仍以 `reports/latest.md` 作為單一本體；`reports/archive/` 保存版本化快照。Open tech debt：TD-009 mid / TD-010 mid / TD-011 high / TD-012 high / TD-014 mid。
>
> **最新進度**（2026-04-22）：
>
> - **專題報告治理 / 工作區重整** 已完成並入版：報告本體與 archive 目錄完成收斂，repo root 的歷史 `main-v*` 與舊 backup 已搬移，current report / archive 路徑規則已同步到 `AGENTS.md`、`CLAUDE.md`、`docs/STRUCTURE.md` 與 governance specs。
> - **文件站正式化 + Cloudflare Pages 流程** 已完成實作：README、docs landing / onboarding / verify / runbooks / specs index 已改寫為開發者導向文件；docs deploy 已整合進主 deploy workflow，並補上 custom domain sync 與 smoke test fallback。
> - **`oauth-user-delegated-remote-mcp`** 已完成 archive：delta specs 已同步回主 specs，remote MCP OAuth connector 正式進入 archive。
> - **既有 active changes** `fk-cascade-repair-for-self-delete` 與 `drizzle-refactor-credentials-admin-members` 仍在收尾階段，尚待 production manual closeout 與 tech debt 狀態回填。
> - **`multi-format-document-ingestion`** 已完成 proposal / design / tasks，現在由 `spectra` 標記為 `in-progress`，但尚未開始實作任務。

## Next Moves

### Release 驗證（本輪最高優先）

- [high] 監看本次 `main` push 與 `v0.27.0` tag 的 GitHub Actions，確認 app 與 docs 的 production / staging deploy 全綠
- [high] 驗證 docs custom domains：`agentic-docs.yudefine.com.tw` 與 `agentic-docs-staging.yudefine.com.tw` 均可正常開啟，必要時檢查 Pages `pages.dev` fallback

### 既有 active changes closeout

- [high] `fk-cascade-repair-for-self-delete`：production 以 passkey-only test user 實測自刪流程與 D1 tombstone / token cascade 複核，並回填 TD-011 狀態
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

_last synced: 2026-04-22T13:12:00+08:00_

3 active changes (0 ready · 3 in progress · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **drizzle-refactor-credentials-admin-members** — 22/27 tasks (81%)
  - Specs: `admin-member-management-ui`, `auth-storage-consistency`, `passkey-authentication`, `responsive-and-a11y-foundation`
- **fk-cascade-repair-for-self-delete** — 41/44 tasks (93%)
  - Specs: `auth-storage-consistency`, `member-and-permission-model`, `passkey-authentication`
- **multi-format-document-ingestion** — 0/21 tasks (0%)
  - Specs: `admin-document-management-ui`, `document-ingestion-and-publishing`

### Blocked

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

- `multi-format-document-ingestion`
- `drizzle-refactor-credentials-admin-members`

### Mutex (same spec touched)

- **auth-storage-consistency** — conflict between: `drizzle-refactor-credentials-admin-members`, `fk-cascade-repair-for-self-delete`
- **passkey-authentication** — conflict between: `drizzle-refactor-credentials-admin-members`, `fk-cascade-repair-for-self-delete`

### Blocked by dependency

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/parallelism -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parked -->

## Parked Changes

> 已 `spectra park` 的 changes。檔案暫時從 `openspec/changes/` 移出，
> metadata 保留在 `.spectra/spectra.db`。`spectra unpark <name>` 可取回。

1 parked change

- **passkey-first-link-google-custom-endpoint** — 0/45 tasks (0%)
  - Summary: passkey-first 使用者（`user.email …

<!-- SPECTRA-UX:ROADMAP-AUTO:/parked -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

_(none — 2026-04-19 下午 8 個 parked change 全部 unpark 處理完畢：2 個刪除、1 對合併、5 個留作 active。)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
