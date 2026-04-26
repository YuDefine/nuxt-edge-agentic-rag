# 2026-04-26 — RAG Query Rewriting

## Decision

在 RAG retrieval pipeline 內，於 `normalizeKnowledgeQuery` 之後、AI Search 之前
加一步「LLM-based 形式正規化 query rewriter」，把使用者問題改寫成「索引文件
裡可能出現的題目句式」。

- Implementation: change `rag-query-rewriting`
- Spec: `openspec/specs/workers-ai-grounded-answering/`（§S-RW / §S-FB / §S-OB / §S-FF）
- Code entry: `server/utils/knowledge-query-rewriter.ts` `rewriteForRetrieval`
- Feature flag: `runtimeConfig.features.queryRewriting`
  - staging default: `true`
  - production default: `false`（待 acceptance evidence 才 ramp）

## Context

TD-060（diagnosis note `local/reports/notes/td-060-retrieval-score-diagnosis-20260426.md`）
顯示 production embedding (`@cf/qwen/qwen3-embedding-0.6b`) 對「題目複述形式」與
「子知識問答形式」的 cosine sensitivity 嚴重不對稱：

- 「採購流程」題目複述變體 → retrieval_score 0.72（命中題目）
- 「PO 和 PR 差別」子知識問答 → retrieval_score 0.38（未命中題目）

7 天 production 樣本：35 筆 with `retrieval_score` 中只 5 筆 ≥0.7，全是「採購流程」
複述變體。其餘 acceptance fixture 全 <0.45，卡在 `no_citation_refuse`，導致
`main-v0.0.54-acceptance` 33/35 fixture 從未到達 judge gate。

Root cause 是 query↔index 詞彙重疊度問題，不是模型 ceiling、不是 chunk 切分、
不是 threshold 設定。

## Alternatives

| Alternative                                      | 不選的理由                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 換 embedding model（Qwen→bge-m3 / bge-large-zh） | 同模型已可達 0.72，反證模型 ceiling 不是瓶頸；換模型需 production reindex + dimension migration，cost 大幅高於 query rewriting |
| 降低 `directAnswerMin` / `judgeMin` 門檻         | 既有門檻是 governance 安全保險（不幻覺、不誤判），降門檻會放大 false positive 的引用錯誤                                       |
| Chunk 重切（256→128 token）                      | 需重新 ingest 全部文件、需 reindex；無證據顯示 chunk 大小是因素                                                                |
| HyDE（產假設答案再 embed）                       | token cost 4x、p95 latency +1.2-2s、failure 模式更激進（hallucination → 召回完全錯誤主題）；保留為第二輪 escalation            |
| AutoRAG 自帶 `rewrite_query: true`               | Black box，無 prompt control、無 fallback 機制、無 audit trail；改用我們可控的 LLM 改寫                                        |
| 補 reranker（BGE）                               | 召回品質改善但不解 root cause（query↔index gap），保留為第三輪 escalation                                                      |

## Reasoning

選 LLM-based query rewriting 的關鍵理由：

1. **直接命中 root cause** — diagnosis 證據顯示問題在 query 表達形式，rewriter 直接調整這層
2. **Token cost 低** — `max_completion_tokens: 256` 對應短 title 字串（~20-40 字）；judge model 共用 binding 不需新預算
3. **Latency 預算寬** — 單次 LLM call ~500ms，p95 budget 800ms 容許
4. **Failure 影響小** — fallback to original normalized query，retrieval 流程永不中斷
5. **Audit trail 完整** — `query_log_debug.rewriter_status` + `rewritten_query` 兩欄記錄每一筆 retrieval 的 rewriter 行為
6. **Ramp 安全** — feature flag 控制 staging-on / production-off，acceptance evidence 達標才 ramp

## Trade-offs Accepted

- **Rewriter LLM call 增加每次 retrieval 一次 judge-tier 模型 call**
  - Mitigation: 共用 judge AI Gateway 計入既有預算；月度用量 production ramp 前評估
- **形式 normalization 對「太短的問詞型 query」（如「PR 是什麼」）改寫空間有限**
  - Mitigation: acceptance evidence 反映此限制；若達標 50% 則接受、未達標則升 HyDE
- **rewriter 改變主題詞的風險（語意漂）**
  - Mitigation: prompt 嚴格限制「只做形式正規化、不擴展、不改主題詞」；fallback rate >10% 視為退化指標
- **judge model 改變時 rewriter 跟著走**
  - 接受此綁定；模型升級時 acceptance fixture 重跑驗證 rewriter prompt 與新模型的相容性
- **第二次 retrieve（reformulatedQuery）不再走 rewriter**
  - judge 已給 LLM-shaped query；再 rewrite 會 duplicate cost + drift query
  - 在 `knowledge-answering.ts` self-correction path 顯式傳 `useRewriter: false`

## Acceptance Evidence

待 staging deploy + 重跑 main-v0.0.54-acceptance 後填入：

| 指標                                          | Target         | Actual | 評估  |
| --------------------------------------------- | -------------- | ------ | ----- |
| Acceptance fixture retrieval_score ≥0.55 占比 | ≥50%（17+/35） | _TBD_  | _TBD_ |
| Latency p95 增量 vs baseline                  | <800ms         | _TBD_  | _TBD_ |
| Rewriter fallback rate                        | <10%           | _TBD_  | _TBD_ |
| Rewritten query 方向合理性（人工抽 3 條）     | 0 語意漂       | _TBD_  | _TBD_ |

Evidence note: `local/reports/notes/main-v0.0.54-acceptance-rewriter-staging-{YYYYMMDD}.md`

## Production Ramp Plan

達標 → 開後續 ops change 把 production `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING`
改 `true`，flag flip 即可。

未達標 → 不 ramp。escalation 路徑（按優先序）：

1. Prompt 加索引主題清單（讓 rewriter 知道 corpus 主題範疇）
2. 升 HyDE（產假設答案再 embed）
3. 補 BGE reranker
4. 換 embedding model（最重 cost，最後選項）

## Open Questions

- **Q1**：第一輪 prompt 是否需要給 LLM 索引主題清單？
  - 暫定：第一輪不給（保持 prompt 簡潔）。Acceptance 顯示改寫到跟索引主題完全
    無關時，加在第二輪迭代。
- **Q2**：admin debug API `rewritten_query` mask 行為？
  - 結論：**rewriter input 並非已紅化**。`normalizeKnowledgeQuery` 只做詞彙
    替換 + 日期格式 + whitespace trim，PII 紅化在獨立的 `auditKnowledgeText`
    path（email/phone regex），用於產生 `query_redacted_text`。為了讓
    `rewritten_query` 與 `query_redacted_text` 站在同一 PII 保證上，
    `retrieveVerifiedEvidence` 在持久化 `rewrittenQueryForAudit` 之前
    對 LLM 輸出再跑一次 `auditKnowledgeText`，把可能被 LLM echo 出來的
    email / phone 紅化掉。送進 AI Search 的 `queryForSearch` 仍維持原樣
    （與既有 retrieval pipeline 一致：AI Search 與 Workers AI 在同一
    Cloudflare 信任邊界內，原本就會看到未紅化的 normalized query）。

## Rollback

Feature flag flip `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING=false`（staging 或
production）即可立即回到原行為。Schema 欄位（`rewriter_status` / `rewritten_query`）
保留作 audit history（不 drop）。
