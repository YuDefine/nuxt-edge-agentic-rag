# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-24 更新）：目前 branch `main`，`v0.31.0` deploy commit 與 tag 已建立；本輪文件 ingestion 擴充已完成發布與 spec 封存，專題報告與舊工具鏈資產維持在 `local/` 路徑。Open tech debt 現況：無 blocking 項。
>
> **最新進度**（2026-04-24）：
>
> - **Spectra / Claude workflow orchestration** 已完成一輪基礎設施刷新：新增 `.agent/skills/*` 與 `scripts/spectra-ux/*` claim / release / design-gate / reminder 流程，並同步更新 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、commit / handoff / roadmap / screenshot 規則。
> - **web chat persistence** 已完成 archive：conversation history refresh race、last-click-wins、stale restore、in-flight request 汙染等問題已修掉，並補齊 unit + Playwright evidence（`docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md`）。
> - **`passkey-first-link-google-custom-endpoint`** 已完成 archive：custom GET initiator / callback、`/account/settings` UI、spec sync、design-review、ui-audit 與 local / production 人工驗證皆已完成。
> - **`multi-format-document-ingestion`** 已完成 archive：Upload Wizard tier disclosure、canonical snapshot extractor、local upload fallback、rich-format validation 與對應測試皆已落地，並已建立 `v0.31.0` release tag。
> - **`standardize-chart-surfaces-on-nuxt-charts`** 已完成 archive：`/admin/usage` timeline 與 `/admin/debug/latency` outcome breakdown 已統一改為 `nuxt-charts` surface，`admin-usage-dashboard` / `latency-and-outcome-observability` specs 已同步，unit + Playwright + typecheck 與 local screenshot review evidence 皆已補齊。
> - **local auth storage drift** 已處理：`.data/db/sqlite.db` 與 local wrangler D1 已重建，`user_new` / `query_logs_new` 殘留 FK refs 已排除，`/_dev/login` 與 Google linking local flow 已恢復。
> - **`TD-014` integration test logger 初始化缺口** 已收斂：2026-04-24 本地重跑 `pnpm test:integration` 為 `72 files passed / 364 tests passed / 1 skipped`，目前不再阻擋 roadmap 清空。
> - **docs custom domain / app canary 人工判定缺口** 已補齊：2026-04-24 以外部網路直接檢查 `agentic.yudefine.com.tw`、`agentic-staging.yudefine.com.tw`、`agentic-docs.yudefine.com.tw`、`agentic-docs-staging.yudefine.com.tw`，四個 custom domain 皆回 `HTTP 200`，確認 GitHub runner 上的 `403` 屬 Cloudflare WAF / Bot protection 誤擋，而非站點異常。
> - **Workers AI 回答層 / web chat 真串流** 已完成 archive：相關 tasks 皆已完成，active / parked changes 目前清空。

## Next Moves

1. 目前沒有 active、parked 或 handoff 中的 Spectra change 需要繼續實作。
2. 下一輪工作若涉及產品行為變更，先走 `spectra-propose` / `spectra-apply`，避免直接在已封存 change 上追加需求。
3. 若準備發布目前工作樹，先完成對應測試、人工驗證與 commit 分組。

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-23T19:45:41.809Z_

_No active changes._

### Ready to apply

_(none)_

### In progress

_(none)_

### Draft

_(none)_

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

_(none)_

### Mutex (same spec touched)

_(none)_

### Blocked by dependency

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/parallelism -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parked -->

## Parked Changes

> 已 `spectra park` 的 changes。檔案暫時從 `openspec/changes/` 移出，
> metadata 保留在 `.spectra/spectra.db`。`spectra unpark <name>` 可取回。

1 parked change

- **collapsible-chat-history-sidebar** — 0/36 tasks (0%)
  - Summary: 目前 chat 頁面（`/`）在 `lg` 以上永遠強制顯示…

<!-- SPECTRA-UX:ROADMAP-AUTO:/parked -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

_(none — 2026-04-19 下午 8 個 parked change 全部 unpark 處理完畢：2 個刪除、1 對合併、5 個留作 active。)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
