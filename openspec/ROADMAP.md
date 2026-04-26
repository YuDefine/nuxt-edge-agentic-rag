# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-26 更新）：branch `main`，最新 tag `v0.50.1`（commit `7868b80`），production runtime `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION = "true"`。MCP Durable Object 主軸已完整上線（DO tool dispatch + SSE channel + auth context HMAC forward）；v0.49.0 完成 SSE heartbeat + `readSseStream` 統一收尾；v0.50.0 持久化 refusal 訊息 + sidebar 「新對話」label + reason-specific copy + markdown 內容渲染；v0.50.1 帶入 migration 0015 explicit-FK rebuild + spec `auth-storage-consistency` 補 `Live DDL Foreign Key References Match Canonical Table Names` requirement（本機真實 libsql 套用 0015 後 FK 文字皆 canonical、`PRAGMA foreign_key_check` 乾淨；production D1 為 no-op，待 deploy 後 wrangler 對照；對應 change 已歸檔，tech-debt entry status 已翻 done）。當前無 active change。
>
> 歷史 archive 詳情請見 `openspec/changes/archive/<change>/` 各 change 目錄；tech debt 追蹤請見 `docs/tech-debt.md`。

## Next Moves

### 進行中（active，見 AUTO Active Changes 區塊）

_(目前無 active change)_

### 已 parked

_(見 AUTO Parked Changes 區塊：add-mcp-token-revoke-do-cleanup、passkey-user-profiles-nullable-email)_

### 近期（尚未 propose，可獨立進）

- ~~[high] **TD-059** E2E Tests CI workflow 連續 50+ run 全紅~~ — **2026-04-26 done**（採方案 A：wrangler dev 取代 nuxt preview 當 webServer），register Status `done`
- [mid] **TD-057** evlog wide event lifecycle 警告 — production live tail 已重現 `log.error()` × 3（對應 pipeline_error 路徑）+ `log.set()` × 3（對應 refusal/成功路徑），同 root cause（SSE `ReadableStream.start()` 內 callback 試圖 mutate 已 emit 的 wide event）。影響 SSE stream 真實錯誤與結果欄位可觀察性
- [low] **TD-056** Workers AI judge 模型 `max_completion_tokens: 200` 上限被截斷 → JSON parse 失敗 → pipeline_error — 2026-04-26 production live 採樣再添 3 條樣本（皆為 reasoning-heavy 或 markdown 處理 query），可從 `query_logs.id` `958783b0` / `278a50a8` / `e17514ed` 抽 `workers_ai_runs_json` 對照
- [low] **TD-058** Production `user_profiles` 6 條 orphaned rows（profile.id 不在 user.id）— TD-053 立即驗收附帶發現；schema 中 `user_profiles.id` 非 `user.id` 的 FK，需評估清理 / FK 加掛策略，可能與 TD-009 user_profiles rebuild 合併處理
- [low] **v0.50.0 simplify / code-review 留下的 cosmetic 觀察**（不登記 TD，留作 backlog）
  - `conversation-store.ts` / `knowledge-audit.ts` / `web-chat.ts` / `mcp-ask.ts` 的 `refusalReason?: string | null` 可收緊為 `RefusalReason | null`（DB 層沒 enum 約束，靠 application layer enforce）
  - `chat-sse-response.ts` heartbeat catch 不設 `closed = true`（finally 仍兜底，雙保險更乾淨）
  - `MessageList.vue` assistant content 改 markdown 渲染（已落地，視覺驗收通過——標記為「已超出 persist-refusal 原 scope 但決定保留」）
  - `conversation-title.ts` `slice(0, 40)` 是 code-unit indexed，emoji 可能斷在 surrogate pair 中間（罕見）
  - `RefusalMessage.vue` `mailto:${adminContactEmail}` 未 URL-encode email 本身（subject 有 encode）
- [mid] **TD-050** Staging R2 (`agentic-rag-documents-staging`) 為空，缺 RAG content seed / sync schedule — wire-do archive 後可獨立進（驗證 4 個 tool call `citations:[] / results:[]` empty 是否因 R2 缺資料導致）
- ~~[mid] **TD-009** `user_profiles.email_normalized` nullable migration~~ — **2026-04-26 unparked + active**（claim charles@charlesdeMac-mini.local；改用 migration 0016；不合併 TD-058，後者另案處理）
- [low] **日期格式 smoke（遺留）** — `/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認

### 長期（DO 主軸 archive 後可進）

- [high] **TD-027** MCP connector first-time auth — DO archive 已完成，可隨時實測 Claude.ai connector OAuth flow

> **2026-04-25 決策**：以下 MCP capability surface 提案已評估後放棄，不再保留為 backlog：
>
> - `discuss-mcp-resource-layer` — 與 RAG retrieve-first 設計衝突，現有 `getDocumentChunk` 已涵蓋等價語意
> - `discuss-mcp-elicitation-for-ask` — multi-turn agent 領域，違背 stateless RAG 設計；`inputExamples` 已涵蓋引導 LLM 寫出精確 query 的等價收益
> - `discuss-mcp-async-context-refactor`（supersedes `integrate-mcp-logger-notifications`） — 自寫 `getCurrentMcpEvent()` shim 已通過 production verification（wire-do v0.46.0 acceptance 12/12），refactor 為 Tier 3 高風險且無 user value

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-26T01:02:07.881Z_

1 active change (0 ready · 1 in progress · 0 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **add-mcp-token-revoke-do-cleanup** — 17/23 tasks (74%)
  - Specs: `oauth-remote-mcp-auth`

### Draft

_(none)_

### Blocked

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->

<!-- SPECTRA-UX:ROADMAP-AUTO:claims -->

## Active Claims

> 即時 ownership 由 `.spectra/claims/*.json` 提供。
> 接手 handoff / 開始做 change 時，先 claim，再移除 `HANDOFF.md` 對應項目。

2 claims (0 active · 2 stale)

### Live Ownership

_(none)_

### Stale Claims

- **passkey-user-profiles-nullable-email** — unknown:charles@charlesdeMac-mini.local (unknown)
  - Accepted from: manual
  - Last heartbeat: 2026-04-25T22:46:11.210Z
  - Status: stale (last heartbeat 2026-04-25T22:46:11.210Z)
- **add-mcp-token-revoke-do-cleanup** — unknown:charles@charlesdeMac-mini.local (unknown)
  - Accepted from: manual
  - Last heartbeat: 2026-04-25T21:57:18.701Z
  - Status: stale (last heartbeat 2026-04-25T21:57:18.701Z)

<!-- SPECTRA-UX:ROADMAP-AUTO:/claims -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

- `add-mcp-token-revoke-do-cleanup`

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
