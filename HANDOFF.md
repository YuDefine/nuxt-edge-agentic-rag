# Handoff

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
