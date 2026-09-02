# Handoff

## ✅ RESOLVED — Production chat 空回答（root cause 三重驗證 + 修法已驗，待 deploy）

**症狀**（已解）：production 問「PO 和 PR 差別」→ `event: complete` 帶 `answer:""`（decision_path=direct_answer + accepted + citations 正常 + refused:false，但 `messages.content_redacted` 空）。retrieval 正常、answer 生成壞掉。

### Root cause（三重驗證：binding probe 實測 + production D1 query_logs + codex docs）

**answer 生成誤用 reasoning model `@cf/moonshotai/kimi-k2.5`，其 `reasoning_content`（思考）吃光 `max_completion_tokens` budget → `message.content` 變空字串。**

因果鏈：

1. 「PO/PR」evidence 來自多個 document → `selectAnswerModelRole`（`knowledge-answering.ts`）對多-doc 切到 `agentJudge` role
2. `agentJudge` role → `DEFAULT_MODEL_BY_ROLE.agentJudge` = kimi-k2.5（reasoning model）
3. kimi 回 OpenAI-style `{choices:[{message:{content, reasoning_content}}]}`，**先**輸出 reasoning_content 再輸出 content
4. answer 的 400 token budget 被 reasoning_content 吃光 → content 空 → 空 answer
5. judge 同源：kimi judge json_schema 在 1024 token 下 reasoning 吃光 → content=null → JSON parse throw → `pipeline_error`（影響 retrieval 0.45–0.5 邊緣 query）

**實測證據**（部署 minimal standalone worker 跑真實 `env.AI.run()`，已清理）：

- probe kimi short prompt（completion 295<400）content 完整；probe kimi judge 1024 token → finish_reason=length / content=null
- production query_logs：answer run = kimi、completion_tokens=400 達上限、`messages.content_redacted` len=0 完全吻合
- probe llama control：`{response}` shape 完美答案；llama judge json_schema 5s / `{response:object}` 正常解析

### 修法（已 commit，待 deploy 驗證）

**核心：`DEFAULT_MODEL_BY_ROLE.agentJudge` kimi-k2.5 → llama-3.3-70b（instruct model）** — 三害（answer 多-doc / judge / rewriter）同源於 agentJudge role 指向 reasoning model，一改同時解。

- `selectAnswerModelRole` 簡化為一律 `defaultAnswer`（answer 不借用 judge role）
- 4 處測試 model 斷言 kimi→llama + 2 個 regression 測試（文件化 `{choices}` reasoning shape + 空 content 坑）
- 驗證：test 30 passed + typecheck EXIT=0；probe 三重驗證 llama answer + judge(json_schema) 都正常

### 為何之前 9 版沒解（避免重踩）

- v0.57.5 降門檻 0.7→0.5：只解鎖 direct_answer **path**，沒碰 answer **model**
- v0.57.6 換 llama-4-scout→llama-3.3-70b：**改錯 role**（改 `defaultAnswer`，但多-doc 走 `agentJudge`=kimi）
- v0.57.7 關 cache / v0.57.9 non-stream：與 root cause 無關（binding shape 對了，但 reasoning 仍吃光 token）
- 一直假設「llama binding shape 不匹配」，真兇是被 role 切換選中的 kimi reasoning model

### Deploy / 驗證 ✅ DONE（2026-06-09）

- [x] tag v0.57.10 → CI deploy **success**（run 27199909260）
- [x] production 驗證 **passed**：問「PO/PR 差別」→ `event: delta`（有內容）+ 完整 answer + 4 citations + refused:false。D1 確認：decision_path=direct_answer、answer model=`@cf/meta/llama-3.3-70b-instruct-fp8-fast`、modelRole=`defaultAnswer`、`messages.content_redacted` len=107（非空）、latency 7.8s（vs kimi 16-31s，快 2-4 倍）、completionTokens=87
- demo 其他項目 ready：報告 `local/reports/archive/main-v0.0.55.{md,docx}`、`local/reports/notes/demo-cheatsheet-2026-06-10.md`、引導問題已對應知識庫

### 待清理（非 blocker）

- AI Gateway cache 仍關著（v0.57.7，`wrangler.jsonc` `NUXT_KNOWLEDGE_AI_GATEWAY_CACHE_ENABLED=false`）— 修好後評估重開
- judge 已換 llama instruct；未來若要回 reasoning model 需提高 token budget（probe 證明 2048 夠，但 llama 最穩、最快 5s）
- `refs/wt-baseline/fix-chat-empty-answer/*` rescue ref（本次 worktree）+ 既有 dangling，可 `wt-helper rescue --prune` / `git update-ref -d` 清理

---

## In Progress

- [ ] **rag-query-rewriting** (21/27 tasks, 78%) — **TD-071 已解（v0.57.1 production deployed 2026-06-09）**，blocker 移除
  - AI Search migration 已 live：staging retrieval_score=0.51、production HTTP 200
  - 剩餘 6 項（不再 blocked）：3.3 / 6.1 / 6.3 / 6.4 / 6.5 / 6.6
  - 無 active claim — 接手前 `pnpm spectra:claim -- rag-query-rewriting`

- [ ] **adopt-evlog-nuxthub-ai-t3** (5/39 tasks, 13%)
  - 早期階段，尚未大量推進；獨立可平行

## Ready for review

- [ ] [2026-09-02] **hub.json db 軸修正：`db-schema: supabase` / `db-runtime: cf-workers` → `cf-d1` / `none`**
  - 改了什麼：`.claude/hub.json` 兩軸改宣告；`hub:prune` 拿掉 9 份 Supabase 專用投影（database-access / storage / unused-features / mcp-remote / audit-schema / migration / rls-policy / trigger / query-optimization），新投影 `data-layer-d1.md`；project-scope plugin 換成 `hub-db-schema-cf-d1`，卸 `hub-db-schema-supabase` 與 `hub-db-runtime-cf-workers`
  - 證據：repo 只有 `drizzle-orm` / `drizzle-kit` / `@nuxthub/core`，`wrangler.jsonc` 綁 D1，無 `@supabase/supabase-js`；`db-runtime` enum 只有 supabase-* / cf-workers（README 明寫 cf-workers = Supabase 存取）/ none，rental-scout 同為 cf-d1 + `none`；`pnpm hub:check` 綠（no drift, no orphans）
  - 退回會怎樣：18.8 KB Supabase client 規約會在每次動 `server/**` 時被注入，而 D1 / Drizzle 的 hard rule（subquery alias、dev binding 鎖死、DROP TABLE cascade）一條都不載
  - **需要 clade 判斷的缺口**：`db-runtime` 軸沒有 D1 / Drizzle 存取層的值，`none` 只是「不要 Supabase 規約」的替代寫法。若 clade 認為 D1 存取層值得獨立 variant（例：`cf-d1`），需要新增；若認為 `db-schema/cf-d1/data-layer-d1.md` 已涵蓋存取層，建議 `db-runtime/README.md` 補一句「D1 track 宣告 `none`」。另：rental-scout 宣告 `none` 卻仍留著 cf-workers 的 Supabase 投影（未 prune），是同型錯配
  - 附帶：`hub.json` 的 `localHooks: post-migration-gen-types.sh` 指向的檔案不存在（`.claude/hooks/` 只有 `_bootstrap-check.sh`），本次未動，待判要不要移除
  - 未達成的 gate：commit 0-A.1 跨模型 review 未跑（codex 池與 cursor 池同時配額耗盡，cursor 於 2026-09-16 重置；exit 4 payload 指示主線自審＋登記待補）。0-C 的 lint 紅燈全部來自另一 session 的 untracked e2e spec，test 失敗為 propagate 併行時的 nuxt hook timeout，皆與本批 json / symlink / md 無關
  - 教訓：hub.json 的 modules 改動 MUST 在下一次 clade propagate 前 commit——propagate 的 main flow 會把 `.claude/hub.json` 與投影層 reset 到 HEAD 再 bump（本次 19:57 被 v1.12.0 propagate 還原一次，重做後才落地）
  - 已 commit 未 push：main 本來就領先 origin 30+ commit，deploy-trigger-check 回 `status=unconfirmable`，push 由持有 main 的人統一處理

## Blocked / Waiting

- ~~TD-071~~ **done** — v0.57.1 production deployed
- **TD-056 / TD-061 / TD-057 behavior 驗收**（皆 open）
  - TD-071 blocker 已移除，可開始 acceptance

## Next Steps

1. ~~TD-071~~ **done** v0.57.1
2. **rag-query-rewriting 6.3-6.6 acceptance**：TD-071 解鎖，可開始 staging + production acceptance
3. **adopt-evlog-nuxthub-ai-t3**：推進 impl（獨立，可平行）
4. **TD-056 / TD-061 / TD-057 behavior 驗收**：production 觀察 pipeline_error 比例

## Follow-ups（2026-08-29 session — TD-685 heavy-gate relay）

- [ ] **debdfba0 已 commit 未 push** — `🧹 chore: build script 納入 heavy-gate semaphore`
  - 卡在 Step 6-Gate：`verdict=needs-approval status=unconfirmable`
  - `detail=production deploy workflows disagree (deploy.yml) — declare the production trigger, not the staging one`
  - main push 會不會觸發 production deploy 推不出結論，故未 push（不是失敗，是 fail-closed）
  - 收尾：修 `.claude/consumer-meta.json` 的 `deploy.deployTrigger` 宣告使其與 `deploy.yml` 一致，或改 workflow；宣告修正是獨立工作，NEVER 夾在別的 commit 裡
- [ ] **既有測試紅燈：5 個 test file 在 `setupNuxt()` hook 10s timeout**（與本次改動無關，已用 stash 對照驗證 HEAD 原狀同樣紅）
  - `test/unit/auth-return-to.spec.ts`、`auth-return-to-pending-delete.test.ts`、`chat-conversation-history.test.ts`、`chat-conversation-session.test.ts`、`create-chat-conversation-history.spec.ts`
  - 單獨重跑仍紅 → 不是負載 flake，是 nuxt test environment setup 的真紅燈
  - 另兩個 chart test（`debug-outcome-breakdown` / `admin-usage-timeline-chart`）在 build 併發下 5s timeout，機器閒置時重跑即綠 → 那兩個是負載 flake，不是 bug
- [ ] **clade `scripts/audit-gate-coverage.ts` 尚無 § 3b heavy-label 覆蓋表** — TD-685 relay 的驗收標準 1 目前無從機械驗證（§ 3 只列 test / lint / typecheck，不含 build）。這條屬 clade 端，consumer 不動

## Worktree & Stash Audit

_Updated: 2026-06-09_

### Worktrees (0)

No linked worktrees.

### Stashes (1)

- `stash@{0}` — `rag-query-rewriting tasks.md marker-hygiene WIP` **← STALE，可 drop**
  - 已被 2026-06-09 session 直接 edit 進 working tree 取代
  - 收尾：`git stash drop`

## Follow-ups（2026-06-08 session）

- [ ] **sign-out API 回 500** — 獨立 bug，疑似 D1 相關
- [ ] **D1 transaction pitfall 待補** — 寫進 clade `docs/pitfalls/` 跨 consumer 共享
- [ ] **Notion「Secret」頁同步** — staging wrangler section + Environment-scoped Secrets table 舊值待更新

## Deferred discuss items

<!-- deferred-begin:autorag-to-ai-search-migration:#1 -->
- **autorag-to-ai-search-migration** #1 — Production deploy authorization
  - Awaiting signal: production tag push deploy
  - Resume: `/spectra-archive autorag-to-ai-search-migration`
  - Deferred at: 2026-06-09T04:35:00Z
<!-- deferred-end:autorag-to-ai-search-migration:#1 -->

<!-- deferred-begin:autorag-to-ai-search-migration:#2 -->
- **autorag-to-ai-search-migration** #2 — Production cutover observation
  - Awaiting signal: production deploy 完成後 D1 query_logs evidence
  - Resume: `/spectra-archive autorag-to-ai-search-migration`
  - Deferred at: 2026-06-09T04:35:00Z
<!-- deferred-end:autorag-to-ai-search-migration:#2 -->

<!-- deferred-begin:autorag-to-ai-search-migration:#3 -->
- **autorag-to-ai-search-migration** #3 — rag-query-rewriting blocker release
  - Awaiting signal: production deploy + TD-071 close
  - Resume: `/spectra-archive autorag-to-ai-search-migration`
  - Deferred at: 2026-06-09T04:35:00Z
<!-- deferred-end:autorag-to-ai-search-migration:#3 -->

<!-- deferred-begin:rag-query-rewriting:#2 -->
- **rag-query-rewriting** #2 — Latency p95 增量 < 800ms
  - Awaiting signal: staging app endpoint p95 實測（REST search total 不適用，rewriter call ~749ms 為 proxy）
  - Resume: `/spectra-archive rag-query-rewriting`
  - Deferred at: 2026-06-09T11:05:33Z
<!-- deferred-end:rag-query-rewriting:#2 -->

<!-- deferred-begin:rich-document-extraction-tests:#1 -->
- **rich-document-extraction-tests** #1 — staging PDF 上傳到 chat citation evidence walkthrough
  - Awaiting signal: staging deploy + PDF upload + sync/publish
  - Resume: `/spectra-archive rich-document-extraction-tests`
  - Deferred at: 2026-06-10T06:15:00Z
<!-- deferred-end:rich-document-extraction-tests:#1 -->

<!-- deferred-begin:rich-document-extraction-tests:#2 -->
- **rich-document-extraction-tests** #2 — production PDF round-trip 授權與觀察結果
  - Awaiting signal: production deploy 授權 + staging 先完成
  - Resume: `/spectra-archive rich-document-extraction-tests`
  - Deferred at: 2026-06-10T06:15:00Z
<!-- deferred-end:rich-document-extraction-tests:#2 -->

<!-- deferred-begin:rich-document-extraction-tests:#3 -->
- **rich-document-extraction-tests** #3 — staging/production POST /api/chat HTTP round-trip
  - Awaiting signal: staging deploy + published PDF available
  - Resume: `/spectra-archive rich-document-extraction-tests`
  - Deferred at: 2026-06-10T06:15:00Z
<!-- deferred-end:rich-document-extraction-tests:#3 -->

<!-- deferred-begin:rich-document-extraction-tests:#4 -->
- **rich-document-extraction-tests** #4 — staging/production GET /api/citations citation replay
  - Awaiting signal: #3 completion to capture citationId
  - Resume: `/spectra-archive rich-document-extraction-tests`
  - Deferred at: 2026-06-10T06:15:00Z
<!-- deferred-end:rich-document-extraction-tests:#4 -->

## Notes

- v0.56.7 已 deploy（CI 綠燈，run 27159609379）：移除 AutoRAG pre-search metadata filter
- `refs/wt-baseline/*` 有 5 個 dangling rescue ref（含本 session `fix-autorag-filter`），可 `git update-ref -d` 清理
