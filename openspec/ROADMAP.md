# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-25 更新）：目前 branch `main`，`v0.43.3` tag 已推送；v0.43.0 / v0.43.1 / v0.43.2 / v0.43.3 connected to staging + production deploy / docs / smoke / notify 全綠。Production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` 已翻為 `true`（commit `bc85403`），`wire-do-tool-dispatch` 進入 production soak 階段。Open tech debt 現況：無 build/deploy blocker，但 wire-do-tool-dispatch rollout 仍有 TD-030 / TD-041 / TD-050 三項需在 archive 前驗證。
>
> **最新進度**（2026-04-25）：
>
> - **`consolidate-conversation-history-config`** 已完成 archive：抽出 `createChatConversationHistory` factory，把 `index.vue` + `ConversationHistory` 的雙份 config / refresh 邏輯收斂；`/api/chat` 路徑修復連串本地 bootstrap 斷點（TD-046 done — staging AutoRAG index 已建立）。人工檢查中發現 TD-044 / TD-045 / TD-047 / TD-048 / TD-050 並登記在 register。
> - **v0.43.0 → v0.43.3 連續 release**：v0.43.0 收 wire-do-tool-dispatch staging protocol 驗證 + DO debug instrumentation；v0.43.1 補 docs vitepress yaml escape；v0.43.2 修 `reflect-metadata` polyfill 洩漏 Nitro bundle module scope；v0.43.3 把 production MCP session flag 翻 true 並收尾 TD-045 narrow scope（`predev` bootstrap health check）。
> - **`wire-do-tool-dispatch` §7.1 已收斂**：staging v0.42.2 protocol 驗證完成，DO debug instrumentation 已回滾。剩 production soak（flag=true 後）+ Claude.ai 端到端實測（TD-030）+ DO tool dispatch flag=true 假 ack（TD-041）+ staging R2 RAG seed（TD-050）。
> - **`add-mcp-tool-selection-evals`** 已於 2026-04-25 完成 archive：eval harness、dataset、scorer、文件、dev token CLI、bearer-token client wiring、baseline 與 manual review 皆已落地；`mcp-tool-selection-evals` spec 已同步到主規格。
>
> **2026-04-24 收斂項目（保留歷史視野）**：
>
> - **Spectra / Claude workflow orchestration**：新增 `.agent/skills/*` 與 `scripts/spectra-ux/*` claim / release / design-gate / reminder 流程，同步 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、commit / handoff / roadmap / screenshot 規則。
> - **web chat persistence** archive：conversation history refresh race、last-click-wins、stale restore、in-flight request 汙染等已修，補齊 unit + Playwright evidence（`docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md`）。
> - **`passkey-first-link-google-custom-endpoint`** archive：custom GET initiator / callback、`/account/settings` UI、spec sync、design-review、ui-audit 與 local / production 人工驗證皆完成。
> - **`multi-format-document-ingestion`** archive：Upload Wizard tier disclosure、canonical snapshot extractor、local upload fallback、rich-format validation 已落地（v0.31.0）。
> - **`standardize-chart-surfaces-on-nuxt-charts`** archive：`/admin/usage` timeline 與 `/admin/debug/latency` outcome breakdown 統一改為 `nuxt-charts` surface。
> - **`TD-014` integration test logger 初始化缺口** 收斂：本地重跑 `pnpm test:integration` 為 `72 files / 364 tests / 1 skipped`。
> - **Delete account Google reauth 修復** archive：Google reauth 跨 redirect resume、passkey-only regression、`?open-delete=1` bypass 防護與 OAuth cancel case 已驗證。
> - **MCP Durable Object 工作線拆分**：`upgrade-mcp-to-durable-objects` 保留 session lifecycle scope；`wire-do-tool-dispatch` 從 parked 進入 active，負責 DO 內 tool dispatch、auth context HMAC forward 與 production flag rollout。
> - **Workers AI 回答層 / web chat 真串流** archive。

## Next Moves

進行中：

- **`upgrade-mcp-to-durable-objects`** 17/27 tasks (63%)，**Phase 4 scope 縮為 session lifecycle only** — tool dispatch 改由 `wire-do-tool-dispatch` 接手（見 TD-041）；production flag 已翻 true（v0.43.3），剩 session lifecycle 收尾與 archive gate
- **`wire-do-tool-dispatch`** 18/24 tasks (75%) — 依賴：archive 前必須處理 TD-030（Claude.ai re-init 循環）、TD-041（DO tool dispatch flag=true 假 ack）、TD-050（staging R2 RAG content seed）；§7.1 staging protocol 驗證已完成，剩 production soak + Claude.ai 端到端實測 + 人工檢查

### 已 propose，待 apply（見 AUTO Parked Changes 區塊）

_(none)_

### 近期（尚未 propose，可與 DO change 並行）

- [high] **TD-048** 聊天 UI 缺顯式「新對話」入口 — 使用者反映「找不到新對話按鈕、reload 始終停在同個對話」，影響日常 chat UX；獨立、scope 小
- [mid] **TD-050** Staging R2 (`agentic-rag-documents-staging`) 為空，缺 RAG content seed / sync schedule — 依賴：與 `wire-do-tool-dispatch` archive 一併處理（驗證 4 個 tool call `citations:[] / results:[]` empty 是否因 R2 缺資料導致）
- [mid] **TD-049** Cloudflare Pages deploy API 拒絕 git HEAD commit message — in-progress（CI 已加 workaround `5ce334c`），持續觀察是否仍有 deploy 中斷
- [mid] **TD-044** `session.create.before` 靜默吞 user_profiles UNIQUE 衝突 → better-auth user id 與 user_profiles.id 可能漂移 — 獨立
- [mid] **TD-047** `/api/chat` SSE `ready` 後階段 error 時 Container 未 emit `conversation-persisted` — 獨立、scope 小
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
