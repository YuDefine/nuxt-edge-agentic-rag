# Tech Debt Register

追蹤 `@followup[TD-NNN]` marker 對應的未解決項目。所有在 `openspec/changes/**/tasks.md` 裡出現的 marker 都必須在此有對應 entry，否則 `spectra-archive` 會被 `pre-archive-followup-gate.sh` 攔截。

規則詳見 `.claude/rules/follow-up-register.md`。

---

## Index

| ID     | Title                                                                                                                                                                                                                                                         | Priority | Status      | Discovered                                                       | Owner |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ---------------------------------------------------------------- | ----- |
| TD-027 | MCP connector first-time authorization journey 實測待部署後驗證                                                                                                                                                                                               | mid      | open        | 2026-04-24 auth-redirect-refactor 人工檢查 7.4                   | —     |
| TD-045 | Local dev bootstrap 連串斷點（narrow scope：`.env` AI_SEARCH_INDEX 空值 + `[nuxt-hub] DB binding not found` 間歇 500；migration 自動化已由 NuxtHub v0.10.7 接手）                                                                                             | mid      | in-progress | 2026-04-25 consolidate-conversation-history-config §7.4 人工檢查 | —     |
| TD-054 | `add-new-conversation-entry-points` Safari private mode 實機驗證 — archive 時授權 skip，待後續本機 Safari 補上                                                                                                                                                | low      | open        | 2026-04-25 add-new-conversation-entry-points archive             | —     |
| TD-056 | Workers AI judge 模型 `max_completion_tokens: 200` 上限被截斷 → JSON parse 失敗 → pipeline_error                                                                                                                                                              | low      | open        | 2026-04-26 v0.50.0 production 7.2 verify 抽查 query_logs         | —     |
| TD-057 | evlog wide event lifecycle 警告 — `log.error()` 在 wide event emit 後呼叫，導致 SSE stream 真實錯誤 keys 被丟棄                                                                                                                                               | mid      | open        | 2026-04-26 production wrangler tail                              | —     |
| TD-058 | Production `user_profiles` 6 條 orphaned rows（profile.id 不在 user.id）                                                                                                                                                                                      | low      | open        | 2026-04-26 TD-053 production 立即驗收                            | —     |
| TD-060 | Production `agentic-rag` AutoRAG 對 seed acceptance fixture 的 retrieval_score 平均 0.32–0.44，全部低於 `directAnswerMin=0.7`，治理層 100% 走 `no_citation_refuse`                                                                                            | high     | open        | 2026-04-26 main-v0.0.54-acceptance run                           | —     |
| TD-061 | Production `query_logs` r2 重測批次 28.6%（10/35）觸發 `decision_path=pipeline_error`；同 prompt 重複查詢可能觸發 stateful failure                                                                                                                            | high     | open        | 2026-04-26 main-v0.0.54-acceptance run                           | —     |
| TD-062 | `rag-query-rewriting` 三個 entry point 的 retrieve closure 幾乎重複（chat.post.ts / mcp/tools/ask.ts / mcp/tools/search.ts），約 28 LoC × 3 應抽 helper                                                                                                       | mid      | open        | 2026-04-26 `/commit` 0-A simplify review                         | —     |
| TD-063 | `useRewriter: false on retry` 的 docstring 在 4 個 callback signature 重複 6-9 行同一段；應只留一份 canonical 在 `knowledge-query-rewriter.ts`                                                                                                                | low      | open        | 2026-04-26 `/commit` 0-A simplify review                         | —     |
| TD-064 | `test/integration/retrieve-verified-evidence-with-rewriter.spec.ts` 同時 mock `search` 與 `resolveCurrentEvidence`，違反「no mocking DB in integration tests」；應 relocate 或補真實 D1 round-trip 覆蓋 audit dynamic UPDATE                                  | mid      | open        | 2026-04-26 `/commit` 0-A code-review                             | —     |
| TD-065 | `UpdateQueryLog.rewriterStatus` 型別 `string \| null` 與 `query_logs.rewriter_status` NOT NULL 不一致；潛在 5xx                                                                                                                                               | low      | open        | 2026-04-26 `/commit` 0-A code-review                             | —     |
| TD-066 | `retrieveVerifiedEvidence` 用 `=== 'success'` 比對 `RewriterStatus`，違反專案 `switch + assertNever` exhaustiveness rule；新增 enum 值時不會 compiler error                                                                                                   | low      | open        | 2026-04-26 `/commit` 0-A code-review                             | —     |
| TD-067 | `test/tsconfig.json` baseline 191 errors（component module not found + fixture type drift + Nitro route key excessive depth + `allowImportingTsExtensions` 缺 + middleware signature 漂移）                                                                   | mid      | open        | 2026-05-04 clade v0.3.10 cutover pre-push test-typecheck 揭露    | —     |
| TD-068 | deploy.yml 兩個 wrangler-action step 缺 secrets: list（違反 cf-workers/secrets.md rule）                                                                                                                                                                             | mid      | open        | 2026-05-09 — clade v0.5.25 新增 rules/modules/runtime/cf-workers/secrets.md 後對 5 consumer 跑 verify checklist 揭露 | —     |
| TD-069 | T3 evlog 落地 production 缺 D1 evlog_events migration（drain 在 prod 是 dead-write）                                                                                                                                                                                 | high — T3 evlog 在 production 形同無作用，所有 wide event drain 都會 silently fail | open        | 2026-05-10 — clade HANDOFF §2.4 dev smoke 跑 wrangler d1 execute agentic-rag-db --remote --command "SELECT count(*) FROM evlog_events" 回 no such table: evlog_events: SQLITE_ERROR [code: 7500] | —     |
| TD-070 | `rag-query-rewriting` 人工檢查對齊新 manual-review 規範（補 `[discuss]` marker + verify channel + Pre-Review Data Readiness）                                                                                                                                 | mid      | open        | 2026-05-12 clade v1.3.6 manual-review.md 新規散播                | —     |
| TD-071 | deploy-workflow contract test 對 workflow 原文做無錨點斷言、未剝除註解 — 註解引用同一字串即恆綠 | mid | open | 2026-07-29 clade pitfall 跨 consumer 掃描 | — |

---

## TD-027 — MCP connector first-time authorization journey 實測待部署後驗證

**Status**: in-progress — local backend migration verified; staging deploy/smoke/D1/MCP evidence pending authorization.
**Priority**: mid
**Discovered**: 2026-04-24 — `auth-redirect-refactor` 人工檢查 7.4
**Location**: `app/pages/auth/mcp/authorize.vue`、`app/utils/mcp-connector-return-to.ts`、`app/pages/auth/callback.vue`
**Related markers**: search `@followup[TD-027]` in repo

### Problem

`auth-redirect-refactor` 改動：

1. `/auth/mcp/authorize` 的 Google login handler 加 `callbackURL: '/auth/callback'`（避免 better-auth 預設回 `/`）
2. `/auth/callback` consume order 改為 MCP > generic > fallback `/`

以上改動需要透過 **Claude.ai 實際發起 MCP connector connection** 才能 end-to-end 驗證，但目前 local dev 無法被 claude.ai 直接連到（需 ngrok / cloudflare tunnel / 部署到 staging）。人工檢查 7.4 因此暫未驗證。

### Fix approach

部署到 staging 或 production 後，執行人工驗收流程：

1. Claude.ai MCP connector 指向已部署的 MCP endpoint
2. 發起連接 → 被導去 `https://<deployed-host>/auth/mcp/authorize?client_id=...&redirect_uri=...&...`
3. 點 Google 登入 → OAuth 完成
4. **必須回到原 `/auth/mcp/authorize?...` 同樣 URL**（驗 `saveMcpConnectorReturnTo` sessionStorage bridge）
5. 看到授權同意畫面 → 點授權 → 回 Claude.ai
6. 在 Claude.ai 能正常使用 MCP tools

### Acceptance

- Staging / production 完成上述 6 步流程無中斷、無錯誤
- 步驟 4 的 URL 是**原始 authorize URL 含 query**，而非 `/` / `/auth/login`
- Claude.ai 端 connector 狀態顯示 connected 且可呼叫工具
- 完成後將 7.4 marker 從 tasks.md 移除並更新 TD-027 Status 為 `done`

---

## TD-045 — Local dev bootstrap 連串斷點

**Status**: in-progress
**Priority**: mid
**Discovered**: 2026-04-25 — `consolidate-conversation-history-config` §7.4 人工檢查（新 session `pnpm dev` 後 /api/chat 一路從 500 FK error → 503 binding 未設 → 503 AutoRAG not found，共三關）
**Location**: `scripts/check-dev-bootstrap-health.mjs`（predev 警告）、`docs/tech-debt.md`（本 entry）、待動：`[nuxt-hub] DB binding not found` 間歇 500 trace 定位
**Related markers**: search `@followup[TD-045]` in repo

### Problem

Local dev 起床到 `/api/chat` 200 的路徑曾經有三條坑（原始發現時列入），經 v0.43.2 前後實測後收斂：只剩「`.env` `NUXT_KNOWLEDGE_AI_SEARCH_INDEX` 空值 → `/api/chat` 503」為穩定可重現，其餘兩條在目前 NuxtHub v0.10.7 路徑下不會出現。此外截圖審查過程浮現新症狀：`/api/auth/me/credentials` 間歇性 500 `[nuxt-hub] DB binding not found`，疑似 miniflare D1 binding cold-start / HMR race，未定位前歸入本 entry 的 active scope。

### Status Update（2026-04-25, post-v0.43.2）

原始 Problem 三條坑經實測後收斂為 narrow scope：

- **Problem #1（NuxtHub 不 auto-apply migrations）**：~~obsolete~~ → **regressed/重新發現** @ 2026-04-25 `fix-user-profile-id-drift` apply 階段 cleanroom 實戰。先前 entry 描述「v0.10.7 已自動 apply」實際為 false：`node_modules/@nuxthub/core/dist/db/runtime/plugins/migrations.dev.mjs` 內 dev plugin 仍 gated by `if (!hub.db.applyMigrationsDuringDev) return;`，nuxt.config.ts `hub: { db: 'sqlite' }` 沒設此 flag，所以 cleanroom 後 `_hub_migrations` 僅建立空表、所有 migration 都未 apply。原本 entry 觀察到「11 筆應用紀錄」的環境是 v0.10.6 或更早跑過 migrate 後留存的狀態，cleanroom 重做時退回真空。Reproduction：`rm .data/db/sqlite.db && rm -rf .wrangler/state/v3/d1/miniflare-D1DatabaseObject && pnpm dev`，第一次 `POST /api/_dev/login` 500 `Failed to prepare credential account`（drizzle 對未存在的 `user` 表 SELECT 失敗）。手動 `for f in server/database/migrations/*.sql; do sqlite3 .data/db/sqlite.db < $f; done` 可灌進 schema 但 0007 ALTER 路徑跟 NuxtHub plugin 不對齊（產出 `account.userId REFERENCES user_new(id)` 殘留）。需 opt-in `applyMigrationsDuringDev: true`（簡單）或上游將其改 dev 預設值（需 NuxtHub PR）。
- **Problem #2（stale `*_new` FK refs）**：not-reproduced。當前 DB 的 `sqlite_master` 無任何 `*_new(…)` 殘留，`PRAGMA foreign_key_check;` 乾淨。此 bug 只會在手動 `sqlite3 < migration.sql` 路徑出現，正常 NuxtHub auto-apply 不會踩。v0.43.2 的 `check-dev-bootstrap-health.mjs` 已加 defensive 偵測（若 regresses，predev 會印 actionable warning + rebuild 指令）。
- **Problem #3（`AI_SEARCH_INDEX=` 空值）**：partial fix shipped @ v0.43.2 (`00e5314`)。`predev` 現會 warn `NUXT_KNOWLEDGE_ENVIRONMENT=local` + `NUXT_KNOWLEDGE_AI_SEARCH_INDEX=` 空值的組合，並指引 Notion Secret 頁「Local chat / AutoRAG 驗證指引」。script exit 0 不擋 dev。
- **新增 active scope（從 HANDOFF Blocked 繼承）**：`/api/auth/me/credentials` 間歇性 500 `[nuxt-hub] DB binding not found` — 原 TD-045 未涵蓋，截圖審查時才浮現；需要可重現 trace 才能定位（疑似 miniflare cold-start race），本輪未碰。

### Fix approach（remaining）

1. **NuxtHub dev migration auto-apply opt-in** — `nuxt.config.ts` `hub: { db: 'sqlite', applyMigrationsDuringDev: true }`。最小成本，立刻讓 cleanroom 流程可跑。權衡：每次 dev startup 多跑 migration（idempotent，影響 < 1s），但 dev plugin 內部 try/catch 邏輯如果 migration 損壞會把錯誤帶到 startup（vs 目前是 lazy fail at request time）— 看做 fail-fast 優點。
2. **`[nuxt-hub] DB binding not found` 間歇 500 定位** — 收集一次重現 trace（timestamp / 其他同時請求 / miniflare 啟動 log）。可能方向：miniflare D1 binding hydration 的 race、HMR 後 server context 未重新綁定、`@nuxthub/core` v0.10.7 vs 舊版行為差異。
3. **`.env.example` 加註解** — 目前被 `guard-check` permanent-protected。若之後要動，使用者需手動改或解 guard；script output 已涵蓋指引，優先級低。
4. **cleanroom e2e 驗證** — Fix #1 後，`rm -rf .data/db .wrangler/state/v3/d1/miniflare-D1DatabaseObject && pnpm dev` 跑一次，確認全程無手動 sqlite3 步驟即可到 /api/chat 200。同時追跑 `fix-user-profile-id-drift` task 7.1 / 7.2 / 9.1 / 9.2（其 markers `@followup[TD-045]` 已登記）。

### Acceptance

- [x] `sqlite3 .data/db/sqlite.db "SELECT count(*) FROM sqlite_master WHERE sql LIKE '%_new(%'"` 回 0（驗證 2026-04-25）
- [x] 若 `.env` 未設 `NUXT_KNOWLEDGE_AI_SEARCH_INDEX`，`pnpm dev` 終端機清楚提示下一步（`scripts/check-dev-bootstrap-health.mjs` 實作，v0.43.2 `00e5314`）
- [ ] `nuxt.config.ts` `hub.db.applyMigrationsDuringDev: true`（或 NuxtHub upstream 把 dev 預設改 true）
- [ ] `rm -rf .data/db .wrangler/state/v3/d1/miniflare-D1DatabaseObject && pnpm dev` 後首次 `POST /_dev/login` + `/api/chat` 直接 200（**2026-04-25 實戰驗證為 500，根因 Problem #1 regression，等 opt-in 後重跑**）
- [ ] `fix-user-profile-id-drift` task 7.1 / 7.2 / 9.1 / 9.2 在 cleanroom 修好後追跑通過
- [ ] `/api/auth/me/credentials` 間歇性 500 已定位並修復（需 trace）

---

## TD-054 — `add-new-conversation-entry-points` Safari private mode 實機驗證

**Status**: open
**Priority**: low
**Discovered**: 2026-04-25 — `add-new-conversation-entry-points` archive 時 §7.6 使用者授權 skip
**Location**: `app/utils/chat-conversation-state.ts` `clearConversationSessionStorage` (try/catch QuotaExceededError)
**Related markers**: search `@followup[TD-054]` in repo

### Problem

`add-new-conversation-entry-points` archive 時，§7.6「Safari private mode 點任一新對話按鈕 → 仍能進新對話畫面、無 toast、無 console error」未本機 Safari 實測。`clearConversationSessionStorage` helper 已內建 try/catch 涵蓋 `QuotaExceededError` / DOM Storage disabled 等 edge case，理論上安全，但缺實機評估。

### Fix approach

打開 Safari → 開啟「私密瀏覽」視窗 → 進入 production / staging 對話頁面 → 走過三處新對話入口（chat header、sidebar expanded header、sidebar collapsed plus）。確認：

- 點按鈕後成功進入新對話畫面（messages 清空、active state reset）
- 無 toast notification 跳出
- DevTools console 無 error log（QuotaExceededError 應被 helper try/catch 吞掉）

### Acceptance

- [ ] Safari private window 三入口各跑一次成功
- [ ] DevTools console 無 error
- [ ] Status 標 `done`

---

## TD-056 — Workers AI judge 模型 `max_completion_tokens: 200` 上限被截斷 → JSON parse 失敗 → pipeline_error

**Status**: open
**Priority**: ~~low~~ **high**（2026-04-26 重評：TD-061 證明這條是 production 28.6% pipeline_error 的 root cause，不是低頻 cosmetic）
**Discovered**: 2026-04-26 — `persist-refusal-and-label-new-chat` v0.50.0 production 7.2 verify 抽查 `query_logs` 時意外撈到。Judge 模型回 JSON 結構包，但 `workers_ai_runs_json` 顯示 `completionTokens: 200` 等於上限，content 在 JSON object 中段被截斷，後續 `JSON.parse` throw → pipeline_error。
**Same root cause as**: TD-061（acceptance fixture 35 筆 10/10 pipeline_error 全部 `completionTokens: 200`，見 `local/reports/notes/td-061-pipeline-error-investigation-20260426.md`）
**Location**:

- judge prompt / model call 位置：`server/utils/workers-ai.ts`、`server/utils/judge.ts`（或對應 retrieve-then-judge orchestrator；apply 時再精準定位）
- 截斷觸發 query 樣本：production `query_logs.workers_ai_runs_json` 帶 `completionTokens: 200`（精確 query id 待 apply 時撈出）

**Related markers**: 無 tasks.md marker（本 entry 為發現紀錄；fix 會在獨立 change 處理）

### Problem

Workers AI 對 judge 模型呼叫設定 `max_completion_tokens: 200`，正常 judge JSON 多數在 ~150 tokens 內可結束，但少數 query（候選文件多 / reasoning 較長）會撞 200 token 上限：模型輸出在 JSON 中段被硬截 → 字串非合法 JSON → `JSON.parse(...)` throw → pipeline 走 refusal 路徑回 `pipeline_error`。

UX 影響有限：v0.50.0 已落地 persist-refusal，使用者會看到 refusal message + reason `pipeline_error`，不再「整個訊息消失」；但實際上是模型本來能回答、只是被 token 上限切斷。等於把可救援的查詢誤標 refused。

### Fix approach

兩條路擇一（apply 時用實機資料 sampling 決定）：

1. **抬高 `max_completion_tokens`**（例如 400 或 512）— 最低成本，但長尾 query 仍可能再撞牆
2. **Judge 模型輸出 schema 改 schema-constrained / structured output**（若 Workers AI 該模型支援 JSON mode / response_format）— 強制模型在預算內結束 JSON，超過則 partial 而非 mid-string truncation；搭配 fallback parser 容忍尾段不完整

兩條都要：

- 加 evlog 在 `completionTokens` 達 max 時記 wide event field（ex: `judge.token_truncated: true`），便於後續 production sampling
- pipeline_error 時保留 raw response snippet（前 N 字元）到 `query_logs`，方便事後 audit

### Acceptance

- [ ] Fix 部署後立即撈 production query_logs 連續 24-48h 樣本，驗 `judge.token_truncated: true` 或 `pipeline_error` 觸發次數收斂到 0（或對照 baseline 顯著下降）—— 取代原「過 7 天觀察」
- [ ] Local repro：把 judge max_completion 故意調 50 重現截斷 → 修復後 fix path 觸發、不 throw
- [ ] judge 模型呼叫具備 instrumentation，可區分「真正 refusal」vs「token-budget 截斷」

## TD-057 — evlog wide event lifecycle 警告：`log.error()` / `log.set()` 在 wide event emit 後呼叫，SSE stream 真實錯誤與結果欄位被吞

**Status**: open
**Priority**: mid
**Discovered**: 2026-04-26 — production `wrangler tail` 重複出現兩種同 root cause 的 warning：

```
[evlog] log.error() called after the wide event was emitted — Keys dropped: operation, error.
[evlog] log.set()   called after the wide event was emitted — Keys dropped: result.
```

**Production live tail 採樣（2026-04-26 21:38-21:40 UTC，6 條 chat）**：

| Warning 類型                                 | 次數 | 對應 chat 類型                                                        |
| -------------------------------------------- | ---- | --------------------------------------------------------------------- |
| `log.error()` keys dropped: operation, error | 3    | 全部對應 D1 `refusal_reason='pipeline_error'` 的 chat                 |
| `log.set()` keys dropped: result             | 3    | 對應 2 條 `no_citation` refusal + 1 條成功 chat（first_token=3245ms） |

兩種 warning 同 root cause：wide event 在 handler return 時已 emit，SSE `ReadableStream.start()` 內後續 `log.set()` / `log.error()` 都 race 失敗。

**Location**:

- `server/api/chat.post.ts` `createSseChatResponse` 的 `ReadableStream.start()` callback
- 上層 wide event 在 SSE response 建立時 emit 完畢；`start()` 內 stream pipe 若 throw，`catch` block 試圖 `log.error(err, { operation, error })` 已無 owning event，evlog 丟掉 keys

**Related markers**: 無 tasks.md marker（本 entry 為發現紀錄）

### Problem

evlog 設計上一個 request 對應一個 wide event。`createSseChatResponse` 把 SSE stream 建立後立即 return Response，wide event 在 handler 結束時 emit。SSE 內部的 `ReadableStream.start()` callback 是異步、長壽命：當 stream 中段 throw（例如 Workers AI fetch 中斷、token decode 失敗），catch handler 呼叫 `log.error(err, ...)` 時 wide event 已 emit，evlog 紀錄 warn + drop keys。

實際後果：production 看到 `pipeline_error` 但 wide event 缺 `operation` / `error` 細節，無法追真實錯誤；只能靠 `wrangler tail` 撈當下 console，過了就找不回。直接影響 SSE 路徑可觀察性。

### Fix approach

兩條路擇一（apply 時定）：

1. **`log.fork('sse-stream', fn)` 模式** — evlog 若支援 sub-event：在 `ReadableStream.start()` 內 fork 一個新的 wide event lifecycle，error 寫進 sub-event 而非 parent
2. **延後 wide event emit** — 把 wide event lifecycle 改成跨 stream（handler return 前不 emit，等 stream 自然結束或 abort 才 emit）；技術上需 evlog 支援「stream-aware」生命週期，或自寫 wrapper

兩條都需要：

- 整理當前 `createSseChatResponse` 的 wide event lifecycle 圖（哪個 emit、何時 emit）寫進 design / docs
- 確認其他 SSE / streaming endpoint 是否同樣 pattern（avoid one-off fix）

### Acceptance

- [ ] Production wrangler tail 不再出現 `[evlog] log.error() / log.set() called after the wide event was emitted` warning
- [ ] SSE stream 中段 error 可在 wide event / sub-event 中看到 `operation` + `error` keys
- [ ] SSE 成功路徑的 `result` field 也能保留（不再被 lifecycle drop）
- [ ] 其他 streaming endpoint 不再有相同 lifecycle 漏洞

## TD-058 — Production `user_profiles` 6 條 orphaned rows（profile.id 不在 user.id）

**Status**: open
**Priority**: low
**Discovered**: 2026-04-26 — TD-053 production 立即驗收時撈表發現 `profile_count=23` vs `user_count=17`
**Location**: production D1 `user_profiles` 表
**Related markers**: 無 tasks.md marker（本 entry 為發現紀錄；fix 會在獨立 change 處理）

### Problem

Production `user_profiles` 表有 6 條 orphaned row：`SELECT COUNT(*) FROM user_profiles WHERE id NOT IN (SELECT id FROM user)` 回 6。原因：`user_profiles.id` schema 為 `TEXT PRIMARY KEY` 而非 `REFERENCES user(id)`，無 FK + 無 cascade，因此 better-auth 自刪 user 時 `user_profiles` row 不會自動清理；此外 `fix-user-profile-id-drift` 之前的舊版 `session.create.before` hook 也可能在 stale row 情境下產生 id 漂移殘留。

非 functional bug（`user_profiles` 在無對應 `user` 時不會被任何 hot path 讀到），但會影響：

1. 報表 / 統計類 query 數字膨脹
2. UNIQUE `email_normalized` 假設未來重新註冊同 email 時可能踩到既有 orphaned row

### Fix approach

兩階段：

1. **觀察與分類**：撈這 6 條 orphaned row 的 `email_normalized` / `created_at` / `role_snapshot`，比對是否對應 better-auth `account.providerId='google'` 中已自刪的測試帳號或更早的 schema migration 殘留。判斷是否安全清除。
2. **清理**：寫 one-shot migration 或 SQL script 刪這 6 條（或保留有業務意義者）。一併評估是否將 `user_profiles.id` 改為 `REFERENCES user(id) ON DELETE CASCADE`（需謹慎，因為 better-auth 自刪 user 時的順序敏感）。

### Acceptance

- [ ] 6 條 orphaned row 已分類（業務 vs 殘留）並文件化於本 entry
- [ ] 清理腳本或 migration 落地，production `profile_count == user_count`（除預期保留）
- [ ] 評估 `user_profiles.id` 加 FK 的可行性與 ON DELETE 行為，決策結論寫在此 entry 或獨立 ADR

## TD-060 — Production `agentic-rag` AutoRAG 對 seed acceptance fixture 的 retrieval_score 全低於 directAnswer 門檻

**Status**: in-progress（實作於 change `rag-query-rewriting`，staging deploy 後驗收 acceptance evidence）
**Priority**: high
**Discovered**: 2026-04-26 — `main-v0.0.54-acceptance` run 對 production `https://agentic.yudefine.com.tw/mcp` 跑 35 筆 seed cases，D1 `query_logs` 顯示 `retrieval_score` 平均 0.32–0.44，全部 35 筆都低於 `thresholds.directAnswerMin=0.7`
**Location**: `production agentic-rag` AutoRAG index、`shared/schemas/knowledge-runtime` thresholds、`server/utils/knowledge-*` retrieval pipeline
**Related markers**: search `@followup[TD-060]` in repo

### Problem

`main-v0.0.54-acceptance-latency-run-20260426.md` 對 production 跑 35 筆 seed acceptance fixture，`query_logs.retrieval_score` 統計：

- mean ~0.36
- range 0.28–0.44
- **全部 35 筆 < `thresholds.directAnswerMin=0.7`**
- **全部 35 筆 < `thresholds.judgeMin=0.45`**

結果：

- 23 筆 `decision_path=no_citation_refuse`（治理層保守拒答）
- 10 筆 `decision_path=pipeline_error`（重測批次，見 TD-061）
- 2 筆 `decision_path=restricted_blocked`（TC-13 / r2，正確 scope 阻擋）

**0 筆**進入 `direct` / `judge_pass` / `self_corrected` 路徑。

影響：

- `main-v0.0.54-acceptance` 報告無法量化「實模型回答品質」（Judge 觸發率、引用正確率、回答正確率）
- 真實使用者若拿類似中文口語 prompt 問 `askKnowledge`，**也會 100% 走治理拒答路徑**
- 治理保險機制本身運作正確（不幻覺），但 RAG 實際可用性 = 0%

可能原因：

1. AutoRAG 索引 ingest 的文件主題跟 seed prompts 不對應（seed 是 ERP / SOP 主題）
2. AutoRAG embedding model（`@cf/qwen/qwen3-embedding-0.6b`）對中文口語匹配能力不足
3. Chunk 切分策略未讓 score 衝高
4. `thresholds.directAnswerMin=0.7` 對 AutoRAG score 分布來說設過高

### Fix approach

1. 檢查 production `agentic-rag` 索引內容（CF Dashboard 看 ingested 文件主題、筆數、最後 sync）
2. 抓最近一週 production `query_logs` 全量 `retrieval_score` 分布，看 P95；若 P95 都低於 0.7，調整 `directAnswerMin` 到實際分布合理值
3. 跑 AutoRAG re-index 用更精細 chunk size（256 tokens）
4. 若 1-3 都沒救：考慮換 embedding model 或補 reranker

### Acceptance

- [ ] Production `query_logs` 連續一週新樣本中至少 30% `decision_path != no_citation_refuse`
- [ ] 重跑 `main-v0.0.54-acceptance` 33 筆 fixture，至少 50% 拿到 direct / judge_pass / self_corrected
- [ ] thresholds 校正決策寫入 `docs/decisions/YYYY-MM-DD-rag-thresholds.md`

---

## TD-061 — Production `query_logs` 重測批次 `pipeline_error` 28.6%（10/35）

**Status**: open
**Priority**: high
**Discovered**: 2026-04-26 — `main-v0.0.54-acceptance` run 對 production 跑 50 筆 fixture（33 unique + 17 重測），D1 `query_logs.decision_path=pipeline_error` 出現 10 次，全部集中在 r2 重測批次
**Location**: `server/utils/knowledge-*`、`server/api/mcp/**`、production rate-limit、AutoRAG pipeline
**Related markers**: search `@followup[TD-061]` in repo

> **Acceptance dependency**：本 TD 的最終 acceptance 驗證依賴 change `rag-query-rewriting` ramp staging — 必須先讓 fixture 能進 judge gate（即 retrieval_score ≥0.45），才有真實 judge truncation 路徑可 verify TD-061 的 fix 是否消除 pipeline_error。

### Problem

對 production 跑 50 筆 fixture：

- 第 1–35 筆（33 unique seed + 前 2 筆 r2 重測）皆正常返回（`accepted` / `blocked`）
- 第 36–50 筆全部觸發 HTTP 429，未進 D1
- D1 已寫入的 35 筆裡，`pipeline_error` 10 筆樣本特徵：`completion_latency_ms = NULL`、`retrieval_score = NULL`、`judge_score = NULL`、`refusal_reason = pipeline_error`

10 筆對應的 prompt 包括 TC-05 / TC-06×2 / TC-12 / TC-13 / TC-14 / TC-18×2 / TC-20 / EV-01。

**2026-04-26 D1 raw evidence 調查**（詳見 `local/reports/notes/td-061-pipeline-error-investigation-20260426.md`）：

- 10/10 pipeline_error row 的 `workers_ai_runs_json` 都記錄了**唯一一筆** `agentJudge`（`@cf/moonshotai/kimi-k2.5`），且 `completionTokens` 全部剛好等於 200（max ceiling）
- 23 筆 `no_citation_refuse` 全部 `retrieval_score ∈ [0.28, 0.44]`（< `judgeMin=0.45`，judge 沒被觸發）
- 「r2 批次」框架其實是 score-banding 假象 — 真實切割線是 retrieval 是否落入 [judgeMin=0.45, directAnswerMin=0.7) → 進 judge → 100% 觸發 bug

**可能原因（按證據強度排序）**：

1. **HIGH (~85%)**：`server/utils/workers-ai.ts:135` agentJudge `max_completion_tokens: 200` 對於需要 `reformulatedQuery` 的 case 不夠 → 截斷 JSON → `normalizeStructuredResponse` (line 416-418) 直接呼叫 `JSON.parse` 對截斷字串拋 `SyntaxError` → web-chat.ts:426 catch block 寫 `pipeline_error` + 把 retrievalScore 寫為 NULL（line 447）
2. ~10%：Workers AI runtime 對 `response_format: json_schema` 的 grammar constraint 支援不完整，回傳非結構化字串
3. ~5%：cache key collision / pipeline 不冪等（**證據不支持**：每筆有獨立 judge latency，無共用 run 跡象）

影響：

- 真實使用者短時間重複問同 prompt 約**每 4 個請求就 1 個拿到 pipeline_error**
- 治理層保險仍正常（不幻覺、messages.content_text 不寫原文），但**使用者體驗顯示為「服務無回應 / 不穩定」**

### Fix approach

1. **驗證假設 1**：vitest unit test mock `readJudgeResponse` 對截斷 JSON 字串（如 `'{"shouldA'`）的行為，確認拋 `SyntaxError`
2. **修法（兩條軸線並行）**：
   - **軸線 A**：提高 agentJudge `max_completion_tokens` 至 512–1024（reformulatedQuery 中文重述 200 token 顯然不夠）
   - **軸線 B**：`readJudgeResponse` 加 truncation guard — 檢查 `response.usage.completion_tokens` 是否觸頂；若是則明確拋 `JudgeTruncationError`，catch block 寫 `decision_path=judge_truncated`
   - **軸線 C**：`normalizeStructuredResponse` 加 try/catch + jsonrepair fallback，部分結構可用就用
3. **拆 `pipeline_error` enum**：至少拆出 `judge_error` / `judge_truncated` / `retrieval_error` / `composer_error`，schema migration
4. **acceptance fixture 補 retrieval ∈ [0.45, 0.7] 的 case**：本批 35 筆都跑不到 judge 區間後又能 succeed，意味 judge 路徑長期沒有 production 監控
5. **與 TD-057 的關係**：TD-057 修不會自動解 TD-061（TD-057 是觀測層警告、TD-061 是功能層 bug，兩者獨立）；但 TD-057 修完後 wide event 會帶完整 stack，可作為 TD-061 fix verification 的驗證信號

### Acceptance

- [ ] 找出 10 筆 pipeline_error 的根因類別（至少分 2 類）
- [ ] 連續 50 筆同 prompt 重測，pipeline_error rate < 5%
- [ ] `decision_path` enum 擴張到分類錯誤（schema migration）
- [ ] Production 連續一週 pipeline_error rate baseline 寫入 `docs/verify/`

---

## TD-062 — Extract `buildRetrieveWithRewriter` helper across 3 entry points

**Status**: open
**Priority**: mid
**Discovered**: 2026-04-26 — `/commit` 0-A simplify review on change `rag-query-rewriting`
**Location**: `server/api/chat.post.ts:192-217`、`server/mcp/tools/ask.ts:128-154`、`server/mcp/tools/search.ts:79-106`
**Related markers**: search `@followup[TD-062]` in repo

### Problem

三個 entry point 都建立同一形狀的 retrieve closure：判斷 `input.useRewriter !== false && isQueryRewritingEnabled(runtimeConfig)`，組裝同樣 shape 的 `rewriteForRetrieval` 參數，呼叫 `retrieveVerifiedEvidence`。約 28 LoC × 3 = 重複面積大；未來要改 rewriter 接口要動三個檔。

### Fix approach

抽 `buildRetrieveWithRewriter({ runtimeConfig, event, search, store, governance, onRewriterOutcome? })` helper，回傳 `(input) => Promise<...>` closure。`chat.post.ts` / `mcp/tools/ask.ts` 透過 `onRewriterOutcome` callback 取得 last status / rewrittenQuery 寫進 audit；`mcp/tools/search.ts` 不需要。helper 放在 `server/utils/knowledge-query-rewriter.ts` 或 `server/utils/knowledge-retrieval.ts`。

### Acceptance

- 三個 entry point 各自從 ~28 LoC closure 縮成 ~5 LoC（call helper + optional callback）
- 既有 unit + integration test 全綠不需改
- `pnpm typecheck` 通過

---

## TD-063 — Trim duplicated `useRewriter` callback docstring

**Status**: open
**Priority**: low
**Discovered**: 2026-04-26 — `/commit` 0-A simplify review on change `rag-query-rewriting`
**Location**: `server/utils/knowledge-answering.ts:65-73`、`server/utils/web-chat.ts:186-193`、`server/utils/mcp-ask.ts:171-180`、`server/utils/mcp-search.ts:14-22`
**Related markers**: search `@followup[TD-063]` in repo

### Problem

四處 retrieve callback signature 都各自寫 6-9 行 docstring，重述「retry pass 必須 `useRewriter: false` 因為 reformulatedQuery 已是 LLM-shaped query」同一段話。違反專案規則「Default to writing no comments」「Don't reference the current task / fix / callers」。

### Fix approach

把完整 rationale 留在 `server/utils/knowledge-query-rewriter.ts` 開頭一份 canonical docstring；四個 callsite 縮成單行 `// see knowledge-query-rewriter.ts §S-RW for retry-pass rationale`。

### Acceptance

- 四個 callsite docstring ≤ 1 行
- canonical docstring 仍涵蓋 retry pass rationale
- `pnpm typecheck` 通過

---

## TD-064 — Integration test mocks DB; should be relocated or replaced with real D1

**Status**: open
**Priority**: mid
**Discovered**: 2026-04-26 — `/commit` 0-A code-review on change `rag-query-rewriting`
**Location**: `test/integration/retrieve-verified-evidence-with-rewriter.spec.ts`、`server/utils/knowledge-audit.ts:359-400`
**Related markers**: search `@followup[TD-064]` in repo

### Problem

`test/integration/retrieve-verified-evidence-with-rewriter.spec.ts` 用 `vi.fn()` mock 了 `search` 與 `resolveCurrentEvidence`，沒有真實 D1 / evidence store / `auditStore.updateQueryLog` round-trip。違反 `.claude/rules/testing-anti-patterns.md` 「no mocking DB in integration tests」。更關鍵：本 change 風險最高的程式碼之一—— `knowledge-audit.ts` 的 dynamic SET clause UPDATE—— **沒有任何 test 覆蓋 bind ordering / SQL composition**。未來開發者改 `setClauses` 順序會悄悄壞 audit 寫入。

### Fix approach

兩擇一：

- (a) 把這個 spec 移到 `test/unit/`，並為 audit dynamic UPDATE 另外寫一個 D1-backed integration test（in-memory `better-sqlite3` 或 D1 local），assert `rewriter_status` / `rewritten_query` 經完整 INSERT → UPDATE → SELECT round-trip 結果正確
- (b) 保留檔名位置但改寫內容用真實 D1，覆蓋 audit dynamic UPDATE 的 setClauses 順序

### Acceptance

- 至少一個 integration-tier test 對 audit dynamic UPDATE 用真實 D1 round-trip
- 測試 cover：rewriter_status / rewritten_query 都帶 / 都不帶 / 一個帶一個不帶 三種組合
- `pnpm test` 全綠

---

## TD-065 — `UpdateQueryLog.rewriterStatus` 型別與 NOT NULL 欄位不一致

**Status**: open
**Priority**: low
**Discovered**: 2026-04-26 — `/commit` 0-A code-review on change `rag-query-rewriting`
**Location**: `server/utils/knowledge-audit.ts:357-388`
**Related markers**: search `@followup[TD-065]` in repo

### Problem

`UpdateQueryLog.rewriterStatus` 型別宣告 `string | null`，但 `query_logs.rewriter_status` schema 是 `TEXT NOT NULL DEFAULT 'disabled'`。caller 傳 `null` 會 bind SQL NULL 進 NOT NULL 欄位 → D1 constraint error 包成 5xx。目前 caller 都從 `lastRewriterStatus: string = 'disabled'` 起手，永遠不傳 `null`，是 latent bug。

### Fix approach

1. `UpdateQueryLog.rewriterStatus?: string`（drop `| null`）
2. 確認 `bindings.push(input.rewriterStatus ?? null)` 改成 `bindings.push(input.rewriterStatus)`（undefined 已被 `setRewriterStatus` 旗標濾掉）
3. typecheck 通過

### Acceptance

- 型別不再允許 `null`
- typecheck + 既有 test 通過
- 加一條 unit test：傳 `'disabled'` / `'success'` / `'fallback_timeout'` 等都 round-trip 正確

---

## TD-066 — `RewriterStatus` discrimination 缺 `assertNever`

**Status**: open
**Priority**: low
**Discovered**: 2026-04-26 — `/commit` 0-A code-review on change `rag-query-rewriting`
**Location**: `server/utils/knowledge-retrieval.ts:137-138`
**Related markers**: search `@followup[TD-066]` in repo

### Problem

`rewriteResult.status === 'success' ? auditKnowledgeText(...).redactedText : null` 是單一 equality check，未走專案規定的 `switch + assertNever` pattern（見 `.claude/rules/development.md` 與 `ux-completeness.md` Exhaustiveness Rule）。將來新增 `RewriterStatus` 值（如 `fallback_blocked`）時不會 compiler error。

### Fix approach

```typescript
import { assertNever } from '~/utils/assert-never'

let rewrittenQueryForAudit: string | null
switch (rewriteResult.status) {
  case 'success':
    rewrittenQueryForAudit = auditKnowledgeText(rewriteResult.rewrittenQuery).redactedText
    break
  case 'fallback_timeout':
  case 'fallback_error':
  case 'fallback_parse':
    rewrittenQueryForAudit = null
    break
  default:
    assertNever(rewriteResult.status, 'retrieveVerifiedEvidence rewriter')
}
```

### Acceptance

- 新增 `RewriterStatus` 值（暫測 `fallback_blocked`）時 typecheck 立刻 fail
- 移除測試後既有 4 個 status 全綠
- `pnpm audit:ux-drift` 不報新漂移

---

## TD-067 — `test/tsconfig.json` baseline 191 errors

**Status**: open
**Priority**: mid
**Discovered**: 2026-05-04 — clade v0.3.10 cutover 把 test typecheck 加到 pre-push 階段時揭露
**Location**: `test/tsconfig.json` + 63 個 test files
**Related markers**: search `@followup[TD-067]` in repo

### Problem

`pnpm exec tsc -p test/tsconfig.json --noEmit` 跑出 **191 errors in 63 files**，分類：

- **Component module not found**（最大宗，TS2307）
  - `~/components/chat/MarkdownContent.vue`、`~/components/chat/ConversationHistory.vue`、`~/components/chat/RefusalMessage.vue`、`~/components/auth/DeleteAccountDialog.vue`、`~~/app/components/admin/usage/TimelineChart.vue`、`~~/app/components/debug/OutcomeBreakdown.vue` 等
  - 真實檔案存在，但 test path resolver 找不到（alias / Nuxt auto-import gap，`.nuxt/` types 或 test tsconfig paths 沒涵蓋）
- **Mock/fixture type drift**（TS2352）
  - `acceptance-auth/bindings/fixtures.test.ts`、`chat-route-heartbeat.spec.ts` 等的 fixture 跟 `ChatConversationMessage` 型別漂移（後者新增 `refused`、`refusalReason` 欄位）
- **Nitro route key inference 撞「excessive stack depth」**（TS2321）
  - `create-chat-conversation-history.spec.ts` — Nitro 端 type generic 太深
- **`legacy-test-roots.test.ts(6,8)` TS5097**
  - 缺 `allowImportingTsExtensions: true`
- **`middleware-admin.test.ts` 函式簽名漂移**
  - middleware 業務 signature 改成 2 args，test 只給 1
- **47× TS2345、22× TS18048** 跨 mcp/integration tests
- **`vitest.config.ts:130,140` TS2345**
  - vitest 4.x `TestProjectInlineConfiguration.plugins` 不接受 `unknown[]`，需顯式 cast 或 import 正確 type
- **`test/unit/sse-parser.spec.ts` TS2322**
  - `onBlock` callback 隱式 return widening（`Promise<string>` vs `Promise<'continue' | 'terminate'>`），需 `return 'continue' as const` 或顯式 type annotation

clade v0.3.10 把 test-tsconfig 放 pre-push 後立即擋下；clade v0.3.11 把該 check 從中央倉移除（因 5 家 consumer 中有 test/tsconfig.json 的 3 家裡 2/3 baseline 紅，hit rate 過高）。**目前不擋 push**，但 baseline 仍存在，是真實 type safety gap。

### Fix approach

按錯誤類型分批：

1. **Component module not found**（先做，最大宗）
   - 確認 path alias（`~/`、`@/`、`~~/`、`#shared/`）在 `test/tsconfig.json` paths 設定不全，或 Nuxt auto-import 沒對 test scope 生效
   - 修 `test/tsconfig.json` paths 或 `extends` 的 base map
2. **Mock/fixture type drift**：grep `ChatConversationMessage` fixture，補上新增欄位
3. **`legacy-test-roots.test.ts`**：加 `allowImportingTsExtensions: true` 到 test tsconfig
4. **`vitest.config.ts`**：plugins 加 `as PluginOption[]` cast，或 import 正確 type
5. **`sse-parser.spec.ts`**：onBlock callback return `'continue' as const` 或顯式 annotation
6. **Nitro route key excessive depth**：用 `as any` workaround 或升級 Nitro
7. **`middleware-admin.test.ts`**：找 middleware 真實 signature，補第二個 arg
8. **47× TS2345 / 22× TS18048**：per-file 分析（mock signature drift / `Object is possibly undefined` 補 narrow）

### Acceptance

`pnpm exec tsc -p test/tsconfig.json --noEmit` 0 errors。完成後可向 clade 中央倉爭取「opt-in 重啟 test-tsconfig pre-push check（hub.json flag）」— 但需先驗證至少 2 家 consumer baseline 也綠。

## TD-068 — deploy.yml 兩個 wrangler-action step 缺 `secrets:` list（違反 cf-workers/secrets.md rule）

**Status**: open
**Priority**: mid
**Discovered**: 2026-05-09 — clade v0.5.25 新增 `rules/modules/runtime/cf-workers/secrets.md` 後對 5 consumer 跑 verify checklist 揭露
**Location**: `.github/workflows/deploy.yml` — 「Deploy to Cloudflare Workers (production)」（line 156-163）+「Deploy to Cloudflare Workers (staging)」（line 254-261）
**Related markers**: search `@followup[TD-068]` in repo

### Problem

兩個 wrangler-action step 只有 `apiToken` / `accountId` / `command`，沒帶 `secrets: |` block。意味 worker runtime 用到的 secret（`BETTER_AUTH_SECRET` / `NUXT_SESSION_PASSWORD` / `ADMIN_EMAIL_ALLOWLIST` / `MCP_CONNECTOR_CLIENTS_JSON` 等）目前**不會在每次 deploy 時自動 sync** — 必須過去某個 session 手動跑 `wrangler secret put` 推上去，後續 rotation 容易脫節。

<div v-pre>

build env 那邊雖然有 `${{ secrets.PROD_BETTER_AUTH_SECRET }}` / `${{ secrets.STAGING_BETTER_AUTH_SECRET }}` 等，但那是 build-time 注入，build artifact 編進去；runtime secret 仍要走 wrangler secret API（wrangler-action `secrets:` list 或手動 `wrangler secret put`）。

</div>

違反 clade rule `rules/modules/runtime/cf-workers/secrets.md`：「Single source of truth = GitHub repo secret；MUST 在 deploy yaml 用 wrangler-action `secrets:` list 推進 worker；NEVER 手動 `wrangler secret put`」。

### Fix approach

1. 列出 production worker 跟 staging worker 實際 runtime 需要哪些 secret（`pnpm exec wrangler secret list` + 比對 server code 內 `process.env.X` 引用）
2. 確認 GitHub repo 對應的 `PROD_*` / `STAGING_*` Secret 都在
3. 改 deploy.yml 兩個 step：
   - 加 `secrets: |` list 列出所有 runtime secret name（worker 端的名稱，不帶前綴）
   - 加 `env:` block 對應 <code v-pre>${{ secrets.PROD_&lt;NAME&gt; }}</code> / <code v-pre>${{ secrets.STAGING_&lt;NAME&gt; }}</code>
4. 比對 Notion 是否有 agentic-rag 的 secret 紀錄頁面；無則補
5. 跑 staging deploy 驗證 `secrets:` list 自動 sync

### Acceptance

- `deploy.yml` 兩個 wrangler-action step 都有 `secrets: |` + `env:` block
- staging deploy run log 看到 `Found <N> secrets, uploading...` 訊息
- production worker / staging worker `wrangler secret list` 比對 GitHub Secret 內容一致
- Notion「GitHub Secrets & 環境變數」（或 agentic-rag 對應 page）有 secret 列表

### 為什麼登記不立即修

當下 session（2026-05-09 21:30）user 指示「先登記不處理」— agentic-rag 自家 worker 的 secret 拓樸需要時間 audit（多個 build env / runtime secret / NuxtHub bindings 混合），且觸碰 deploy workflow 風險高，要排獨立 session 處理。

## TD-069 — T3 evlog 落地 production 缺 D1 `evlog_events` migration（drain 在 prod 是 dead-write）

**Status**: open
**Priority**: high — T3 evlog 在 production 形同無作用，所有 wide event drain 都會 silently fail
**Discovered**: 2026-05-10 — clade HANDOFF §2.4 dev smoke 跑 `wrangler d1 execute agentic-rag-db --remote --command "SELECT count(*) FROM evlog_events"` 回 `no such table: evlog_events: SQLITE_ERROR [code: 7500]`
**Location**: `server/database/migrations/`（缺檔）+ `nuxt.config.ts` `@evlog/nuxthub` module wire（已 wire 但未生 migration）
**Related markers**: 對應 spectra change `archive/...adopt-evlog-nuxthub-ai-t3/` tasks §7.1-7.4 全部 unchecked

### Problem

T3 spec apply（commit `dbea28d`）後 `@evlog/nuxthub` module 已正確 wire 進 `nuxt.config.ts:96-114,119-124`，runtime drain plugin 也會在每筆 wide event 時嘗試 INSERT 進 D1 `evlog_events` table。但 production D1 從來沒這張 table — 因為 T3 apply 時沒跑 `pnpm hub:db:migrations:create` 把 `@evlog/nuxthub` 經 `hub:db:schema:extend` hook 注入的 schema 落成 drizzle migration。

驗證命令：

```bash
cd ~/offline/nuxt-edge-agentic-rag
export CLOUDFLARE_API_TOKEN=$(grep -E "^CLOUDFLARE_API_TOKEN=" .env | head -1 | cut -d= -f2-)
npx wrangler d1 execute agentic-rag-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%evlog%'"
```

回傳：空（沒任何 evlog\* table）。

`server/database/migrations/` 16 條 SQL（0001 → 0016）grep `evlog_events` 0 命中。

機制：`@evlog/nuxthub` `setup()` 內 `nuxt.hook('hub:db:schema:extend', ({ dialect, paths }) => paths.push(resolve2('./runtime/db/schema/events.${dialect}')))` 只負責**註冊** schema 到 nuxthub drizzle pipeline；要實際生成 migration 必跑 `pnpm hub:db:migrations:create`，不是 deploy 時自動執行。

### Impact

T3 evlog adoption 表面 audit clean（`drain.pipelineWraps=1 / nuxthub.moduleInstalled=1 / enrichers.installed=5`，audit script 0/4 block），但實際 production runtime 每筆 wide event drain 都會 INSERT 進不存在的 table → 失敗 → drain.js retry 3 次 → 全敗 → silently swallowed。**production 上 0 筆 evlog wide event 被持久化**。

對應 spectra change tasks §7.1（`SELECT count > 0`）/ §7.2（`event.ai.cost_usd` 寫入）/ §7.3（SSE child event 入 D1）/ §7.4（`event.actor.id` 在 D1 row）全部無法驗。

### Fix approach

```bash
cd ~/offline/nuxt-edge-agentic-rag
pnpm hub:db:migrations:create
# 應該產生 server/database/migrations/0017_<auto-name>.sql 含 CREATE TABLE evlog_events
ls server/database/migrations/
git diff server/database/migrations/    # 檢查 schema 是否符合 @evlog/nuxthub 預期
git add server/database/migrations/
git commit -m "🐛 fix(evlog): missing D1 migration for evlog_events table (TD-069)"
git push origin main   # staging deploy 自動套 migration
# 或對 production：tag + deploy production 路徑
```

deploy 完跑：

```bash
npx wrangler d1 execute agentic-rag-db --remote --command "SELECT count(*) FROM evlog_events"
# 應回非 0（@evlog/nuxthub drain 開始 INSERT 後）
```

### Acceptance

- production D1 `evlog_events` table 存在
- `SELECT count(*) FROM evlog_events WHERE created_at > now() - interval '1 hour'` > 0（chat endpoint 觸發後）
- `event.ai.cost_usd / event.ai.tokens / event.ai.tool_calls` 在新 row 內可查
- spectra change `adopt-evlog-nuxthub-ai-t3/tasks.md §7.1-7.4` 可勾完成

### 風險

`pnpm hub:db:migrations:create` 會根據 drizzle schema diff 生 migration。若 nuxthub `events.sqlite` schema 跟 production D1 已有 schema 有 indirectly conflict（例如 index name 撞），需 review migration SQL 再 commit。**不要直接 `migrations:create` 後盲 push**。

---

## TD-070 — rag-query-rewriting 人工檢查對齊新 manual-review 規範

**Status**: open  
**Priority**: mid  
**Discovered**: 2026-05-12 — clade v1.3.6 manual-review.md 新增 Pre-Review Data Readiness + `[review:ui]` 收斂原則 + verify channel marker schema（散播到 consumer LOCKED 投影）  
**Location**: `openspec/changes/rag-query-rewriting/tasks.md` `## 人工檢查` section（items 1-7）  
**Related markers**: 此 TD 屬「整批 ingest 工作」追蹤，不在 tasks.md 內標 `@followup` marker

### Problem

`rag-query-rewriting` 的 `## 人工檢查` 7 items 未標 marker。按 clade v1.3.6 新規 manual-review.md「Fallback ≠ 允許省略」：所有新寫或 ingest 修改的 items **MUST** 顯式標 marker。7 items 內容多屬 staging acceptance evidence 抽查（retrieval_score / latency p95 / fallback rate / 抽 `query_log_debug` 記錄 / production safety check / Decision Q1 / Decision Q2）→ 該全部標 `[discuss]`（Claude 主導 evidence 收集 + user walkthrough 拍板）。

User 決定本次 session **登記不處理**（2026-05-12 對話中明示「agentic-rag 全部都登記 不處理」）。

### Fix approach

對 7 items 各加 `[discuss]` marker（schema: `- [ ] #N [discuss] <description> @no-screenshot` if applicable）。逐項 evidence 在 spectra-archive Step 2.5 Discuss Walkthrough 流程由 Claude 準備、user 拍板 OK 後寫 `(claude-discussed: <ISO>)` annotation。Items 1-7 對應動作：

- #1-#3：retrieval_score / latency / fallback rate — 對應 task §6.5 acceptance evidence
- #4：抽 3 條 staging `query_log_debug` 記錄人工判斷改寫合理性
- #5：production safety check（features.queryRewriting=false）
- #6-#7：Decision Q1/Q2 商業判斷

### Acceptance

- 7 items 都有 `[discuss]` marker
- `archive-gate.sh` Check 4 驗 `[discuss]` items 都有 evidence trail 或勾選
- `spectra-archive` 可通過 manual-review hygiene gate

---

## TD-071 — deploy-workflow contract test 對 workflow 原文無錨點斷言、未剝除註解

**Status**: open
**Priority**: mid
**Discovered**: 2026-07-29 — clade `pitfall-config-assertion-satisfied-by-own-comment` 的跨 consumer 掃描
**Location**: `test/unit/deploy-workflow-config.test.ts`、`test/unit/deploy-workflow-passkey-env.test.ts`

### Problem

兩個 test 讀 `.github/workflows/*.yml` 的**原文**做字面斷言，共 26 條無錨點 `toContain` + 2 條 `not.toContain`，**0 處剝除註解**。註解為了解釋實作會逐字引用實作，因此只要被斷言的字串同時出現在註解裡，把實作刪掉斷言仍成立 —— 測試恆綠；反向的 `not.toContain` 則是註解命中造成誤報。

2026-07-29 逐條掃描（比對每個被斷言字面值是否出現在目標檔註解行）**沒有找到當下已恆真的斷言**，屬潛在形態不是現行缺陷。

同 repo 內的 `test/unit/ci-gate.test.ts`、`test/unit/staging-gate.test.ts` 不在此列 —— 它們對匯出的純函式（`evaluateCiGate` / `evaluateStagingGate`）跑 in-test fixture，從不讀 workflow 檔，結構上免疫，可作為本 repo 的正解範例。

### Fix approach

依 clade `rules/core/testing-anti-patterns.md` §「對設定檔原文的斷言，標的是行為本身」：

1. 讀進 workflow 後先建行為 view（濾掉 `/^\s*#/` 的行），所有行為斷言改綁該 view；或改用 YAML parser 對節點斷言
2. 每條斷言附一次 mutation 證明（改壞被鎖的那行、確認轉紅），在 repo 外的複本上跑
3. 更根本的選項：比照 ci-gate / staging-gate，把判斷邏輯抽成純函式再對函式測試

### Acceptance

- 兩個 test 的行為斷言不再直接綁含註解的原文
- 對其中任一條斷言做 mutation 可觀察到轉紅
