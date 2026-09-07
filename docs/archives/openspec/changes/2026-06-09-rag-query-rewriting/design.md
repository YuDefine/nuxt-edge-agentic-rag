## Context

RAG retrieval 入口 `retrieveVerifiedEvidence` (`server/utils/knowledge-retrieval.ts:86-143`) 目前流程：

```
input.query
  → normalizeKnowledgeQuery (抽 category hints + replacement dictionary + trim)
  → options.search({ query: normalized.normalizedQuery, ... })  // AutoRAG / Cloudflare AI Search
  → 對 candidates 做 resolveCurrentEvidence → VerifiedKnowledgeEvidence[]
```

呼叫者 4 個：`web-chat.ts`、`mcp-ask.ts`、`mcp-search.ts`、`knowledge-answering.ts`。共用 `KnowledgeGovernanceConfig.thresholds`（`directAnswerMin`、`judgeMin`）決定 decisionPath。

診斷 note `local/reports/notes/td-060-retrieval-score-diagnosis-20260426.md` 的 7 天 production 樣本顯示：5 筆 ≥0.7 全是「採購流程」題目複述變體（→ direct_answer），fixture 子知識問答 form 全部 <0.45（→ no_citation_refuse）。Embedding 對 query form vs 索引 form 的詞彙重疊度敏感，跟模型/threshold/chunk 都不相關。

第二輪 main-v0.0.54-acceptance + TD-061/056 truncation fix（v0.52.1 已 ship）的驗收都被卡在這——fixture 從沒到達 judge gate。

## Goals / Non-Goals

**Goals:**

- 在 retrieval 前加一步 LLM-based query rewriting，把 user query 改寫成「題目複述形式」，目標 ≥50% acceptance fixture 拿到 retrieval_score ≥0.55 進 judge gate
- 維持 4 個 caller 的對外 contract 100% 不變（向下相容）
- Failure mode 完整：rewriter LLM 失敗時 graceful fallback 用 original normalized query，不阻擋 retrieval
- Observability：`query_log_debug` 加 `rewriter_status` + `rewritten_query` 兩欄做事後 audit
- Feature flag 控制 ramp：staging 先 enable 跑 acceptance、production 先 disable，ramp 由後續 ops change 處理

**Non-Goals:**

- 不引入 HyDE（產假設答案）/ reranker（BGE）/ chunk 重切 / 降 thresholds（diagnosis #2/#3/#4/#5）—— 留作 escalation / follow-up TD
- 不改 embedding 模型、不重 ingest 索引
- 不擴展 acceptance fixture 主題覆蓋（屬 TD-050 staging R2 seed 範圍）
- 不在本 change 內 ramp production（決策路徑由 acceptance evidence + decision doc 驅動）
- 不加 KV cache（query 重複率低，先驗證 leverage 後再評估）

## Decisions

### Query Rewriting 而非 HyDE

選 query rewriting：把 user query 改寫成「索引內可能出現的句式」，而非 HyDE（讓 LLM 產整段假設答案再 embed）。

**Why**: token cost 低（256 vs 1024+ output tokens）、latency 預算寬（單次短 LLM call）、prompt 容易調試、failure 影響範圍小（rewritten string 仍是合理 query）。HyDE 在 root cause 確定後若 rewriting 不夠才作為 escalation。

**Alternatives**: HyDE — token cost 4x、p95 latency +1.2-2s、failure 模式更激進（產 hallucination → 整段 embed → 召回完全錯誤主題）。

**Trade-off**: 形式 normalization 不如 HyDE 激進，對「太短的問詞型 query」（如「PR 是什麼」）改寫空間有限。Acceptance 不達標時的升級路徑在 Risks/Trade-offs 寫明。

### 用 judge model 而非獨立 LLM binding

Rewriter 共用 `KnowledgeGovernanceConfig.models.agentJudge` 的 model binding（同 timeout / AI Gateway / 預算治理），但獨立 prompt template + 獨立 `max_completion_tokens: 256`。

**Why**: 少一個 model 變數（升 model 時不會漏 sync）、共用既有 AI Gateway / cache / log infrastructure、判斷類任務跟 rewriting 屬性接近（判斷 retrieval 是否成立 vs 重述 query）。

**Alternatives**: `@cf/meta/llama-3.1-8b-instruct` 獨立綁定 — 多一個 model 變數、需要新 governance 欄位。

**Trade-off**: judge model 改變時 rewriter 跟著走，需在 `docs/decisions/2026-04-26-rag-query-rewriting.md` 寫明此綁定。

### Failure → fallback to original normalized query（never throw）

`rewriteForRetrieval` 內部 try/catch：LLM timeout / 5xx / JSON parse error 一律 fallback return original normalized query，並記 `rewriter_status = 'fallback_<reason>'`。對外 contract 永遠 return `string`，永不 throw。

**Why**: rewriter 是 retrieval 的 enhancement，不是 critical path；rewriter 故障不應讓 chat / MCP 拒答（會放大 outage 範圍）。

**Alternatives**: throw error → caller 決定降級 — 4 個 caller 都要寫 try/catch，重複邏輯且風險每個 caller 不一致。

**Trade-off**: fallback rate 高時症狀被掩蓋；用 `rewriter_status` 統計鎖 SLO（fallback rate > 10% 視為退化）。

### Feature flag `features.queryRewriting`，staging-on / production-off

新增 `KnowledgeRuntimeFeatures.queryRewriting: boolean`，staging default `true`、production default `false`。

**Why**: rewriter 影響 retrieval 召回品質（可能改善也可能漂），需要先在 staging 跑 acceptance fixture 拿證據再 ramp production。production ramp 由後續 ops change 處理（不在本 change scope）。

**Alternatives**:

- 直接 production-on：風險未知、無 acceptance evidence 支持
- A/B 抽樣：增加 scope（query log 要記 variant、acceptance 報表要分組），收益小（流量本來就稀疏）

**Trade-off**: production 第一輪不能立刻得到收益；換 acceptance evidence 確證 root cause 解開的踏實感。

### Observability via `query_log_debug` 加兩欄

既有 `query_log_debug` 是 retrieval audit truth source。新增：

- `rewriter_status TEXT NOT NULL DEFAULT 'disabled'` — `disabled` / `success` / `fallback_timeout` / `fallback_error` / `fallback_parse`
- `rewritten_query TEXT NULL` — rewrite 成功時記，fallback 時 NULL

**Why**: 既有 admin debug API 已經承接 query log truth；不另開 table 減少 schema 變動。事後 audit「這筆 retrieval 的 query 怎麼改」單表 join 即可。

**Alternatives**:

- 寫進 evlog wide event — wide event 是 transient（drain 後查不到歷史）；audit 要靠長期儲存
- 開新 table `rewriter_log` — 增加 schema scope、JOIN 成本、無實質收益

**Trade-off**: schema migration 0017 必須與 4 個 caller wire-up 同 deploy（部署順序保證 column 先存在再 enable flag）。

### Prompt 策略只做形式 normalization 不做擴展

Prompt 範例（prose；不在此處硬寫，由實作決定）：

> 給定使用者 query，請改寫成「索引文件可能出現的題目句式」。**不要新增、不要假設、不要擴展同義詞**。只做形式正規化。範例：
>
> - "PO 和 PR 差別" → "PO 採購單與 PR 請購單的角色差異"
> - "庫存不足怎麼辦" → "庫存不足處理流程"
> - "怎麼請假" → "請假申請流程"
>   輸出 JSON：`{"rewritten": "..."}`

**Why**: 擴展（同義詞展開、加上下文）會引入語意漂風險（"請假" 改寫成「離職流程」會召回錯主題）。先驗證形式 normalization 是否打中 root cause；若達標則 stop，未達標則升 HyDE 或 query expansion 為 follow-up。

**Alternatives**: 多候選 + retrieval 並行各取一條取 max — 增加 cost & latency 2x，第一輪不需要。

**Trade-off**: 對「PR 是什麼」這種問詞型 query 改寫空間有限，acceptance 數字會反映此限制。

## Risks / Trade-offs

- [Risk] LLM rewriter 改寫成跟原意偏離的 query（語意漂） → retrieval 召回完全相反主題
  → Mitigation: prompt 限制「只改寫成題目複述形式、不擴展、不改主題詞」+ acceptance fixture 對比 retrieval_score；ramp production 前必須有 acceptance evidence 證明 ≥50% 達 0.55；fallback rate > 10% 視為退化

- [Risk] Latency p95 增量過大（rewriter call ~500ms）導致 chat 體感變慢
  → Mitigation: latency budget 800ms（rewriter LLM call p95）；staging acceptance 跑 35 筆量 p95；超過 budget 不 ramp production

- [Risk] Rewriter LLM cost 增加（每次 retrieval 多一次 judge-tier 模型 call）
  → Mitigation: 共用 judge AI Gateway 計入既有預算；staging 樣本量低、production ramp 前評估月度用量

- [Risk] Feature flag drift（4 個 caller 各自 hard-code 或忘記 wire）
  → Mitigation: 從同一 helper `isQueryRewritingEnabled(runtimeConfig)` 讀取；test 鎖 4 個 caller 都 wire 到 helper

- [Risk] Rewriter throw 出 retrieval flow 阻擋 chat
  → Mitigation: try/catch 在 `knowledge-query-rewriter.ts` 內部完成；對外 contract 永遠 return `string`；unit test 三條 fallback path 必須覆蓋

- [Risk] Migration 0017 與 caller wire-up 部署順序錯誤導致 production INSERT 撞 NOT NULL
  → Mitigation: column DEFAULT `'disabled'`，向下相容 existing rows；deploy 順序 = migration apply → deploy code（既有 spectra-deploy 流程）

## Migration Plan

1. Apply migration 0017：加 `query_log_debug.rewriter_status` (TEXT NOT NULL DEFAULT 'disabled') + `rewritten_query` (TEXT NULL)
2. Deploy code（feature flag staging=true、production=false）— 既有行為等同 `disabled`
3. Staging smoke：手動打 1-2 條 chat 確認 rewriter 跑、`rewriter_status='success'` 寫進 `query_log_debug`、無 error
4. Run main-v0.0.54-acceptance 35 筆 fixture 對 staging
5. 量化 acceptance: ≥50% retrieval_score ≥0.55 + p95 latency 增量 < 800ms + fallback rate < 10%
6. 達標 → 寫進 `docs/decisions/2026-04-26-rag-query-rewriting.md` + ROADMAP 標 production ramp 為下一條 ops change
7. 不達標 → escalation 路徑：HyDE / reranker / prompt 調整擇一，開新 change

**Rollback**: feature flag flip `features.queryRewriting=false`（staging 或 production）即可立即回到原行為。Schema 欄位保留作 audit history（不 drop）。

## Open Questions

- Q1: Prompt 是否需要先給 LLM 索引主題清單（如「採購 / 人事 / 系統 FAQ」）？
  - 暫定：第一輪不給（保持 prompt 簡潔）。Acceptance 結果若顯示 rewriter 改寫到跟索引主題完全無關，加在第二輪迭代。
- Q2: `rewritten_query` 欄位是否要套用 PII / sensitive masking？
  - 暫定：rewriter input 是已通過 web/mcp 入口 redaction 的 query，rewriter LLM 不會主動引入新 PII。但 admin debug API 顯示 `rewritten_query` 時應沿用 `query-log-debug-store.ts` 既有 mask 邏輯，實作時驗證 mask 函數是否涵蓋此欄位。
- Q3: 抽樣比例（並非全量 rewrite）？
  - 暫定：不抽樣，全量啟用。staging 流量低，sample 不會省太多 cost。production 啟用時若 cost 超預算再評估抽樣策略。
