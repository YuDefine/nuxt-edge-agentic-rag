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

進行中：

- **`upgrade-mcp-to-durable-objects`** 17/27 tasks (63%)，**Phase 4 scope 縮為 session lifecycle only** — tool dispatch 改由 `wire-do-tool-dispatch` 接手（見 TD-041）；production flag 維持 false 直到 wire-do-tool-dispatch archive
- **`fix-delete-account-dialog-google-reauth`** 6/15 tasks (40%)，實作已啟動但尚未 archive
- **`add-mcp-tool-selection-evals`** 4/19 tasks (21%)，eval harness 實作已啟動但尚未 archive

### 已 propose，待 apply（見 AUTO Parked Changes 區塊）

- [high] **`enhance-mcp-tool-metadata`** — 4 MCP tool 的 `.describe()` / `annotations` / `inputExamples`（Tier 1）；`/spectra-apply` 會自動 unpark
- [high] **`wire-do-tool-dispatch`** — DO 內 McpServer lazy init + `DoJsonRpcTransport.dispatch` + auth context HMAC forward（Tier 3，@followup[TD-041]）；依賴 `upgrade-mcp-to-durable-objects` session lifecycle 層；解決 TD-030 剩餘部分；production flag flip true 屬此 change rollout 範圍

### 近期（尚未 propose，可與 DO change 並行）

- [low] **`assert-never` util 收斂** — `app/utils/assert-never.ts` 與 `shared/utils/assert-never.ts` 重複，typecheck 有 WARN — 獨立
- [low] **TD-009** `user_profiles.email_normalized` nullable migration — 獨立
- [low] **TD-026** conversation owner-fallback 重複 config 收斂 — 獨立
- [low] **日期格式 smoke（遺留）** — `/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認

### 中期（合併評估）

- [mid] **TD-015 + TD-019 + TD-016 SSE 合併處理**

### 長期（等 DO change archive 後）

- [high] **TD-027** MCP connector first-time auth — 依賴：`upgrade-mcp-to-durable-objects` 完成後一併實測
- [mid] **`discuss-mcp-resource-layer`** — 依賴：DO archive；避免 `server/mcp/` 結構兩邊動
- [low] **`discuss-mcp-elicitation-for-ask`** — 互斥：DO change Non-Goals 明確排除 prompt/elicitation/sampling，MUST 等 archive 後才能 propose
- [low] **`discuss-mcp-async-context-refactor`** — 依賴：DO archive + production flag 全開一個 sprint；Tier 3 高風險，discuss 階段需驗證 asyncContext 與 CF Workers runtime 相容性；**supersedes** `integrate-mcp-logger-notifications`（原本 HANDOFF 標「獨立」誤判；實證 `@nuxtjs/mcp-toolkit@0.14.0` 的 `useMcpLogger` + `useMcpServer` 皆硬性要求 `nitro.experimental.asyncContext: true`，`logger.js` 以 `useEvent()` 取 request、`useMcpServer()` 取 SDK server handle，本專案目前走自寫 `getCurrentMcpEvent()` 繞過 asyncContext，不相容）；若要保 notify channel 便利性但不動 asyncContext，另一路是改用 SDK 原生 `extra.sendNotification()` 手寫 tag，但失去 toolkit 自帶 `mcp.tool` / `mcp.session_id` 聚合

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-24T14:17:52.090Z_

3 active changes (0 ready · 3 in progress · 0 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **add-mcp-tool-selection-evals** — 4/19 tasks (21%)
- **fix-delete-account-dialog-google-reauth** — 6/15 tasks (40%)
  - Specs: `passkey-authentication`
- **upgrade-mcp-to-durable-objects** — 17/27 tasks (63%)
  - Specs: `mcp-knowledge-tools`

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

- `add-mcp-tool-selection-evals`
- `fix-delete-account-dialog-google-reauth`
- `upgrade-mcp-to-durable-objects`

### Mutex (same spec touched)

_(none)_

### Blocked by dependency

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/parallelism -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parked -->

## Parked Changes

> 已 `spectra park` 的 changes。檔案暫時從 `openspec/changes/` 移出，
> metadata 保留在 `.spectra/spectra.db`。`spectra unpark <name>` 可取回。

2 parked changes

- **enhance-mcp-tool-metadata** — 0/14 tasks (0%)
  - Summary: 本專案是 Agentic RAG，MCP client（Cl…
- **wire-do-tool-dispatch** — 0/24 tasks (0%)
  - Summary: `upgrade-mcp-to-durable-object…

<!-- SPECTRA-UX:ROADMAP-AUTO:/parked -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

_(none — 2026-04-19 下午 8 個 parked change 全部 unpark 處理完畢：2 個刪除、1 對合併、5 個留作 active。)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
