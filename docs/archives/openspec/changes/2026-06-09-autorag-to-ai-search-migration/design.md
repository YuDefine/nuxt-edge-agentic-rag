## Context

現有 retrieval path 把 Cloudflare search 封裝在 `server/utils/ai-search.ts`：`createCloudflareAiSearchClient()` 接受 `CloudflareAiBindingLike` 與 `indexName`，呼叫 `aiBinding.autorag(indexName, gatewayOptions).search(request)`，再把 `response.data[]` 投影成 `KnowledgeSearchCandidate[]`。

`retrieveVerifiedEvidence()` 位於 `server/utils/knowledge-retrieval.ts`，負責 query normalization、呼叫 search client、再用 D1 `resolveCurrentEvidence()` 驗證 active/current/access-level。它目前送出的 search request 仍是 legacy AutoRAG shape：`filters`、`max_num_results`、`ranking_options.score_threshold`、`rewrite_query: false`。

三個 runtime callsite 都透過 `createCloudflareAiSearchClient()` 建立 search client：

- `server/api/chat.post.ts`
- `server/mcp/tools/ask.ts`
- `server/mcp/tools/search.ts`

Cloudflare AI Search Workers binding 文件指出 `env.AI.autorag()` 已是 legacy；新 binding 由 wrangler `ai_search` 或 `ai_search_namespaces` 提供，namespace binding 的搜尋入口是 `env.AI_SEARCH.get("my-instance").search(...)`。Search request 可使用 `query` 字串與 `ai_search_options.retrieval`，response 欄位是 `chunks`，chunk metadata 在 `chunks[].item.metadata`。

## Goals / Non-Goals

**Goals:**

- 讓 Web chat、MCP ask、MCP search 全部改用 Cloudflare AI Search 新 Workers binding。
- 保留 app 既有 retrieval governance：D1 post-verification、retrieval scoring、citation mapping、judge/refusal policy 都不變。
- 把 request shape 從 legacy AutoRAG payload 轉成 AI Search payload，避免 staging / production chat 因 `Invalid input` 500。
- 把 response mapping 從 `data[]` 改成 `chunks[]`，且 metadata 缺漏時 fail closed。
- 更新 wrangler/deploy/test mocks，讓 local tests 能鎖住新 binding contract。

**Non-Goals:**

- 不改 LLM query rewriter 的策略與 feature flag。
- 不改 D1 schema、migration、query log schema。
- 不新增 UI、Design Review、fixtures/seed 工作。
- 不把 access control 改交給 AI Search filter；遠端 filter 不是 authorization truth。
- 不在本 change 內調整 acceptance fixture 題組或 retrieval thresholds。

## Decisions

### D-BIND: 採用 `ai_search_namespaces` + `AI_SEARCH.get(instanceId)`

Wrangler config 加入：

```jsonc
"ai_search_namespaces": [
  {
    "binding": "AI_SEARCH",
    "namespace": "default"
  }
]
```

`AI` binding 保留給 Workers AI answer / judge / query rewriter；新 search binding 使用 `AI_SEARCH`，兩者不可混用。

**Why**: 使用者指定的新 API 是 `env.AI_SEARCH.get(instanceId)`。本 repo production/staging 已由 `NUXT_KNOWLEDGE_AI_SEARCH_INDEX` 決定不同 instance name，namespace binding 可保留這個 runtime selection，不需要為每個環境硬編 direct instance binding 名稱。

**Alternative**: direct `ai_search` instance binding。這較簡單，但會把 instance 選擇放進 wrangler binding 本身，與目前 build/runtime config 的 instance id 模型不一致。

**Trade-off**: namespace binding 需要 runtime `get(instanceId)` validation；測試需覆蓋 missing binding、missing `get()`、missing instance id。

### D-ACCESSOR: 不再用 `requireAiBinding(... method: 'autorag')` 取得 search binding

現有 `requireAiBinding()` hard-code `getCloudflareEnv(event).AI`，且用 method probe 驗 `autorag` / `run`。AI Search migration 需要新增或調整 helper，讓 search callsite 從 `getCloudflareEnv(event).AI_SEARCH` 讀 namespace binding，並驗證 `.get` 是 function。

預期實作方向：

- 保留 `requireAiBinding()` 給 Workers AI `AI.run()`。
- 新增 `requireAiSearchBinding(event)` 或泛化 helper 支援 binding name。
- Web chat、MCP ask、MCP search 的 search binding missing message 改成 `Cloudflare AI Search binding "AI_SEARCH" is not available`。

**Why**: `AI` 與 `AI_SEARCH` 是不同 binding；沿用 `requireAiBinding()` 會把新 search path 綁回 legacy `AI`，無法解開 TD-071。

### D-REQUEST: Adapter 內集中做 request shape translation

`retrieveVerifiedEvidence()` 可以暫時保留現有 search client input contract，讓上游仍送：

```ts
{
  query,
  max_num_results,
  ranking_options: { score_threshold },
  filters,
  rewrite_query: false,
}
```

`createCloudflareAiSearchClient()` 在 adapter 內轉為：

```ts
{
  query,
  ai_search_options: {
    retrieval: {
      max_num_results,
      match_threshold: score_threshold,
      filters,
    },
    query_rewrite: { enabled: false },
  },
}
```

空 filter 不要送入 `retrieval.filters`，避免 Cloudflare 對 `{}` 的語意或 validator 變動影響搜尋。`query_rewrite.enabled=false` 用來保留 app 自己掌握 query rewriting 的既有設計，避免 Cloudflare 內建 rewrite 與 `rag-query-rewriting` 造成雙重改寫。

**Why**: 把 shape translation 放在 adapter 可降低 blast radius；`knowledge-retrieval.ts` 仍只表達治理需求，不直接知道 Cloudflare request details。

**Risk**: Cloudflare 文件中 `query_rewrite` 是 AI Search option；若 Workers binding 對 search endpoint 不接受此 key，unit test 無法抓到 runtime validator。Apply 階段 staging smoke 必須驗證 request 實際被接受。若 staging 顯示 `query_rewrite` 不被接受，移除該 key，並用「不傳 query rewrite」表示 default false。

### D-RESPONSE: `chunks` mapping 必須 fail closed

新 response mapping：

- `chunk.text` → `KnowledgeSearchCandidate.excerpt`
- `chunk.score` → `KnowledgeSearchCandidate.score`
- `chunk.item.metadata.document_version_id` → `documentVersionId`
- `chunk.item.metadata.citation_locator` → `citationLocator`
- `chunk.item.metadata.access_level` → `accessLevel`

若 `chunk.text`、`document_version_id`、`citation_locator`、`access_level` 任一缺漏，該 chunk 丟棄。這維持現有 `response.data[]` mapping 的安全語意：沒有足夠 metadata 的 search result 不可進 D1 verification 與 citation path。

**Why**: AI Search 是 retrieval source，不是 truth source；缺 metadata 的 chunk 不能證明它對應哪個 current document version，也不能安全做 access-level 判斷。

### D-FILTER: Filter builder 僅產生 AI Search metadata filter；D1 仍是權限真相

`buildKnowledgeSearchFilters()` 不得再產生 legacy AutoRAG filter shape：

```ts
{ type: 'eq', key: '...', value: '...' }
```

若 apply 階段需要恢復 remote pre-filter，必須輸出 AI Search / Vectorize-style metadata filter，並放在 `ai_search_options.retrieval.filters`。可接受 shape 包含：

```ts
{ folder: 'customer-a/' }
```

或：

```ts
{ and: [{ eq: { 'metadata.category': 'policy' } }] }
```

在 metadata schema 尚未確認前，access-level 與 current-version 篩選不得依賴 remote filter；D1 `resolveCurrentEvidence()` 繼續是 authoritative gate。

### D-CONFIG: 保留既有 instance id env key，但在 code 中收斂語意

`NUXT_KNOWLEDGE_AI_SEARCH_INDEX` 目前在 `nuxt.config.ts`、wrangler、deploy workflow、tests 中廣泛使用。為降低 blocker 修復 blast radius，本 change 可保留 env key 與 runtimeConfig field，但實作需在 type/comment/test 中明確把值視為 AI Search instance id。

若 apply 階段選擇改名為 `NUXT_KNOWLEDGE_AI_SEARCH_INSTANCE_ID`，必須同時更新 production/staging wrangler vars、GitHub Actions build env、tests、schema default 與 backwards compatibility fallback，避免 build-time/runtime 漂移。

**Why**: TD-071 是 critical runtime blocker，主要風險在 binding 與 payload shape；env key rename 不是解除 500 的必要條件。

### D-TEST: Test fake 要模擬新 binding，而非只 mock adapter return

`test/acceptance/helpers/bindings.ts` 的 `createAiSearchBindingFake()` 應改成：

```ts
{
  get(instanceId) {
    return {
      async search(request) {
        calls.push({ instanceId, request })
        return { chunks: responses[instanceId] ?? [] }
      },
    }
  },
  calls,
}
```

單元測試需直接 assert：

- `AI_SEARCH.get('agentic-rag-staging')` 被呼叫一次。
- request 沒有 top-level `max_num_results`、`ranking_options`、`rewrite_query`。
- request 有 `ai_search_options.retrieval.max_num_results` 與 `match_threshold`。
- response `chunks` 能正確 mapping 到 `KnowledgeSearchCandidate[]`。

**Why**: 過去 integration tests mock 了 adapter 回傳，容易漏掉 Cloudflare binding shape drift；本 blocker 正是 binding/request shape drift，tests 必須鎖 shape。

## Migration Plan

1. 修改 `server/utils/ai-search.ts` interface、client factory、request builder、response mapping。
2. 新增或調整 binding accessor，讓 search binding 從 `AI_SEARCH` 讀取，Workers AI `AI.run` 不受影響。
3. 修改 `server/utils/knowledge-retrieval.ts` filter builder，移除 legacy filter shape 並保留 D1 post-verification。
4. 修改三個 callsite：`chat.post.ts`、`server/mcp/tools/ask.ts`、`server/mcp/tools/search.ts`。
5. 修改 `wrangler.jsonc`、`wrangler.staging.jsonc`、`.github/workflows/deploy.yml` 與 `scripts/render-staging-wrangler.mjs` 的 binding/config propagation。
6. 更新 unit/integration/acceptance fakes 與 assertions。
7. 跑 local tests / typecheck / build。
8. Deploy staging 後自跑 API smoke 與 D1 query log evidence，確認 chat 不再 500 且 retrieval score 開始寫入。
9. 檢查 `rag-query-rewriting` 被 TD-071 擋住的 acceptance tasks 是否可恢復執行；實際勾選留在該 change 的 apply/archive 流程。

## Verification Plan

Apply 階段 Claude 必須自跑並把關鍵輸出貼到 `tasks.md ## 2. Backend Verification Evidence`：

- `pnpm test:unit test/unit/ai-search.test.ts test/unit/knowledge-retrieval.test.ts test/unit/require-ai-binding.test.ts`
- `pnpm test:integration` 或至少覆蓋 chat route、MCP ask/search route 的 integration subset。
- `pnpm typecheck`
- `pnpm build`
- 靜態搜尋確認 product code 不再呼叫 `.autorag(` 建立 retrieval search client。
- staging deploy 後執行 HTTP/API smoke，確認 staging chat 或 acceptance runner 不再回 500。
- staging D1 查最近 query logs，確認 `retrieval_score` 有非 null / 非零樣本，`rewriter_status` 依 feature flag 正確寫入。

## Rollback

若 staging deploy 後新 AI Search binding 出現不可接受的 runtime error：

1. 先 revert 此 change 或停在未 deploy production 狀態。
2. 不改 D1 schema，因本 change 無 migration。
3. 保留 `AI` Workers AI binding，因 answer/judge/rewriter 仍依賴它。
4. 重新部署上一版 worker，讓 production 回到既有狀態；TD-071 仍維持 open，不宣告 blocker 解除。

## Resolved Questions

### Q1: 這個 change 是否需要 UI view phase？

**Answer:** 不需要。本 change 不改任何 view-layer、layout 或 styling 檔案，只有 backend binding/client/config/tests，因此 tasks 使用單一非 view phase。

### Q2: 是否要在本 change 重做 query rewriter？

**Answer:** 不要。`knowledge-query-rewriter.ts` 不受 Cloudflare search binding API 直接影響；只需確保 adapter 關掉 Cloudflare 內建 query rewrite 或不啟用，避免與 app-level rewriter 雙重改寫。

### Q3: 是否要把 `NUXT_KNOWLEDGE_AI_SEARCH_INDEX` 立即改名？

**Answer:** 不強制。為解除 critical blocker，可先保留現有 env key 作 instance id；若 apply 階段判定改名較清楚，必須同批更新所有 runtime/build/test references 並保留相容 fallback。
