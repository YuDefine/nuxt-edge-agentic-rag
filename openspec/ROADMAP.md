# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-26 更新）：branch `main`，最新 tag `v0.52.0`，production runtime `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION = "true"`。AUTO 區塊顯示沒有正在做的 change。
>
> 本日已歸檔兩條 spectra change（皆 production smoke test 全綠，對應 register 條目已標 done）：admin MCP token revoke → DO session storage 串連清空（v0.51.0；HMAC `__invalidate` bypass + KV 索引 + best-effort cascade）；user_profiles.email_normalized nullable + 8 表 cascade rebuild（v0.52.0；migration 0016 採 `_v16 → _v16` FK pattern + D1 RENAME-rewrite + sentinel→NULL backfill）。
>
> **v0.52.1 ship**（純 docs / handoff metadata，`9c3504c` + `38e813d`，但隨 deploy 把 `5a477e7` 推上 production）已落地。Pending verify：TD-057 SSE wide event lifecycle child request logger 修法、TD-056/061 judge `max_completion_tokens: 200 → 1024`。觀察方式：wrangler tail 看 1-2 條 SSE chat（warning 應消失 + 子事件帶 `_parentRequestId`）+ D1 `query_logs` 24-48 hr 確認 pipeline_error 比例 < 5%（baseline 28.6%）。TD-060 retrieval query gap 為下一條 propose 主軸，第二輪 acceptance 依賴 TD-060 解。
>
> 歷史 archive 詳情請見 `openspec/changes/archive/<change>/` 各 change 目錄；tech debt 追蹤請見 `docs/tech-debt.md`。

## Next Moves

### 進行中（active，見 AUTO Active Changes 區塊）

- **rag-query-rewriting** — code 已隨 v0.53.0 ship 到 production（feature flag `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING=false` ramp gate）；staging `features.queryRewriting=true` 已生效。**Acceptance 達標（2026-06-09 REST run，15 web fixtures）**：retrieval_score ≥0.55 占比 baseline 40% → rewritten **60%**（✅ ≥50%）、rewriter fallback **0%**（✅）、改寫方向 **0 語意漂**（✅）；avg 0.548 → 0.588。Latency p95 增量待 staging app endpoint 補測（REST search total 不適用，rewriter call ~749ms < 800ms budget）。**注意**：`agentic-rag` index 已 reindex（baseline 從第一輪全 <0.45 升到 avg 0.548），rewriter 為「漸進改善」而非「救火」。Evidence: `docs/decisions/2026-04-26-rag-query-rewriting.md` + `local/reports/notes/main-v0.0.54-acceptance-rewriter-rest-20260609.md`。剩餘：6.3 staging migration/flag 確認、人工檢查（7 項 [discuss]）、7.1-7.5 follow-ups（archive 不等）、archive

### 已 parked

_(目前無 parked change — 2026-04-26 兩個 parked change 全 unpark + 實作 + archive)_

### 近期（尚未 propose，可獨立進）

- ~~[high] **TD-059** E2E Tests CI workflow 連續 50+ run 全紅~~ — **2026-04-26 done**（採方案 A：wrangler dev 取代 nuxt preview 當 webServer），register Status `done`
- [high] **TD-060 — 2026-06-09 達標（rewriter 路徑）** Production `agentic-rag` AutoRAG retrieval_score query gap，採 query rewriting 修法。**驗收結果**：rewriter 把 retrieval_score ≥0.55 占比從 baseline 40% 拉到 **60%**（達 ≥50% target），0% fallback、0 語意漂（REST run，15 web fixtures，見 `rag-query-rewriting` change）。**但 root-cause 已部分自癒**：`agentic-rag` index 在 2026-04-26 後 reindex，baseline 從第一輪全 <0.45（avg 0.32-0.44）升到 avg 0.548，原「全部卡 0.38」前提不成立。rewriter 仍正向（+0.04 avg、+20pp 達標率），改列「漸進改善」。register Status 待 change archive 後標 done。診斷 evidence: `local/reports/notes/td-060-retrieval-score-diagnosis-20260426.md`
- [high] **TD-061 / TD-056（同源）** judge `max_completion_tokens` 截斷 — fix code 已隨 v0.52.1 ship（`5a477e7`：`workers-ai.ts:135` `200 → 1024` + 2 條 vitest unit test lock）。**驗收時機已到**：(a) wrangler tail 觀察 1-2 條 SSE chat，`decision_path=pipeline_error` 比例 ≈ 0；(b) 24-48 hr 後撈 D1 `query_logs` 24h 內 pipeline_error 比例 < 5%（baseline 28.6%）。Production 35 筆 incident 證據保留：`created_at >= '2026-04-26T00:49:30'`
- [mid] **TD-057** evlog wide event lifecycle 警告 — fix code 已隨 v0.52.1 ship（`5a477e7`：`server/api/chat.post.ts` + `server/utils/chat-sse-response.ts` 改用 `createRequestLogger` + `_deferDrain` 開 child request logger，stream settled 後手動觸發 `evlog:enrich` / `evlog:drain` hook 並把 drain promise 註冊到 `cloudflare.context.waitUntil`）。**驗收時機已到**：wrangler tail 觀察 1-2 條真實 SSE chat，warning 應消失，wide event 觀察到 `operation: 'web-chat-sse-stream'` 子事件帶 `_parentRequestId` + `result` / `error` 欄位
- ~~[high] **第二輪 main-v0.0.54-acceptance（retrieval_score 維度）**~~ — **2026-06-09 done**（REST run，15 web fixtures，retrieval_score ≥0.55 baseline 40% → rewritten 60%）。Evidence: `local/reports/notes/main-v0.0.54-acceptance-rewriter-rest-20260609.md`。**仍待補的維度**（非 retrieval_score）：Judge 觸發率、引用正確率、回答正確率、policy classifier precision — 需對 staging/production app endpoint 跑完整 chat（非 REST retrieve），可待 rag-query-rewriting archive 後另開 ops 驗收
- [high] **rag-query-rewriting production ramp（下一條 ops change）** — 依賴 rag-query-rewriting archive。acceptance 達標後把 production `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING` 從 false → true 的 ramp，需人工授權 + production soak 觀察（retrieval_score 分布、latency p95 實測、fallback rate）。latency p95 增量的 staging app-endpoint 實測也併入此 ramp 前置
- [low] **TD-058** Production `user_profiles` 6 條 orphaned rows（profile.id 不在 user.id）— TD-053 立即驗收附帶發現；schema 中 `user_profiles.id` 非 `user.id` 的 FK，需評估清理 / FK 加掛策略，可能與 TD-009 user_profiles rebuild 合併處理
- [low] **v0.50.0 simplify / code-review 留下的 cosmetic 觀察**（不登記 TD，留作 backlog）
  - `conversation-store.ts` / `knowledge-audit.ts` / `web-chat.ts` / `mcp-ask.ts` 的 `refusalReason?: string | null` 可收緊為 `RefusalReason | null`（DB 層沒 enum 約束，靠 application layer enforce）
  - `chat-sse-response.ts` heartbeat catch 不設 `closed = true`（finally 仍兜底，雙保險更乾淨）
  - `MessageList.vue` assistant content 改 markdown 渲染（已落地，視覺驗收通過——標記為「已超出 persist-refusal 原 scope 但決定保留」）
  - `conversation-title.ts` `slice(0, 40)` 是 code-unit indexed，emoji 可能斷在 surrogate pair 中間（罕見）
  - `RefusalMessage.vue` `mailto:${adminContactEmail}` 未 URL-encode email 本身（subject 有 encode）
- ~~[mid] **TD-009** `user_profiles.email_normalized` nullable migration~~ — **2026-04-26 done**（v0.52.0 ship；migration 0016 8 表 cascade rebuild + sentinel→NULL backfill；採 `_v16 → _v16` FK pattern + D1 RENAME-rewrite；archived 於 `2026-04-26-passkey-user-profiles-nullable-email`）
- [low] **日期格式 smoke（遺留）** — `/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認
- [mid] **v0.53.0 ship 後 follow-up tech-debt**（已 register，獨立進）：
  - TD-062 `buildRetrieveWithRewriter` helper 抽出（chat / mcp ask / mcp search 三處 ~28 LoC × 3 closure 重複）
  - TD-064 `retrieve-verified-evidence-with-rewriter.spec.ts` 改用真實 D1 round-trip 覆蓋 audit dynamic UPDATE
  - TD-063 / TD-065 / TD-066 (low) 視時間整合進其他 RAG 改動
- [mid] **v0.53.0 production verify**（剛 ship，獨立進）：
  - 確認 production worker `features.queryRewriting=false` 仍生效（不啟用 rewriter）
  - 確認 docs site 顯示 chat / conversation / citation / guest-policy / mcp auth 新 OpenAPI metadata
  - 抽 1-2 條 production chat 確認 RAG markdown 排版規則生效（無 `#`/`##`/`###` 標題）

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

_last synced: 2026-06-09T22:40:05.499Z_

1 active change (0 ready · 1 in progress · 0 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **adopt-evlog-nuxthub-ai-t3** — 5/39 tasks (13%)

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

- `adopt-evlog-nuxthub-ai-t3`

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
