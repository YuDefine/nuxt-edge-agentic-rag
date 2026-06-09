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

## Blocked / Waiting

- ~~TD-071~~ **done** — v0.57.1 production deployed
- **TD-056 / TD-061 / TD-057 behavior 驗收**（皆 open）
  - TD-071 blocker 已移除，可開始 acceptance

## Next Steps

1. ~~TD-071~~ **done** v0.57.1
2. **rag-query-rewriting 6.3-6.6 acceptance**：TD-071 解鎖，可開始 staging + production acceptance
3. **adopt-evlog-nuxthub-ai-t3**：推進 impl（獨立，可平行）
4. **TD-056 / TD-061 / TD-057 behavior 驗收**：production 觀察 pipeline_error 比例

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

## Notes

- v0.56.7 已 deploy（CI 綠燈，run 27159609379）：移除 AutoRAG pre-search metadata filter
- `refs/wt-baseline/*` 有 5 個 dangling rescue ref（含本 session `fix-autorag-filter`），可 `git update-ref -d` 清理
