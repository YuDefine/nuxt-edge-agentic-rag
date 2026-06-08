# Handoff

## In Progress

- [ ] **rag-query-rewriting** (21/27 tasks, 78%) — **⏸ blocked on TD-071（AutoRAG → AI Search migration）**
  - Code 已隨 v0.53.0 ship 到 production；staging v0.56.7
  - **2026-06-09 diagnosis + partial fix**：
    - v0.56.6：filter shape `{type:'eq',key,value}` → Vectorize 原生 key-value → 解了 `vectorize_filter_not_serializable`
    - v0.56.7：AutoRAG index 無 custom_metadata schema → 移除 pre-search filter（post-search `resolveCurrentEvidence` 已覆蓋 status/version/access_level）
    - **仍 500**：`AutoRAGInternalError: Invalid input` — 整個 `.autorag().search()` request shape 已過時（`max_num_results` / `ranking_options` / `rewrite_query` 不再被 Cloudflare 接受）。根因是 **Cloudflare 已將 AutoRAG 遷移至 AI Search**，binding + request + response + filter 全部改了
  - **staging chat 時間軸**（evlog）：2026-05-04 最後一次 `direct_answer` 200 → 之後 100% pipeline_error → 2026-06-09 filter fix 後一次 200（20ms）但後續仍 500（`Invalid input`）
  - **解法**：TD-071 — 完整 AutoRAG → AI Search API migration（改 binding / request / response / filter / tests）
  - 剩餘 6 項（全卡 TD-071）：3.3 / 6.1 / 6.3 / 6.4 / 6.5 / 6.6
  - 無 active claim — 接手前 `pnpm spectra:claim -- rag-query-rewriting`
  - **前置仍就緒**：admin session（BH Chrome 9333）、知識庫 11 active 文件、CF token `/tmp/cf-staging-token`

- [ ] **adopt-evlog-nuxthub-ai-t3** (5/39 tasks, 13%)
  - 早期階段，尚未大量推進；獨立可平行

## Blocked / Waiting

- **TD-071（critical）AutoRAG → AI Search migration** — blocks rag-query-rewriting acceptance
  - 完整描述見 `docs/tech-debt.md` TD-071
  - 建議另開 spectra change `autorag-to-ai-search-migration` 處理

- **TD-056 / TD-061 / TD-057 behavior 驗收**（皆 open）
  - TD-061 acceptance dependency 耦合 rag-query-rewriting staging（也被 TD-071 間接 block）

## Next Steps

1. **TD-071 AutoRAG → AI Search migration**（critical，解鎖 rag acceptance）：查 AI Search Workers binding 完整 API → 改 `ai-search.ts` binding/request/response + `knowledge-retrieval.ts` filter → staging redeploy 驗證 chat 200 → 解鎖 6.3-6.6
2. **rag-query-rewriting 6.3-6.6**：TD-071 解後繼續 acceptance
3. **adopt-evlog-nuxthub-ai-t3**：推進 impl（獨立，可平行）

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

## Notes

- v0.56.7 已 deploy（CI 綠燈，run 27159609379）：移除 AutoRAG pre-search metadata filter
- `refs/wt-baseline/*` 有 5 個 dangling rescue ref（含本 session `fix-autorag-filter`），可 `git update-ref -d` 清理
