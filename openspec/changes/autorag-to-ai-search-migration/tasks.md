> Cross-reference key:
>
> - **[D-BIND]** = design「採用 `ai_search_namespaces` + `AI_SEARCH.get(instanceId)`」
> - **[D-ACCESSOR]** = design「不再用 `requireAiBinding(... method: 'autorag')` 取得 search binding」
> - **[D-REQUEST]** = design「Adapter 內集中做 request shape translation」
> - **[D-RESPONSE]** = design「`chunks` mapping 必須 fail closed」
> - **[D-FILTER]** = design「Filter builder 僅產生 AI Search metadata filter；D1 仍是權限真相」
> - **[D-CONFIG]** = design「保留既有 instance id env key，但在 code 中收斂語意」
> - **[D-TEST]** = design「Test fake 要模擬新 binding，而非只 mock adapter return」
> - **[S-WEB]** = `workers-ai-grounded-answering` spec「Web retrieval SHALL use Cloudflare AI Search Workers binding」
> - **[S-REQ]** = `workers-ai-grounded-answering` spec「AI Search request mapping SHALL preserve retrieval governance」
> - **[S-RESP]** = `workers-ai-grounded-answering` spec「AI Search chunks SHALL map to verified evidence candidates」
> - **[S-MCP]** = `mcp-knowledge-tools` spec「MCP knowledge tools SHALL use the same AI Search retrieval adapter」

## 1. Backend AI Search Migration（非 view phase）

- [x] 1.1 更新 `server/utils/ai-search.ts` 的 binding interface：把 `CloudflareAiBindingLike.autorag(indexName).search()` 改為 AI Search namespace binding `get(instanceId).search()`；保留 `KnowledgeSearchCandidate[]` adapter return contract，對齊 [D-BIND] [S-WEB]。
- [x] 1.2 在 `createCloudflareAiSearchClient()` 內集中實作 request translation：`max_num_results` → `ai_search_options.retrieval.max_num_results`、`ranking_options.score_threshold` → `match_threshold`、非空 `filters` → `ai_search_options.retrieval.filters`；移除 top-level `ranking_options` / `rewrite_query` / `max_num_results`，對齊 [D-REQUEST] [S-REQ]。
- [x] 1.3 在 `createCloudflareAiSearchClient()` 內實作 `chunks` response mapping：從 `chunk.text`、`chunk.score`、`chunk.item.metadata.document_version_id`、`chunk.item.metadata.citation_locator`、`chunk.item.metadata.access_level` 建立 `KnowledgeSearchCandidate`；缺必要欄位的 chunk 丟棄，對齊 [D-RESPONSE] [S-RESP]。
- [x] 1.4 調整 `server/utils/knowledge-retrieval.ts` 的 `buildKnowledgeSearchFilters()`：不得輸出 legacy `{ type, key, value }` filter；若輸出 filter 必須是 AI Search metadata filter 且不取代 D1 `resolveCurrentEvidence()` authorization/current-version gate，對齊 [D-FILTER] [S-REQ]。
- [x] 1.5 新增或調整 Cloudflare binding accessor：search binding 從 `getCloudflareEnv(event).AI_SEARCH` 取得並驗證 `.get`；Workers AI `AI.run()` 仍走既有 `AI` binding，不可把兩種 binding 混用，對齊 [D-ACCESSOR]。
- [x] 1.6 更新 `server/api/chat.post.ts`：`getRequiredAiSearchBinding()` 不再要求 `method: 'autorag'`，建構 client 時傳入 AI Search namespace binding與 instance id；Web chat accepted/refusal contract 不變，對齊 [S-WEB]。
- [x] 1.7 更新 `server/mcp/tools/ask.ts`：MCP ask 使用同一個 AI Search adapter，保留 auth scope、citation mapping、rewriter telemetry 與 Workers AI answer/judge 行為，對齊 [S-MCP]。
- [x] 1.8 更新 `server/mcp/tools/search.ts`：MCP search 使用同一個 AI Search adapter，保留 `allowed_access_levels` 與 `results: []` refusal/visibility contract，對齊 [S-MCP]。
- [x] 1.9 更新 `wrangler.jsonc` 與 `wrangler.staging.jsonc`：加入 `ai_search_namespaces` binding `AI_SEARCH` 指向 `default` namespace；保留既有 `ai` binding `AI` 給 Workers AI，對齊 [D-BIND]。
- [x] 1.10 更新 `.github/workflows/deploy.yml` 與 `scripts/render-staging-wrangler.mjs`：確保 production/staging build env、rendered `.output` wrangler config 與 runtime vars 都保留 AI Search instance id 與 `AI_SEARCH` binding，不產生 build-time/runtime 漂移，對齊 [D-CONFIG]。
- [x] 1.11 更新 `nuxt.config.ts` / runtime config schema 的命名註解或欄位：若保留 `NUXT_KNOWLEDGE_AI_SEARCH_INDEX`，要明確把它視為 AI Search instance id；若改名為 `NUXT_KNOWLEDGE_AI_SEARCH_INSTANCE_ID`，同批提供相容 fallback 並更新所有 test fixtures，對齊 [D-CONFIG]。
- [x] 1.12 更新 `test/unit/ai-search.test.ts`：覆蓋 `AI_SEARCH.get(instanceId)`、新 request shape、空 filter 不送出、`chunks` mapping、metadata 缺漏 fail closed、Cloudflare search error propagation，對齊 [D-TEST] [S-REQ] [S-RESP]。
- [x] 1.13 更新 `test/unit/knowledge-retrieval.test.ts` 或等價 retrieval unit tests：assert retrieval 呼叫 search adapter 時仍帶治理所需的 max results / min score / filter intent，且 D1 post-verification 行為不因新 binding 改變，對齊 [D-FILTER]。
- [x] 1.14 更新 `test/unit/require-ai-binding.test.ts` 或新增 AI Search accessor tests：覆蓋 missing `AI_SEARCH`、missing `.get`、valid namespace binding、Workers AI `AI.run()` 不被 regression，對齊 [D-ACCESSOR]。
- [x] 1.15 更新 `test/acceptance/helpers/bindings.ts` 的 `createAiSearchBindingFake()` 與所有 integration/acceptance mocks：fake shape 改為 `{ get(instanceId).search(request) }` 並記錄 `{ instanceId, request }`，不再模擬 `.autorag()`，對齊 [D-TEST]。
- [x] 1.16 更新 chat / MCP integration tests 中對 `createCloudflareAiSearchClient` constructor args 的 assertions：確認三個 callsite 都傳入新 AI Search binding 與 instance id，並且沒有任何 production retrieval path 再依賴 `.autorag()`，對齊 [S-WEB] [S-MCP]。
- [x] 1.17 收尾 artifact sync：更新 `docs/tech-debt.md` TD-071 狀態與 evidence summary；解除 `openspec/changes/rag-query-rewriting/tasks.md` 的 `@apply-blocked[TD-071 AutoRAG to AI Search migration blocks staging acceptance]` 前，必須先完成本 change 的 staging evidence。

## 2. Backend Verification Evidence

> 由 apply 階段 Claude 自跑、自貼證據；**非**使用者人工檢查項目。每條 task 完成時 Claude 必須在 task 下貼出實際 command 與關鍵輸出節錄，archive 前確認已勾選且有 evidence。

- [x] 2.1 Unit gate：執行 `pnpm test test/unit/ai-search.test.ts test/unit/knowledge-retrieval.test.ts test/unit/require-ai-binding.test.ts`，貼出 pass summary；若 accessor test 改成新檔名，command 需列出實際檔名。
  - Command: `BETTER_AUTH_SECRET=build-only-test-better-auth-secret-32chars NUXT_SESSION_PASSWORD=build-only-test-session-password-32chars NUXT_ENV_DEV=true rtk pnpm test test/unit/ai-search.test.ts test/unit/knowledge-retrieval.test.ts test/unit/require-ai-binding.test.ts`
  - Output: `Test Files  3 passed (3)`；`Tests  21 passed (21)`；`Duration  119ms`
- [x] 2.2 Integration gate：執行覆蓋 Web chat、MCP ask、MCP search 的 integration subset，至少包含 `test/integration/chat-route.test.ts`、`test/unit/mcp-tool-ask.test.ts`、`test/unit/mcp-tool-search.test.ts`、相關 MCP route mock tests；貼出 pass summary。
  - Command: `BETTER_AUTH_SECRET=build-only-test-better-auth-secret-32chars NUXT_SESSION_PASSWORD=build-only-test-session-password-32chars NUXT_ENV_DEV=true rtk pnpm test test/integration/chat-route.test.ts test/unit/mcp-tool-ask.test.ts test/unit/mcp-tool-search.test.ts test/integration/mcp-routes.test.ts test/integration/mcp-oauth-tool-access.test.ts`
  - Output: `Test Files  5 passed (5)`；`Tests  27 passed (27)`；`Duration  239ms`
- [x] 2.3 Full local gate：執行 `pnpm typecheck`、`pnpm build`、`pnpm test:unit`、`pnpm test:integration`；若 baseline 既有紅燈，必須貼出 failing tests 與本 change 是否相關的判定，不可只寫「已知失敗」。
  - Command: `BETTER_AUTH_SECRET=build-only-test-better-auth-secret-32chars NUXT_SESSION_PASSWORD=build-only-test-session-password-32chars NUXT_ENV_DEV=true rtk pnpm typecheck`
  - Output: `TypeScript: No errors found`
  - Command: `BETTER_AUTH_SECRET=build-only-test-better-auth-secret-32chars NUXT_SESSION_PASSWORD=build-only-test-session-password-32chars NUXT_ENV_DEV=true rtk pnpm build`
  - Output: `[nitro] ✔ Nuxt Nitro server built`；`Generated .output/server/wrangler.json`；`Build complete!`
  - Command: `BETTER_AUTH_SECRET=build-only-test-better-auth-secret-32chars NUXT_SESSION_PASSWORD=build-only-test-session-password-32chars NUXT_ENV_DEV=true rtk pnpm test:unit`
  - Output: `Test Files  128 passed (128)`；`Tests  806 passed (806)`
  - Command: `BETTER_AUTH_SECRET=build-only-test-better-auth-secret-32chars NUXT_SESSION_PASSWORD=build-only-test-session-password-32chars NUXT_ENV_DEV=true rtk pnpm test:integration`
  - Output: `Test Files  90 passed (90)`；`Tests  485 passed | 1 skipped (486)`；note: expected test log includes `[retention-cleanup] simulated D1 outage`
- [x] 2.4 Static contract audit：執行 `rg -n "\.autorag\(|method: 'autorag'|response\.data|max_num_results|ranking_options|rewrite_query" server test wrangler*.jsonc .github/workflows/deploy.yml`，貼出剩餘 hits 並逐一分類：合法 legacy sync code、測試 fixture、或必須修掉的 retrieval path。
  - Command: `rg -n "\.autorag\(|method: 'autorag'|response\.data|max_num_results|ranking_options|rewrite_query" server test wrangler*.jsonc .github/workflows/deploy.yml`
  - Output: no `.autorag(`, `method: 'autorag'`, or `response.data` hits. Remaining hits are `max_num_results` / `ranking_options` / `rewrite_query` in `server/utils/knowledge-retrieval.ts` internal adapter input, `server/utils/ai-search.ts` translation tests, and unit/integration tests asserting the internal governance intent before translation; no production retrieval path calls legacy AutoRAG.
- [x] 2.5 Wrangler config audit：執行 `npx wrangler deploy --dry-run --config wrangler.staging.jsonc` 或等價 dry-run，貼出 config 中 `ai_search_namespaces` / `AI_SEARCH` 與既有 `AI` binding 同時存在的證據。
  - Command: `node scripts/render-staging-wrangler.mjs`
  - Output: `[render-staging-wrangler] wrote .../.output/server/wrangler.staging.json`
  - Command: `rg -n "ai_search_namespaces|AI_SEARCH|\"ai\"|\"binding\": \"AI\"|agentic-rag-staging" .output/server/wrangler.staging.json`
  - Output: `.output/server/wrangler.staging.json:41 "ai"`；`:42 "binding": "AI"`；`:44 "ai_search_namespaces"`；`:46 "binding": "AI_SEARCH"`；`:9 "NUXT_KNOWLEDGE_AI_SEARCH_INDEX": "agentic-rag-staging"`
  - Command: `(cd .output && npx wrangler deploy --dry-run --config server/wrangler.staging.json)`
  - Output: `env.AI_SEARCH (default) AI Search Namespace`；`env.AI AI`；`env.NUXT_KNOWLEDGE_AI_SEARCH_INDEX ("agentic-rag-staging")`; `--dry-run: exiting now.`
- [ ] 2.6 Staging deploy smoke：在取得 deploy 授權後部署 staging，使用既有 auth/acceptance helper 對 `https://agentic-staging.yudefine.com.tw` 觸發一筆 Web chat 或 staging acceptance runner，確認 HTTP 不再 500；貼出 request id、status 與 response 關鍵欄位。
- [ ] 2.7 Staging D1 evidence：查 staging `query_logs` 最近本次 request 的 `decision_path`、`retrieval_score`、`rewriter_status`、`created_at`，確認 `retrieval_score` 不再因 Cloudflare search 500 而整批缺失；貼出 SQL 與結果節錄。
- [ ] 2.8 MCP smoke：對 staging MCP `askKnowledge` 或 `searchKnowledge` 走既有 token/acceptance command，確認 search path 不再使用 legacy AutoRAG binding 且回傳 200 / JSON-RPC success；貼出 command 與結果節錄。
- [ ] 2.9 TD-071 close evidence：把 2.6-2.8 的 staging evidence 摘要回填 `docs/tech-debt.md` TD-071；若 production 尚未 deploy，必須清楚標記「staging verified；production pending authorization/deploy」。

## 人工檢查

> 由人類在驗收階段逐項確認，**禁止 agent 代勾**。

- [ ] #1 [discuss] Production deploy authorization：Claude 提供 2.1-2.9 staging/local evidence 後，由使用者判定是否允許把 AI Search binding migration 部署到 production。
- [ ] #2 [discuss] Production cutover observation：production deploy 完成後，Claude 準備當次 production HTTP / query log evidence，由使用者確認 TD-071 是否可視為 production 解鎖。
- [ ] #3 [discuss] `rag-query-rewriting` blocker release：Claude 提供本 change evidence 與 `rag-query-rewriting` 受阻 tasks 對照，由使用者確認是否恢復 `rag-query-rewriting` 6.3-6.6 staging acceptance。
