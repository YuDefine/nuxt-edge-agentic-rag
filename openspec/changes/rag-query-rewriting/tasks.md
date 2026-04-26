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
- [ ] 3.3 手動驗證 [D-PR] prompt 策略只做形式 normalization 不做擴展 對 5 條 fixture query（"PO 和 PR 差別"、"庫存不足怎麼辦"、"怎麼請假"、"系統登入問題"、"請列出目前的知識類別"）的改寫結果，記錄到 `local/reports/notes/td-060-query-rewriter-prompt-validation-20260426.md`，回頭驗證 [D-RW] query rewriting 而非 HyDE 的 leverage 假設

## 4. Retrieval Pipeline Integration（[S-RW]）

- [x] 4.1 修 `server/utils/knowledge-retrieval.ts` `retrieveVerifiedEvidence`：依 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 的「rewriter 在 normalize 之後 search 之前」位置加 optional rewriter step（option `rewriter?: RewriteForRetrieval`），啟用時把 rewritten query 餵 `options.search`，同時 return original / rewritten 給 caller 寫進 audit
- [x] 4.2 修 `server/utils/knowledge-answering.ts`：把 rewriter 從 input 透傳到 `retrieveVerifiedEvidence`（mid-layer 不直接 call rewriter），維持 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 4 個入口共用同一 utility 的契約
- [x] 4.3 [P] Wire 3 個入口 caller：`server/utils/web-chat.ts`、`server/utils/mcp-ask.ts`、`server/utils/mcp-search.ts` —— 全部從 `isQueryRewritingEnabled(runtimeConfig)` 判斷，啟用時把 `rewriteForRetrieval` 傳進 `runKnowledgeAnswering` / `retrieveVerifiedEvidence`，完成 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 的 4 個入口統一行為
- [x] 4.4 [P] 寫 `test/integration/retrieve-verified-evidence-with-rewriter.spec.ts`：rewriter on/off 行為對比、status 寫入正確性、向下相容（disabled 時行為與 baseline 100% 等同），鎖 [S-RW] retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search 與 [S-OB] retrieval audit log SHALL record query rewriter status and output 的整合契約

## 5. Documentation

- [x] 5.1 [P] 建立 `docs/decisions/2026-04-26-rag-query-rewriting.md` skeleton（Decision / Context / Alternatives / Reasoning / Trade-offs / Acceptance evidence 區塊；evidence 由 task 6 填）
- [x] 5.2 [P] 修 `docs/tech-debt.md` TD-060 entry：Status `open → in-progress`，加「實作於 change `rag-query-rewriting`」link，TD-061 entry 補一行「acceptance 驗收依賴本 change ramp staging」

## 6. Acceptance & Verification（[S-FF]）

- [ ] 6.1 Local smoke：`pnpm dev` + 在瀏覽器 / curl 打 2 條 chat（一條子知識問答 form、一條題目複述 form），確認 `query_log_debug.rewriter_status` 寫入、`rewritten_query` 內容合理
- [x] 6.2 `pnpm check` 全綠（format / lint / typecheck / test）
- [ ] 6.3 Deploy staging（依既有 `gh workflow run deploy.yml -f target=staging` 流程，確認 migration apply + staging flag enabled）
- [ ] 6.4 對 staging 跑 main-v0.0.54-acceptance 35 筆 fixture，記錄到 `local/reports/notes/main-v0.0.54-acceptance-rewriter-staging-{date}.md`
- [ ] 6.5 量化驗收指標：(a) retrieval_score 分布（≥0.55 占比）、(b) p95 latency 增量 vs baseline、(c) rewriter_status 分布（fallback rate）；填進 6.4 evidence note + `docs/decisions/2026-04-26-rag-query-rewriting.md` Acceptance evidence 區塊
- [ ] 6.6 更新 `openspec/ROADMAP.md > Next Moves`：TD-060 標達標 / 不達標 + 解鎖第二輪 main-v0.0.54-acceptance + production ramp 列為下一條 ops change（依賴本 change archive），符合 [S-FF] query rewriting feature flag SHALL default to false in production 的 ramp gating 契約

## 7. Post-Review Follow-ups

> 0-A code review 識別出但本 change 範圍外的 cleanup / hardening 項目，
> 已登記到 `docs/tech-debt.md`。Archive 不會等這些做完。

- [ ] 7.1 **@followup[TD-062]** Extract `buildRetrieveWithRewriter` helper across the 3 entry points (`chat.post.ts` / `mcp/tools/ask.ts` / `mcp/tools/search.ts`) — currently each builds an almost-identical retrieve closure (~28 LoC × 3)
- [ ] 7.2 **@followup[TD-063]** Trim duplicated `useRewriter: false on retry` docstring from 4 callback signatures (`web-chat.ts` / `mcp-ask.ts` / `mcp-search.ts` / `knowledge-answering.ts`); leave one canonical reference in `knowledge-query-rewriter.ts`
- [ ] 7.3 **@followup[TD-064]** `test/integration/retrieve-verified-evidence-with-rewriter.spec.ts` mocks both `search` and `resolveCurrentEvidence` — relocate to `test/unit/` or replace with a real D1-backed test that exercises the dynamic UPDATE clause in `knowledge-audit.ts`
- [ ] 7.4 **@followup[TD-065]** Tighten `UpdateQueryLog.rewriterStatus` type from `string | null` to `string`; the column is NOT NULL so `null` would surface as a D1 5xx
- [ ] 7.5 **@followup[TD-066]** Replace `rewriteResult.status === 'success'` ternary in `retrieveVerifiedEvidence` with a `switch + assertNever` pattern so future `RewriterStatus` additions surface at compile time

## 人工檢查

> 由人類在驗收階段逐項確認，**禁止 agent 代勾**。

- [ ] 1. 對 staging 跑 acceptance 的結果：≥50% fixture 拿到 retrieval_score ≥0.55（看 6.5 evidence）
- [ ] 2. Latency p95 增量 < 800ms（看 6.5 evidence）
- [ ] 3. Rewriter fallback rate < 10%（看 6.5 evidence）
- [ ] 4. 抽 3 條 staging `query_log_debug` 記錄，確認 `rewritten_query` 改寫方向合理（非語意漂、非無意義改寫）
- [ ] 5. 確認 production worker 部署後 `features.queryRewriting` 仍為 false（safety check：抓 production 一條 chat 看 `rewriter_status='disabled'`）
- [ ] 6. Decision Q1：第一輪結果是否需要在 prompt 加索引主題清單（由 6.5 evidence 裁定）
- [ ] 7. Decision Q2：admin debug API `rewritten_query` mask 行為是否符合預期（抽 1 條含敏感字 query 確認）
