# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-25 更新）：目前 branch `main`，`v0.43.3` tag 已推送但**production flip true 實測失敗**；正在執行 **v0.43.4 stop-gap rollback**（`NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` → `false`）以回到 v0.42.x stateless behavior。`wire-do-tool-dispatch` §7.1 退回 in-progress、scope 擴張納入 §5.x SSE Tests。Open tech debt 現況：無 build/deploy blocker，但 wire-do-tool-dispatch archive 前需收斂 §5.x（4 個 SSE integration test）+ §6.x + §7.1 升級 acceptance + §7.2 production flip 重做 + §7.3 7 天觀察 + §8.x 人工檢查。
>
> **最新進度**（2026-04-25）：
>
> - **v0.43.3 production flip true 實測失敗**：上 production 後 Claude.ai 撞 `GET /mcp` 405 → OAuth 循環失敗（"Authorization with the MCP server failed"）。Root cause：stateful DO transport 缺 `GET /mcp` SSE channel；MCP spec 2025-11-25 對 GET 405 雖 spec-compliant，但 Claude.ai client fallback 行為是重 OAuth 而非 POST-only，且 stateful server 缺 SSE = 名實不符。
> - **v0.43.4 stop-gap rollback 進行中**：`wrangler.jsonc` flag → `false` + patch bump v0.43.3 → v0.43.4 + tag push + CI auto deploy production；完成後**MUST**用 `wrangler versions view` 確認 production runtime flag = false 才算 stop-gap 收尾。
> - **`wire-do-tool-dispatch` scope 擴張**：原 24 tasks → 34 tasks（22/34, 65%）。§4.x SSE on DO 5/5 已完成；§5.x SSE Tests 0/4 未做（basic SSE / Last-Event-Id replay / multi-connection / DELETE）；§6.x / §7.1 / §7.2 / §7.3 / §8.1–§8.4 全部未做。§7.1 acceptance 升級為三項全綠：(a) curl 4 tool call 全 `isError:false` (b) SSE-aware mock client（ReadableStream consume + Last-Event-Id replay simulation）(c) 真實 Claude.ai 連 staging 走 OAuth flow + 3 個 askKnowledge query UI 顯示真實答案（非 "Authorization failed" / "Tool execution failed"）。
> - **`consolidate-conversation-history-config`** 已完成 archive（保留歷史視野）：抽出 `createChatConversationHistory` factory，把 `index.vue` + `ConversationHistory` 的雙份 config / refresh 邏輯收斂；`/api/chat` 路徑修復連串本地 bootstrap 斷點（TD-046 done — staging AutoRAG index 已建立）。人工檢查中發現 TD-044 / TD-045 / TD-047 / TD-048 / TD-050 並登記在 register。
> - **v0.43.0 → v0.43.3 release 歷史**：v0.43.0 收 wire-do-tool-dispatch staging protocol 驗證 + DO debug instrumentation；v0.43.1 補 docs vitepress yaml escape；v0.43.2 修 `reflect-metadata` polyfill 洩漏 Nitro bundle module scope；v0.43.3 把 production MCP session flag 翻 true（已被 v0.43.4 rollback）並收尾 TD-045 narrow scope（`predev` bootstrap health check）。
> - **`add-mcp-tool-selection-evals`** 已於 2026-04-25 完成 archive：eval harness、dataset、scorer、文件、dev token CLI、bearer-token client wiring、baseline 與 manual review 皆已落地；`mcp-tool-selection-evals` spec 已同步到主規格。
> - **`fix-user-profile-id-drift`** 已於 2026-04-25 完成 archive：`session.create.before` hook 改寫為 email_normalized-first lookup + app-level migrate children + non-production rethrow + actionable log hint；TD-044 standalone done。
> - **`add-new-conversation-entry-points`** 已於 2026-04-25 完成 archive：chat header 顯式「新對話」按鈕 + reload 行為修復 + Safari private mode 相容；TD-048 standalone done。
> - **`wire-do-tool-dispatch` §6.4 wire-up gap 揭露（apply session 2026-04-25 後追）**：寫 `scripts/probe-mcp-sse-mock-client.sh` 對 local stateful dev 跑 §7.1 (b) probe，揭露 v0.43.3 production flip 5 分鐘失敗的 root cause = 兩個 wire-up gap：
>   - **G1（已實測 fix）**：`nuxt.config.ts` 頂層漏設 mcp-toolkit module options `mcp: { sessions: true }` → toolkit node provider `sessions.enabled` 永遠 false → GET /mcp 直接回 405。staging-sse-acceptance.mts 對 staging 跑也會撞同樣 G1。
>   - **G2（root cause 待查）**：G1 fix 後 GET /mcp 仍 hang，curl 4 秒 0 byte received。可能 nitro/h3 streaming response wrap、`evlog/nuxt` plugin buffer、或 toolkit alias 強制 node provider 後 ReadableStream wrap 問題。
>   - 已加 §6.4 task block 到 tasks.md；§7.1 / §7.2 caveat 已更新註明 dep §6.4。
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

- **`upgrade-mcp-to-durable-objects`** 17/27 tasks (63%)，**Phase 4 scope 縮為 session lifecycle only** — tool dispatch 已由 `wire-do-tool-dispatch` (archived 2026-04-25) 接手並完整實作於 production；本 change 剩 session lifecycle 部分（DO state TTL / alarm cleanup / multi-DO management 等）。Mutex 已解（wire-do archive 完成）→ 可續推
- **`wire-do-tool-dispatch`** 已於 2026-04-25 archive：v0.46.0 production flip true 完成，§6.4 4-layer fix 全綠，TD-030 + TD-041 標 done，ADR `docs/decisions/2026-04-25-cloudflare-sse-streaming-bypass.md` 紀錄架構決策

### 已 propose，待 apply（見 AUTO Parked Changes 區塊）

_(none)_

### 近期（尚未 propose，可與 DO change 並行）

- [mid] **TD-050** Staging R2 (`agentic-rag-documents-staging`) 為空，缺 RAG content seed / sync schedule — 依賴：與 `wire-do-tool-dispatch` archive 一併處理（驗證 4 個 tool call `citations:[] / results:[]` empty 是否因 R2 缺資料導致）
- [mid] **TD-049** Cloudflare Pages deploy API 拒絕 git HEAD commit message — in-progress（CI 已加 workaround `5ce334c`），持續觀察是否仍有 deploy 中斷
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

_last synced: 2026-04-25T13:20:17.935Z_

1 active change (0 ready · 1 in progress · 0 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

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

1 claim (0 active · 1 stale)

### Live Ownership

_(none)_

### Stale Claims

- **wire-do-tool-dispatch** — unknown:charles@charlesdeMac-mini.local (unknown)
  - Accepted from: manual
  - Last heartbeat: 2026-04-25T10:06:25.765Z
  - Note: v0.43.4 stop-gap 收尾完成；production runtime flag = false 已驗證；下次推進為 §5.x SSE Tests
  - Status: stale (last heartbeat 2026-04-25T10:06:25.765Z)

<!-- SPECTRA-UX:ROADMAP-AUTO:/claims -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

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

_No parked changes._

<!-- SPECTRA-UX:ROADMAP-AUTO:/parked -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

_(none — 2026-04-19 下午 8 個 parked change 全部 unpark 處理完畢：2 個刪除、1 對合併、5 個留作 active。)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
