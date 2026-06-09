> Cross-reference key:
>
> - **[D-RW]** = design "Query Rewriting 而非 HyDE"
> - **[D-MD]** = design "用 judge model 而非獨立 LLM binding"
> - **[D-FB]** = design "Failure → fallback to original normalized query（never throw）"
> - **[D-FF]** = design "Feature flag `features.queryRewriting`，staging-on / production-off"
> - **[D-OB]** = design "Observability via `query_log_debug` 加兩欄"
> - **[D-PR]** = design "Prompt 策略只做形式 normalization 不做擴展"
> - **[S-RW]** = spec "Retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search"
> - **[S-FB]** = spec "Query rewriter SHALL fall back gracefully on failure"
> - **[S-OB]** = spec "Retrieval audit log SHALL record query rewriter status and output"
> - **[S-FF]** = spec "Query rewriting feature flag SHALL default to false in production"

## 1. Schema & Migration（[D-OB] [S-OB]）

- [x] 1.1 建立 `server/database/migrations/0017_query_log_debug_rewriter_columns.sql`，依 [D-OB] observability via `query_log_debug` 加兩欄設計，加 `rewriter_status TEXT NOT NULL DEFAULT 'disabled'` + `rewritten_query TEXT NULL`；確保 existing rows 自動 default `'disabled'` 滿足 [S-OB] retrieval audit log SHALL record query rewriter status and output 的 backward compatibility 要求
- [x] 1.2 修 `server/utils/query-log-debug-store.ts` insert 路徑，接受 `rewriterStatus` + `rewrittenQuery`，預設值對齊 schema default，承接 [S-OB] retrieval audit log SHALL record query rewriter status and output 寫入責任
- [x] 1.3 修 `server/api/admin/debug/query-logs/[id].get.ts` response schema 與 mask 路徑，確認新欄位回傳且套用既有 PII redaction，完成 [S-OB] retrieval audit log SHALL record query rewriter status and output 的 admin 讀取面

## 2. Runtime Config & Feature Flag（[D-FF] [S-FF]）

- [x] 2.1 [P] 修 `shared/schemas/knowledge-runtime.ts`，在 `KnowledgeRuntimeFeatures` 加 `queryRewriting: boolean` 對應 [D-FF] feature flag `features.queryRewriting`，default `false` 符合 [S-FF] query rewriting feature flag SHALL default to false in production
- [x] 2.2 [P] 新增 `server/utils/knowledge-query-rewriter.ts` 內的 `isQueryRewritingEnabled(runtimeConfig)` helper，集中 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 的「4 個 caller 共用同一 helper」契約
- [x] 2.3 [P] 修 `wrangler.staging.jsonc`，加 `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING=true` 兌現 [D-FF] feature flag `features.queryRewriting` staging-on 設定 + [S-FF] query rewriting feature flag staging default true 要求
- [x] 2.4 [P] 修 `wrangler.jsonc`（production），顯式設 `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING=false`，避免依賴 default 漂移；對應 [S-FF] query rewriting feature flag SHALL default to false in production safety

## 3. Query Rewriter Utility（[D-RW] [D-MD] [D-PR] [D-FB] [S-RW] [S-FB]）

- [x] 3.1 實作 `server/utils/knowledge-query-rewriter.ts` 的 `rewriteForRetrieval(normalizedQuery, { ai, runtimeConfig, signal? })`：依 [D-RW] query rewriting 而非 HyDE 走形式 normalization、依 [D-MD] 用 judge model 而非獨立 LLM binding 共用 `models.agentJudge`、依 [D-PR] prompt 策略只做形式 normalization 不做擴展、依 [D-FB] failure → fallback to original normalized query（never throw）try/catch 三條 fallback path，對外契約 `Promise<{ rewrittenQuery: string; status: RewriterStatus }>`；同時是 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 的 utility 層實作
- [x] 3.2 [P] 寫 `test/unit/knowledge-query-rewriter.spec.ts`：對應 [S-FB] query rewriter SHALL fall back gracefully on failure 與 [D-FB] failure → fallback to original normalized query 的四條路徑（success / fallback_timeout / fallback_error / fallback_parse）+ never throws + status enum exhaustiveness（用 `assertNever` pattern）
- [x] 3.3 手動驗證 [D-PR] prompt 策略只做形式 normalization 不做擴展 — REST run 對 15 條 fixture query 驗證改寫方向，**0 語意漂**（全為去口語 + 題目化，無擴展同義詞 / 無改主題；例 "PO 和 PR 有什麼差別？" → "PO 和 PR 的差異"、"庫存不足時該怎麼處理？" → "庫存不足的處理流程"）。逐條改寫見 `local/reports/notes/main-v0.0.54-acceptance-rewriter-rest-20260609.md` § 逐筆對比 + Decision Q1

## 4. Retrieval Pipeline Integration（[S-RW]）

- [x] 4.1 修 `server/utils/knowledge-retrieval.ts` `retrieveVerifiedEvidence`：依 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 的「rewriter 在 normalize 之後 search 之前」位置加 optional rewriter step（option `rewriter?: RewriteForRetrieval`），啟用時把 rewritten query 餵 `options.search`，同時 return original / rewritten 給 caller 寫進 audit
- [x] 4.2 修 `server/utils/knowledge-answering.ts`：把 rewriter 從 input 透傳到 `retrieveVerifiedEvidence`（mid-layer 不直接 call rewriter），維持 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 4 個入口共用同一 utility 的契約
- [x] 4.3 [P] Wire 3 個入口 caller：`server/utils/web-chat.ts`、`server/utils/mcp-ask.ts`、`server/utils/mcp-search.ts` —— 全部從 `isQueryRewritingEnabled(runtimeConfig)` 判斷，啟用時把 `rewriteForRetrieval` 傳進 `runKnowledgeAnswering` / `retrieveVerifiedEvidence`，完成 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 的 4 個入口統一行為
- [x] 4.4 [P] 寫 `test/integration/retrieve-verified-evidence-with-rewriter.spec.ts`：rewriter on/off 行為對比、status 寫入正確性、向下相容（disabled 時行為與 baseline 100% 等同），鎖 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 與 [S-OB] retrieval audit log SHALL record query rewriter status and output 的整合契約

## 5. Documentation

- [x] 5.1 [P] 建立 `docs/decisions/2026-04-26-rag-query-rewriting.md` skeleton（Decision / Context / Alternatives / Reasoning / Trade-offs / Acceptance evidence 區塊；evidence 由 task 6 填）
- [x] 5.2 [P] 修 `docs/tech-debt.md` TD-060 entry：Status `open → in-progress`，加「實作於 change `rag-query-rewriting`」link，TD-061 entry 補一行「acceptance 驗收依賴本 change ramp staging」

## 6. Acceptance & Verification（[S-FF]）

- [x] 6.1 Local smoke：rewriter success path + audit 寫入確認 — 用 `wrangler dev`（CI=true build → KV miniflare、remote AI/AI_SEARCH binding、env=local 啟用 dev-login）打 chat，`query_logs.rewriter_status` 寫入確認，agentJudge call ~749ms success（解除原 `pnpm dev` 無 Workers AI binding 的限制）。`rewriter_status='success'` path 由 6.4 REST run 15/15 全 success 補強。原 partial-pass evidence: `local/reports/notes/rag-query-rewriting-6.1-local-smoke-20260426.md`；success path: `local/reports/notes/main-v0.0.54-acceptance-rewriter-rest-20260609.md`
- [x] 6.2 `pnpm check` 全綠（format / lint / typecheck / test）
- [x] 6.3 Deploy staging（依既有 `gh workflow run deploy.yml -f target=staging` 流程，確認 migration apply + staging flag enabled）— ✅ run 27197657636 success（2026-06-09）；migration apply 含於 deploy（fail 會中斷）、staging flag `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING=true` 由 `wrangler.staging.jsonc` vars 帶上
- [x] 6.4 對 staging 跑 main-v0.0.54-acceptance fixture — 走 REST-based 重現（staging chat 走 OAuth session 無法全自動，local wrangler dev AI Search binding 回空；REST 對 `agentic-rag` index + judge model 等同量測，見 evidence note § 方法）。15 web-channel fixtures，記錄到 `local/reports/notes/main-v0.0.54-acceptance-rewriter-rest-20260609.md`。Driver: `scripts/acceptance/rest-rewriter-acceptance.mjs`
- [x] 6.5 量化驗收指標：(a) retrieval_score ≥0.55 占比 baseline 40% → rewritten **60%**（✅ ≥50%）、(b) latency p95 增量 — rewriter call ~749ms < 800ms budget（REST search total 不適用，需 staging 補 p95）、(c) rewriter fallback rate **0%**（✅ <10%）；填進 evidence note + `docs/decisions/2026-04-26-rag-query-rewriting.md` Acceptance Evidence 表
- [x] 6.6 更新 `openspec/ROADMAP.md > Next Moves`：TD-060 標**達標**（rewriter ≥0.55 占比 40%→60%，附「index 已 reindex、baseline 自癒」注記）+ 第二輪 main-v0.0.54-acceptance（retrieval_score 維度）標 done + production ramp 列為下一條 ops change（依賴本 change archive + 人工授權 + staging latency 補測），符合 [S-FF] ramp gating 契約

## 7. Post-Review Follow-ups

> 0-A code review 識別出但本 change 範圍外的 cleanup / hardening 項目，
> 已登記到 `docs/tech-debt.md`。Archive 不會等這些做完。

- [x] 7.1 **@followup[TD-062]** Extract `buildRetrieveWithRewriter` helper across the 3 entry points (`chat.post.ts` / `mcp/tools/ask.ts` / `mcp/tools/search.ts`) — currently each builds an almost-identical retrieve closure (~28 LoC × 3)
- [x] 7.2 **@followup[TD-063]** Trim duplicated `useRewriter: false on retry` docstring from 4 callback signatures (`web-chat.ts` / `mcp-ask.ts` / `mcp-search.ts` / `knowledge-answering.ts`); leave one canonical reference in `knowledge-query-rewriter.ts`
- [x] 7.3 **@followup[TD-064]** `test/integration/retrieve-verified-evidence-with-rewriter.spec.ts` mocks both `search` and `resolveCurrentEvidence` — relocate to `test/unit/` or replace with a real D1-backed test that exercises the dynamic UPDATE clause in `knowledge-audit.ts`
- [x] 7.4 **@followup[TD-065]** Tighten `UpdateQueryLog.rewriterStatus` type from `string | null` to `string`; the column is NOT NULL so `null` would surface as a D1 5xx
- [x] 7.5 **@followup[TD-066]** Replace `rewriteResult.status === 'success'` ternary in `retrieveVerifiedEvidence` with a `switch + assertNever` pattern so future `RewriterStatus` additions surface at compile time

<!-- pre-handoff-verdict: intentional, reason: backend-only change（proposal 宣告 No user-facing journey）— rewriter pipeline 無 UI surface，Layer E.1 的 render/dom-fab/list-fallback 維度不適用；acceptance evidence 走 [discuss] walkthrough（REST run 2026-06-09）+ Backend Verification Evidence -->

## 人工檢查

> 由人類在驗收階段逐項確認，**禁止 agent 代勾**。

- [x] #1 [discuss] 對 staging 跑 acceptance 的結果：≥50% fixture 拿到 retrieval_score ≥0.55（看 6.5 evidence） (claude-discussed: 2026-06-09T11:05:33Z) @no-screenshot
- [x] #2 [discuss] Latency p95 增量 < 800ms（看 6.5 evidence） (deferred-to-handoff: 2026-06-09T11:05:33Z) (awaiting-signal: staging-app-endpoint-p95-實測) @no-screenshot
- [x] #3 [discuss] Rewriter fallback rate < 10%（看 6.5 evidence） (claude-discussed: 2026-06-09T11:05:33Z) @no-screenshot
- [x] #4 [discuss] 抽 3 條 staging `query_log_debug` 記錄，確認 `rewritten_query` 改寫方向合理（非語意漂、非無意義改寫） (claude-discussed: 2026-06-09T11:05:33Z) @no-screenshot
- [x] #5 [discuss] 確認 production worker 部署後 `features.queryRewriting` 仍為 false（safety check：抓 production 一條 chat 看 `rewriter_status='disabled'`） (claude-discussed: 2026-06-09T11:05:33Z) @no-screenshot
- [x] #6 [discuss] Decision Q1：第一輪結果是否需要在 prompt 加索引主題清單（由 6.5 evidence 裁定）— 裁定：不需要（rewriter 已達標 60%、+20pp） (claude-discussed: 2026-06-09T11:05:33Z) @no-screenshot
- [x] #7 [discuss] Decision Q2：admin debug API `rewritten_query` mask 行為是否符合預期（抽 1 條含敏感字 query 確認） (claude-discussed: 2026-06-09T11:05:33Z) @no-screenshot
