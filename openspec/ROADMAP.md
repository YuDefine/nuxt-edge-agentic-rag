# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-24 更新）：目前 branch `main`，`v0.42.0` tag 已推送；staging 與 production deploy / docs / smoke / notify 皆已綠燈。Open tech debt 現況：無 blocking 項，但 MCP Durable Object rollout 仍需依 feature flag 分階段驗證。
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
> - **Delete account Google reauth 修復**已完成 archive：Google reauth 跨 redirect resume、passkey-only regression、直接輸入 `?open-delete=1` bypass 防護與 OAuth cancel case 皆已完成驗證。
> - **MCP Durable Object 工作線已拆分完成**：`upgrade-mcp-to-durable-objects` 保留 session lifecycle scope；`wire-do-tool-dispatch` 已從 parked 進入 active，負責 DO 內 tool dispatch、auth context HMAC forward 與 production flag rollout。
> - **`add-mcp-tool-selection-evals`** 已於 2026-04-25 完成 archive：eval harness、dataset、scorer、文件、dev token CLI、bearer-token client wiring、baseline 與 manual review 皆已落地；`mcp-tool-selection-evals` spec 已同步到主規格。
> - **`v0.42.0` release** 已完成：main push run `24898590937` staging 綠燈；tag run `24898814022` production 綠燈。Production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` 仍維持 false，等待 `wire-do-tool-dispatch` soak 完成後再 flip。
> - **Workers AI 回答層 / web chat 真串流** 已完成 archive：相關 tasks 皆已完成，後續焦點轉往 MCP session/tool dispatch 與 eval baseline。

## Next Moves

進行中：

- **`upgrade-mcp-to-durable-objects`** 17/27 tasks (63%)，**Phase 4 scope 縮為 session lifecycle only** — tool dispatch 改由 `wire-do-tool-dispatch` 接手（見 TD-041）；production flag 維持 false 直到 wire-do-tool-dispatch archive
- **`wire-do-tool-dispatch`** 17/24 tasks (71%)，DO 內 McpServer lazy init + 4 tool dispatch + auth context forward 已完成並隨 `v0.42.0` 部署；剩 staging / production rollout 與人工檢查

### 已 propose，待 apply（見 AUTO Parked Changes 區塊）

_(none)_

### 近期（尚未 propose，可與 DO change 並行）

- [mid] **TD-009** `user_profiles.email_normalized` nullable migration — 獨立（scope 非小：rebuild `user_profiles` + 4 FK children，約 700+ 行 SQL + data migration）
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

_last synced: 2026-04-24T21:53:11.946Z_

2 active changes (0 ready · 2 in progress · 0 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **upgrade-mcp-to-durable-objects** — 17/27 tasks (63%)
  - Specs: `mcp-knowledge-tools`
- **wire-do-tool-dispatch** — 18/24 tasks (75%)
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

1 claim (1 active · 0 stale)

### Live Ownership

- **wire-do-tool-dispatch** — unknown:charles@charlesdeMac-mini.local (unknown)
  - Accepted from: manual
  - Last heartbeat: 2026-04-24T21:40:40.377Z
  - Note: 接手抓 handler throw stack，v0.43.1 debug instrumentation 已上 production

### Stale Claims

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/claims -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

_(none)_

### Mutex (same spec touched)

- **mcp-knowledge-tools** — conflict between: `upgrade-mcp-to-durable-objects`, `wire-do-tool-dispatch`

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
