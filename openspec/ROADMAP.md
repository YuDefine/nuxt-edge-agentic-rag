# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-23 更新）：目前 branch `main`，`package.json` 已升到 `v0.29.0`，但 deploy commit / tag 尚未建立，所以最新已發布 release 仍是 `v0.28.13`。專題報告與舊工具鏈資產已移到 `local/`，repo root 不再保留歷史 `reports/` / `tooling/` 路徑。Open tech debt 現況：TD-014 mid。
>
> **最新進度**（2026-04-23）：
>
> - **Spectra / Claude workflow orchestration** 已完成一輪基礎設施刷新：新增 `.agent/skills/*` 與 `scripts/spectra-ux/*` claim / release / design-gate / reminder 流程，並同步更新 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、commit / handoff / roadmap / screenshot 規則。
> - **web chat persistence** 已完成 archive：conversation history refresh race、last-click-wins、stale restore、in-flight request 汙染等問題已修掉，並補齊 unit + Playwright evidence（`docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md`）。
> - **`passkey-first-link-google-custom-endpoint`** 已完成 archive：custom GET initiator / callback、`/account/settings` UI、spec sync、design-review、ui-audit 與 local / production 人工驗證皆已完成。
> - **本輪手動驗證結果**：在 `http://localhost:3000` 的真實 member session 下，conversation history 列表已可正常 render，切換對話會載入內容，刪除也會同步更新畫面；原先 `/api/conversations` `500` blocker 已排除。
> - **local auth storage drift** 已處理：`.data/db/sqlite.db` 與 local wrangler D1 已重建，`user_new` / `query_logs_new` 殘留 FK refs 已排除，`/_dev/login` 與 Google linking local flow 已恢復。
> - **既有 active changes** 目前剩 2 條：`drizzle-refactor-credentials-admin-members` 已補齊 closeout evidence、待 archive；`multi-format-document-ingestion` 尚未開始，可獨立並行。

## Next Moves

- [mid] archive `drizzle-refactor-credentials-admin-members`，把 closeout 已完成的 change 從 active queue 移出
- [mid] 驗證 docs custom domains 與 staging / production canary，補齊 workflow smoke-test 被 Cloudflare WAF / Bot protection `403` 擋住的人工判定缺口 — 依賴：deploy 後環境
- [mid] 若 auth 線 closeout 完成，啟動 `multi-format-document-ingestion`：shared format registry → canonical snapshot extractor → extraction-first sync orchestration — 獨立

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-23T14:30:00.921Z_

1 active change (0 ready · 0 in progress · 1 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

_(none)_

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

_(none)_

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
