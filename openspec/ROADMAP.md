# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-25 更新）：目前 branch `main`，最新 tag `v0.46.0`，production runtime `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION = "true"` 翻新後正常運作。MCP Durable Object 主軸已上線（DO tool dispatch + SSE channel + auth context HMAC forward）。Open tech debt 無 build/deploy blocker。
>
> **最新進度**（2026-04-25）：
>
> - **`wire-do-tool-dispatch`** 已於 2026-04-25 完整 archive：v0.43.4 stop-gap rollback → v0.44.0/.1 / v0.45.0/.1 4-layer fix → v0.46.0 production flip true。staging acceptance 12/12 全綠 (`pnpm mcp:acceptance:staging`)，production worker fetch handler 正常驗證 bearer + 無 ownKeys/TypeError。§6.4 streaming bypass 架構決策見 ADR `docs/decisions/2026-04-25-cloudflare-sse-streaming-bypass.md`；TD-030 + TD-041 standalone done。
> - **`add-mcp-tool-selection-evals`** archive：eval harness、dataset、scorer、文件、dev token CLI、bearer-token client wiring、baseline 與 manual review 皆已落地；`mcp-tool-selection-evals` spec 已同步到主規格。
> - **`fix-user-profile-id-drift`** archive：`session.create.before` hook 改寫為 email_normalized-first lookup + app-level migrate children + non-production rethrow + actionable log hint；TD-044 standalone done。
> - **`add-new-conversation-entry-points`** archive：chat header 顯式「新對話」按鈕 + reload 行為修復 + Safari private mode 相容；TD-048 standalone done。
> - **`consolidate-conversation-history-config`** archive：抽出 `createChatConversationHistory` factory；TD-046 staging AutoRAG index 已建立 → done（acceptance 4 tool call 全 isError:false 等價驗證）。
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
> - **MCP Durable Object 工作線拆分**：`upgrade-mcp-to-durable-objects` 保留 session lifecycle scope；`wire-do-tool-dispatch` 已 archive（負責 DO 內 tool dispatch、auth context HMAC forward 與 production flag rollout 全收）。
> - **Workers AI 回答層 / web chat 真串流** archive。

## Next Moves

進行中：_(none — MCP DO 主軸全收，無 active spectra change)_

### 已 propose，待 apply（見 AUTO Parked Changes 區塊）

_(none)_

### 近期（尚未 propose，可獨立進）

- [mid] **TD-050** Staging R2 (`agentic-rag-documents-staging`) 為空，缺 RAG content seed / sync schedule — wire-do archive 後可獨立進（驗證 4 個 tool call `citations:[] / results:[]` empty 是否因 R2 缺資料導致）
- [mid] **TD-049** Cloudflare Pages deploy API 拒絕 git HEAD commit message — in-progress（CI 已加 workaround `5ce334c`），持續觀察是否仍有 deploy 中斷
- [mid] **TD-047** `/api/chat` SSE `ready` 後階段 error 時 Container 未 emit `conversation-persisted` — 獨立、scope 小
- [mid] **TD-009** `user_profiles.email_normalized` nullable migration — 獨立（scope 非小：rebuild `user_profiles` + 4 FK children，約 700+ 行 SQL + data migration）
- [low] **日期格式 smoke（遺留）** — `/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認

### 中期（合併評估）

- [mid] **TD-015 + TD-019 + TD-016 SSE 合併處理**

### 長期（DO 主軸 archive 後可進）

- [high] **TD-027** MCP connector first-time auth — DO archive 已完成，可隨時實測 Claude.ai connector OAuth flow
- [mid] **`discuss-mcp-resource-layer`** — DO archive 已完成，可 propose
- [low] **`discuss-mcp-elicitation-for-ask`** — DO archive 已完成，可 propose
- [low] **`discuss-mcp-async-context-refactor`** — Tier 3 高風險，discuss 階段需驗證 asyncContext 與 CF Workers runtime 相容性；**supersedes** `integrate-mcp-logger-notifications`（實證 `@nuxtjs/mcp-toolkit@0.14.0` 的 `useMcpLogger` + `useMcpServer` 皆硬性要求 `nitro.experimental.asyncContext: true`，本專案目前走自寫 `getCurrentMcpEvent()` 繞過 asyncContext，不相容）

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-25T13:28:10.409Z_

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

_No parked changes._

<!-- SPECTRA-UX:ROADMAP-AUTO:/parked -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

_(none — 2026-04-19 下午 8 個 parked change 全部 unpark 處理完畢：2 個刪除、1 對合併、5 個留作 active。)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
