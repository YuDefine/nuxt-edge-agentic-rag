## Summary

新增 LLM-based query rewriting 到 RAG retrieval pipeline，把 user query 改寫成「索引內可能出現的句式」，解決 acceptance fixture 子知識問答 form vs 索引題目複述 form 的 query gap。

## Motivation

診斷 note `local/reports/notes/td-060-retrieval-score-diagnosis-20260426.md` 鎖定 root cause：embedding（`@cf/qwen/qwen3-embedding-0.6b`）對「複述索引標題式 query」（"採購流程" → 0.72）vs「子知識問答式 query」（"PO 和 PR 差別" → 0.38）sensitivity 不對稱，本質是 query 表達形式跟索引文本表達形式的詞彙重疊度。

7 天 production 樣本：35 筆 with retrieval_score 中只 5 筆 ≥0.7（全是「採購流程」題目複述變體 → directAnswer），其餘 acceptance fixture 全 <0.45 卡在 `no_citation_refuse`。

不解 query gap 則：(1) 第二輪 main-v0.0.54-acceptance 無法跑出 fixture 進 judge gate 的真實 quality 數據；(2) TD-061/056 truncation fix（v0.52.1 已 ship）無法被 acceptance evidence 驗證——fixture 從沒到達 judge gate，撞不到 truncation。

## Proposed Solution

在 `retrieveVerifiedEvidence` (`server/utils/knowledge-retrieval.ts`) 內，於 `normalizeKnowledgeQuery` 之後、`options.search` 之前，加一步**可選**的 LLM query rewriting：

1. **新增 `server/utils/knowledge-query-rewriter.ts`**
   - `rewriteForRetrieval(normalizedQuery, { ai, runtimeConfig, signal? })`
   - Prompt 策略：把 user query 改寫成「題目複述形式」候選（不做擴展、僅形式 normalization；e.g. "PO 和 PR 差別" → "PO 採購單與 PR 請購單的角色差異"）
   - LLM model: 與 judge 共用 model binding（同 timeout/governance），但獨立 prompt template + `max_completion_tokens: 256`
   - Failure mode: LLM timeout / parse error → fallback 用 original normalized query；status 記 `query_log_debug.rewriter_status = 'fallback_<reason>'`，retrieval 流程不中斷

2. **改 `retrieveVerifiedEvidence`** 接 optional `rewriter` 與 `runtimeConfig`
   - 啟用：rewriter() → rewritten query 餵 search → 同時記 original / rewritten 進 `query_log_debug`
   - 關閉：行為與現在 100% 相同（向下相容）

3. **Wire 4 個 caller**：`web-chat.ts`、`mcp-ask.ts`、`mcp-search.ts`、`knowledge-answering.ts`
   - 由 `features.queryRewriting`（新增 runtime flag）控制；staging default `true`、production default `false`（待 staging 過 acceptance gate 才 ramp）

4. **Acceptance evidence**：
   - 對 staging 跑 main-v0.0.54-acceptance 35 筆 fixture，目標 ≥50% 拿 retrieval_score ≥0.55
   - 量 latency p95 增量 < 800ms（rewriter LLM call 預算）
   - 證據 + ramp 決策寫進 `docs/decisions/2026-04-26-rag-query-rewriting.md`

5. **Observability**：`query_log_debug` 新增兩欄
   - `rewriter_status TEXT`（`disabled` / `success` / `fallback_timeout` / `fallback_error`）
   - `rewritten_query TEXT NULL`（rewrite 成功時記）

## Non-Goals

- **不做 reranker、chunk 重切、降 thresholds**（diagnosis #2/#3/#5）—— 先驗證 #1 leverage，reranker 留作 follow-up TD
- **不改 embedding 模型、不重 ingest 索引** —— 證據反證模型沒問題（同模型可達 0.72）
- **不引入 HyDE**（產整段假設答案）—— Query Rewriting 是更保守版本，token cost 低、failure 影響小；50% 沒打到再升 HyDE
- **不擴展 acceptance fixture 主題覆蓋**（屬 TD-050 staging R2 seed 範圍）
- **不 ramp production**（本 change 只 enable staging；production 開啟由 decision doc + 後續 ops change 處理）

## Alternatives Considered

| Alternative                      | 為何不選                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| HyDE                             | Token cost 高、latency 大、failure mode 重；先用 Query Rewriting 驗證 root cause                   |
| Reranker (BGE)                   | Cloudflare AI 無 native BGE-reranker；先打中 root cause 才合理上 reranker                          |
| Chunk 重切 256 tokens + Q&A 增強 | 重 ingest 全文件成本高、validation cycle 長；root cause 不一定出在 chunk granularity（信心度 50%） |
| 降 thresholds (0.7 → 0.5)        | 治舊 symptom 不治根，掩蓋 query/index 對應問題                                                     |

## Affected Entity Matrix

### Entity: query_log_debug

| Dimension       | Values                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------- |
| Columns touched | `rewriter_status TEXT NOT NULL DEFAULT 'disabled'`（new）、`rewritten_query TEXT NULL`（new） |
| Roles           | system (write), admin (read via `/admin/debug/query-logs/[id]`)                               |
| Actions         | insert (retrieval flow)、read (admin debug API)                                               |
| States          | `disabled` / `success` / `fallback_timeout` / `fallback_error`                                |
| Surfaces        | `server/utils/query-log-debug-store.ts`、`server/api/admin/debug/query-logs/[id].get.ts`      |

### Entity: knowledge_runtime_config (shared schema)

| Dimension       | Values                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Columns touched | `features.queryRewriting: boolean`（new；default false）                                       |
| Roles           | system (read at retrieval time)                                                                |
| Actions         | read by `web-chat.ts` / `mcp-ask.ts` / `mcp-search.ts` / `knowledge-answering.ts`              |
| States          | `false`（disabled）/ `true`（enabled）                                                         |
| Surfaces        | `shared/schemas/knowledge-runtime.ts`、`wrangler.jsonc` / `wrangler.staging.jsonc` env mapping |

## User Journeys

**No user-facing journey (backend-only)**

理由：本 change 是 RAG retrieval pipeline 的內部增強，不新增、不修改 UI surface。Web chat / MCP `knowledge.ask` 對 user 的 contract 不變（同樣 query in、同樣 answer + citations out）。改變的只是 retrieval 召回品質與 `query_log_debug` 內部欄位（admin debug 路徑可選讀，不在本 change 範圍）。

User 可觀察的唯一變化：fixture / 子知識問答的回答品質從「拒答」變成「附引用回答」——這是 acceptance fixture 驗收路徑，不是 user-facing journey。

## Implementation Risk Plan

- Truth layer / invariants: `query_log_debug` 是 debug audit truth source；`rewriter_status` 必須在每筆 retrieval 都被寫入（不可只記 success；fallback / disabled 也要記，否則無法事後 audit retrieval 行為）。`features.queryRewriting` 是 runtime config 真相，4 個 caller 都從同一處讀取，不得各自 hard-code。
- Review tier: Tier 2（多檔案、跨 web/mcp 兩條路徑、加 LLM call 進入熱路徑；不碰 auth/permission/migration high-risk surface）
- Contract / failure paths: rewriter LLM call 失敗（timeout / 5xx / JSON parse error）必須 graceful fallback 用 original normalized query，retrieval 流程不中斷；fallback status 記 `query_log_debug.rewriter_status`；rewriter 不可 throw 出 retrieval 流程；feature flag off 時行為 100% 與現在等同（向下相容測試必須有）。
- Test plan: unit (`knowledge-query-rewriter.spec.ts`：prompt 形成、parse 成功 / timeout / error fallback 三條路徑)、integration (`retrieve-verified-evidence-with-rewriter.spec.ts`：rewriter on/off 行為對比、score recording 正確性)、acceptance (對 staging 跑 main-v0.0.54-acceptance 35 筆，記 retrieval_score 分布 + latency p95 + rewriter_status 分布)。
- Artifact sync: `docs/decisions/2026-04-26-rag-query-rewriting.md`（決策 + acceptance 證據 + ramp 計劃）、`docs/tech-debt.md`（TD-060 標 in-progress、TD-061 link 到本 change）、`openspec/ROADMAP.md > Next Moves` 更新 TD-060 狀態與第二輪 acceptance 解鎖、`local/reports/notes/main-v0.0.54-acceptance-latency-run-{date}.md` 第二輪 evidence note。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workers-ai-grounded-answering`: retrieval pipeline 加可選 query rewriting step + `query_log_debug` 觀察欄位

## Impact

- Affected specs: `workers-ai-grounded-answering` (modified)
- Affected code:
  - New:
    - `server/utils/knowledge-query-rewriter.ts`
    - `server/database/migrations/0017_query_log_debug_rewriter_columns.sql`
    - `test/unit/knowledge-query-rewriter.spec.ts`
    - `test/integration/retrieve-verified-evidence-with-rewriter.spec.ts`
    - `docs/decisions/2026-04-26-rag-query-rewriting.md`
  - Modified:
    - `server/utils/knowledge-retrieval.ts`
    - `server/utils/knowledge-answering.ts`
    - `server/utils/web-chat.ts`
    - `server/utils/mcp-ask.ts`
    - `server/utils/mcp-search.ts`
    - `server/utils/query-log-debug-store.ts`
    - `shared/schemas/knowledge-runtime.ts`
    - `wrangler.staging.jsonc`
    - `openspec/specs/workers-ai-grounded-answering/spec.md`
  - Removed: (none)
