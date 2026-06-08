## Summary

將現有 Cloudflare AutoRAG legacy Workers binding 呼叫從 `env.AI.autorag(indexName).search()` 遷移到 Cloudflare AI Search 新 Workers binding。新路徑使用 `env.AI_SEARCH.get(instanceId).search()`，request payload 改為 `query` + `ai_search_options.retrieval`，response mapping 改讀 `chunks`，以解除 TD-071 對 staging / production chat retrieval 的 500 阻塞。

## Motivation

TD-071 的 evlog root cause 已確認不是單純 filter bug，而是 AutoRAG legacy `.search()` request shape 在 Cloudflare AI Search 遷移後不再被 staging 接受。v0.56.6 修正 compound filter shape 後，v0.56.7 即使移除 filter 仍回 500 `Invalid input`，代表 `max_num_results` / `ranking_options` / `rewrite_query` 等舊 payload shape 本身已不可靠。

目前 `rag-query-rewriting` 的 staging acceptance 6.3-6.6 被 TD-071 critical blocker 擋住：retrieval pipeline 100% 掛在 Cloudflare search call，無法取得 `retrieval_score`，也無法驗證 query rewriting 的品質與 latency。若不先遷移到 AI Search 新 API，Web chat、MCP ask、MCP search 都會持續依賴 legacy binding，staging / production runtime 風險無法消除。

Cloudflare 官方 AI Search Workers binding 文件已標示 `env.AI.autorag()` 為 legacy，新的 namespace binding 以 `ai_search_namespaces` 暴露 `env.AI_SEARCH.get("instance")`，搜尋結果回傳 `chunks` 而非 `data`。

## Proposed Solution

1. **更新 AI Search binding contract**
   - `server/utils/ai-search.ts` 將 `CloudflareAiBindingLike` 從 `.autorag(indexName).search()` 改成 `AI_SEARCH.get(instanceId).search()` 對應的新 interface。
   - `createCloudflareAiSearchClient()` 接受 AI Search namespace binding 與 instance id，保留現有 `search()` adapter 對上游 retrieval 的 `KnowledgeSearchCandidate[]` contract。

2. **轉換 search request / response shape**
   - 將既有 request `{ query, max_num_results, ranking_options.score_threshold, filters, rewrite_query: false }` 映射成 `{ query, ai_search_options: { retrieval: { max_num_results, match_threshold, filters }, query_rewrite: { enabled: false } } }`。
   - 將 response mapping 從 `response.data[]` 改為 `response.chunks[]`，讀取 `chunk.text`、`chunk.score`、`chunk.item.metadata.document_version_id`、`chunk.item.metadata.citation_locator`、`chunk.item.metadata.access_level`。
   - 缺少必要 metadata 的 chunk 仍要被丟棄，維持 D1 post-search verification 之前的安全邊界。

3. **調整 retrieval filters**
   - `server/utils/knowledge-retrieval.ts` 不再產生 legacy `{ type, key, value }` filter。
   - 若需要 metadata filter，只能產生 AI Search / Vectorize-style filter，並放在 `ai_search_options.retrieval.filters`。
   - 現行 access control 仍由 D1 `resolveCurrentEvidence()` 做 authoritative verification；remote filter 只可作為效能快篩，不可取代 D1 驗證。

4. **更新三個 runtime callsite**
   - `server/api/chat.post.ts`
   - `server/mcp/tools/ask.ts`
   - `server/mcp/tools/search.ts`

   這三處改用 AI Search namespace binding accessor，不再以 `requireAiBinding(..., { method: 'autorag' })` 綁死 `env.AI`。

5. **更新 Cloudflare config 與 deploy wiring**
   - `wrangler.jsonc` 與 `wrangler.staging.jsonc` 加入 `ai_search_namespaces` binding `AI_SEARCH`，並保留現有 `ai` binding `AI` 給 Workers AI answer / judge / query rewriter 使用。
   - `.github/workflows/deploy.yml` build env 與 rendered worker config 需一致傳遞 AI Search instance id，避免 staging build-time config 與 runtime binding 漂移。
   - `nuxt.config.ts` 的 runtime config 仍需要提供 instance id；若保留 `NUXT_KNOWLEDGE_AI_SEARCH_INDEX` 作相容 key，實作需在命名註解或型別上標明其語意已是 AI Search instance id。

6. **更新測試與 mocks**
   - `test/unit/ai-search.test.ts` 改驗新 request shape、`AI_SEARCH.get()` 呼叫、`chunks` mapping、error propagation。
   - `test/unit/knowledge-retrieval.test.ts` 與 30+ integration/acceptance fakes 改成新 binding shape。
   - 更新 `test/acceptance/helpers/bindings.ts` 的 `createAiSearchBindingFake()`，讓 acceptance helpers 覆蓋新 binding contract。

## Non-Goals

- 不修改 `server/utils/knowledge-query-rewriter.ts` 的 prompt、rewriter status、feature flag、retry-pass 邏輯；這些仍屬 `rag-query-rewriting` change。
- 不修改 D1 schema、migration、`query_logs` / `query_log_debug` 欄位。
- 不新增或重做前端 UI；本 change 無任何 view-layer 或 styling 變更。
- 不改文件 indexing / sync job 的功能語意；`autorag-sync.ts` 若仍只是 Cloudflare REST sync wrapper，本 change 只處理名稱與 binding 邊界，不重新設計 ingestion pipeline。
- 不把 D1 access control 下放給 AI Search metadata filter；AI Search filter 只做 retrieval pre-filter，authoritative truth 仍是 D1 current evidence verification。

## Alternatives Considered

| Alternative | 為何不選 |
| --- | --- |
| 保留 `env.AI.autorag()`，只繼續調整 payload | v0.56.7 已證明移除 filter 後仍 500；payload shape 與 binding 都已落在 legacy surface，繼續 patch 會拖延 TD-071 blocker。 |
| 改用 direct `ai_search` instance binding | Cloudflare 文件列為簡單遷移路徑，但本 repo 已用 env var 在 production/staging 切換 instance id，namespace binding `AI_SEARCH.get(instanceId)` 更貼近現有 runtime config 與使用者指定的新 API。 |
| 直接使用 AI Search `chatCompletions()` | 現有架構由本 app 掌握 retrieval scoring、D1 verification、judge、citation mapping 與 refusal policy；改 chat completions 會繞過既有治理，不屬本 blocker 修復。 |
| 暫時停用 retrieval 或 fallback 空結果 | 會把 500 換成大量 `no_citation_refuse`，無法解鎖 `rag-query-rewriting` acceptance，也不能證明 staging / production chat 健康。 |

## Affected Entity Matrix

### Entity: cloudflare_ai_search_binding

| Dimension | Values |
| --- | --- |
| Columns touched | 無 D1 欄位 |
| Roles | system worker runtime |
| Actions | resolve namespace binding、取得 instance handle、執行 search |
| States | `AI_SEARCH` binding present / missing；instance id configured / missing；search success / Cloudflare error |
| Surfaces | backend-only：`server/utils/ai-search.ts`、三個 server callsite、wrangler/deploy config |

### Entity: knowledge_retrieval_request

| Dimension | Values |
| --- | --- |
| Columns touched | 無 D1 欄位 |
| Roles | Web chat user、MCP token caller、system retrieval pipeline |
| Actions | build normalized query、build AI Search request、run D1 post-verification |
| States | empty filter、metadata filter、thresholded retrieval、Cloudflare request rejected |
| Surfaces | backend-only：`server/utils/knowledge-retrieval.ts`、`server/utils/ai-search.ts` |

### Entity: knowledge_search_candidate

| Dimension | Values |
| --- | --- |
| Columns touched | 無 D1 欄位 |
| Roles | system retrieval pipeline |
| Actions | map AI Search `chunks` into `KnowledgeSearchCandidate`、discard invalid metadata、feed D1 verification |
| States | valid chunk / missing metadata / missing text / zero score |
| Surfaces | backend-only：`server/utils/ai-search.ts`、unit/integration tests |

## User Journeys

**No user-facing journey (backend-only)**

理由：本 change 是 Cloudflare Workers binding、search payload 與 retrieval adapter 的 backend migration。Web chat 與 MCP tools 的使用者 contract 不變：同樣送 query、同樣收到 answer/search results/citations 或治理拒答。可觀察改善是 staging / production chat 不再因 legacy AutoRAG request shape 回 500，但沒有新 UI 流程或新畫面。

## Implementation Risk Plan

- Truth layer / invariants: D1 `resolveCurrentEvidence()` 仍是 access level、document status、current version 的 authoritative truth；AI Search metadata filter 不可成為安全判斷來源。`KnowledgeSearchCandidate` 必須保留 `documentVersionId`、`citationLocator`、`accessLevel` 三個欄位，否則後續 D1 verification 會失效。
- Review tier: Tier 2。此 change 跨 runtime binding、Cloudflare config、Web/MCP 三個 retrieval entry points 與大量 mocks；不改 auth policy、不改 schema、不改 UI。
- Contract / failure paths: `AI_SEARCH` binding missing、instance id missing、`get(instanceId)` missing、Cloudflare `search()` error、response chunk metadata 缺漏都必須有明確測試。Binding missing 走 503；Cloudflare search error 不吞掉，讓既有 route error handling / evlog 捕捉。
- Test plan: unit 覆蓋 `ai-search.ts` request/response/error；unit/integration 覆蓋 `knowledge-retrieval.ts` search request contract；integration 覆蓋 chat / MCP ask / MCP search mocks；full gate 跑 `pnpm test:unit`、`pnpm test:integration`、`pnpm typecheck`、`pnpm build`。
- Runtime verification: staging deploy 後由 apply 階段 Claude 自跑 HTTP/API smoke 與 D1 evidence，確認 `/api/chat` 或既有 acceptance runner 不再 500，`query_logs.retrieval_score` 有非 null / 非零樣本，`rewriter_status` 仍依 `rag-query-rewriting` flag 正確寫入。
- Artifact sync: 完成後需更新 `docs/tech-debt.md` TD-071 狀態、解除 `openspec/changes/rag-query-rewriting/tasks.md` 的 `@apply-blocked[TD-071 ...]` blocker、必要時更新 `openspec/ROADMAP.md` 的 Next Moves；這些屬 apply/archive 收尾，不在 propose 階段直接修改既有 WIP。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workers-ai-grounded-answering`：Web chat retrieval 必須使用 Cloudflare AI Search 新 binding、request shape 與 `chunks` response mapping。
- `mcp-knowledge-tools`：MCP ask/search retrieval 必須走同一個 AI Search client contract，維持 authorization 與 response shape 不變。

## Impact

- Affected specs:
  - `workers-ai-grounded-answering`
  - `mcp-knowledge-tools`
- Affected code:
  - `server/utils/ai-search.ts`
  - `server/utils/knowledge-retrieval.ts`
  - `server/utils/ai-binding.ts` 或新增等價 binding accessor helper
  - `server/api/chat.post.ts`
  - `server/mcp/tools/ask.ts`
  - `server/mcp/tools/search.ts`
  - `nuxt.config.ts`
  - `wrangler.jsonc`
  - `wrangler.staging.jsonc`
  - `.github/workflows/deploy.yml`
  - `scripts/render-staging-wrangler.mjs`（若該 script 需要保留/傳遞 `ai_search_namespaces`）
  - `test/unit/ai-search.test.ts`
  - `test/unit/knowledge-retrieval.test.ts`
  - `test/unit/require-ai-binding.test.ts` 或新增 accessor 對應測試
  - `test/acceptance/helpers/bindings.ts`
  - 既有 chat / MCP integration tests 中 mock `CloudflareAiBindingLike` 的檔案
- Removed: none
