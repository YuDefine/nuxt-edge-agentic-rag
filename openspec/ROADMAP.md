# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-23 更新）：目前 branch `main`，`package.json` 已升到 `v0.29.0`，但 deploy commit / tag 尚未建立，所以最新已發布 release 仍是 `v0.28.13`。專題報告與舊工具鏈資產已移到 `local/`，repo root 不再保留歷史 `reports/` / `tooling/` 路徑。Open tech debt 現況：TD-010 mid / TD-012 high / TD-014 mid。
>
> **最新進度**（2026-04-23）：
>
> - **Spectra / Claude workflow orchestration** 已完成一輪基礎設施刷新：新增 `.agent/skills/*` 與 `scripts/spectra-ux/*` claim / release / design-gate / reminder 流程，並同步更新 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、commit / handoff / roadmap / screenshot 規則。
> - **web chat persistence** 已完成 archive：conversation history refresh race、last-click-wins、stale restore、in-flight request 汙染等問題已修掉，並補齊 unit + Playwright evidence（`docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md`）。
> - **`passkey-first-link-google-custom-endpoint`** 已推進到 38/45 tasks：custom GET initiator / callback、`/account/settings` UI、spec / design-review / ui-audit / regression tests 都已落地。
> - **本輪手動驗證結果**：在 `http://localhost:3000` 的真實 member session 下，conversation history 列表已可正常 render，切換對話會載入內容，刪除也會同步更新畫面；原先 `/api/conversations` `500` blocker 已排除。
> - **仍待收斂的 local 環境問題**：`.data/db/sqlite.db` 跑 `verify-auth-storage-consistency.sh --local` 仍失敗，`account` / `session` 等表殘留 `*_new` FK refs，導致 `/api/_dev/login` 無法替新測試帳號建立 credential account。這是下一手最需要處理的 local drift。
> - **既有 active changes** 目前仍是 3 條：`drizzle-refactor-credentials-admin-members` 待 manual regression closeout；`passkey-first-link-google-custom-endpoint` 待最終 UI evidence / archive；`multi-format-document-ingestion` 尚未開始，可獨立並行。

## Next Moves

- [high] 完成 `passkey-first-link-google-custom-endpoint` closeout：在 `http://localhost:3000` 補齊 screenshot review 的 in-flight 鎖定證據，然後 archive change — 依賴：既有 local admin/member session / 互斥：`drizzle-refactor-credentials-admin-members`
- [high] 修復或重建 `.data/db/sqlite.db` 的 auth-storage drift，讓 `bash scripts/checks/verify-auth-storage-consistency.sh --local .data/db/sqlite.db` 轉綠並恢復 `/api/_dev/login` 新建帳號 — 依賴：`auth-storage-consistency` / 互斥：`drizzle-refactor-credentials-admin-members`
- [mid] 完成 `drizzle-refactor-credentials-admin-members` 的 `/account/settings` 與 `/admin/members` manual regression，回填 TD-010，再決定是否 archive — 依賴：production admin 驗證路徑
- [mid] 驗證 docs custom domains 與 staging / production canary，補齊 workflow smoke-test 被 Cloudflare WAF / Bot protection `403` 擋住的人工判定缺口 — 依賴：deploy 後環境
- [mid] 若 auth 線 closeout 完成，啟動 `multi-format-document-ingestion`：shared format registry → canonical snapshot extractor → extraction-first sync orchestration — 獨立

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-23T09:31:50.124Z_

3 active changes (0 ready · 2 in progress · 1 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **drizzle-refactor-credentials-admin-members** — 25/27 tasks (93%)
  - Specs: `admin-member-management-ui`, `auth-storage-consistency`, `passkey-authentication`, `responsive-and-a11y-foundation`
- **passkey-first-link-google-custom-endpoint** — 38/45 tasks (84%)
  - Specs: `auth-storage-consistency`, `passkey-authentication`

### Draft

- **multi-format-document-ingestion** — 0/21 tasks (0%)
  - Specs: `admin-document-management-ui`, `document-ingestion-and-publishing`

### Blocked

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->

<!-- SPECTRA-UX:ROADMAP-AUTO:claims -->

## Active Claims

> 即時 ownership 由 `.spectra/claims/*.json` 提供。
> 接手 handoff / 開始做 change 時，先 claim，再移除 `HANDOFF.md` 對應項目。

_No active claims._

> 若你要開始做上面的 active change，先跑 `spectra:claim -- <change>`。

<!-- SPECTRA-UX:ROADMAP-AUTO:/claims -->

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
