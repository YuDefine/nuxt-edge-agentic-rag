# Handoff

## In Progress

- [ ] **rag-query-rewriting** (16/34 tasks, 47%)
  - Code 已隨 v0.53.0 ship 到 production；staging `features.queryRewriting=true` 已生效
  - **6.1 partial pass**：flag wiring + audit 寫入 + fallback safety ✅；`rewriter_status='success'` path 受 local Workers AI binding 限制 → 待 6.4 staging 驗
  - 剩餘：3.3 prompt validation / 6.3 staging deploy / 6.4-6.6 staging acceptance / 7.1-7.5 follow-ups
  - 無 active claim — 接手前 `pnpm spectra:claim -- rag-query-rewriting`

- [ ] **adopt-evlog-nuxthub-ai-t3** (5/39 tasks, 13%)
  - 早期階段，尚未大量推進；獨立可平行

## Blocked / Waiting

- **deploy-docs-staging fail — vitepress `dynamic-import-vars`**（2026-05-19 run [26090866330](https://github.com/YuDefine/nuxt-edge-agentic-rag/actions/runs/26090866330)）
  - vitepress build 把 `docs/tech-debt.md` 當含 dynamic import 的 code parse → `Unexpected token`
  - CI 主流程（Format/Lint/Typecheck/Unit tests）皆綠，僅 deploy-docs-staging 卡此
  - 修法選項：(a) 排除 `docs/**` 從 dynamic-import-vars plugin scope；(b) 調整 vite.config.ts
  - _(未驗證是否仍紅 — 最新 CI runs 未觸發此 workflow)_

- **TD-056 / TD-061 / TD-057 behavior 驗收**（皆 open）
  - TD-056（high）+ TD-061（high）同 root cause：judge `max_completion_tokens: 200` 截斷 → JSON parse fail → pipeline_error（production 重測批次 28.6%）
  - TD-057（mid）：evlog wide event lifecycle 警告，`log.error()` 在 emit 後呼叫
  - **Acceptance dependency**：TD-061 最終驗收依賴 `rag-query-rewriting` staging ramp（fixture 需進 judge gate，retrieval_score ≥0.45 才有 truncation 路徑可驗）
  - v0.52.1 fix code 已 ship，但 production 低流量無法被動觸發 judge / SSE chat path → 需主動登入 `agentic.yudefine.com.tw` 發 1-2 條 chat 觸發

## Next Steps

1. **主動驗 TD-056/061/057**：production 發 chat → wrangler tail 看 `pipeline_error` 比例 + SSE wide event lifecycle
2. **rag-query-rewriting 6.3-6.6**：staging deploy → 35 筆 acceptance fixture（同時解 TD-061 acceptance dependency）
3. **adopt-evlog-nuxthub-ai-t3**：推進 impl（獨立，可平行）
4. **deploy-docs-staging fix**：排除 `docs/` 從 dynamic-import-vars scope（註：2026-06-08 staging deploy run 27135494946 的 `deploy-docs-staging` job 這次 success，未復現此 blocker — 待確認是否已自然解決）

## Worktree & Stash Audit

_Updated: 2026-06-08_

### Worktrees (0)

No linked worktrees.

### Stashes (1)

- `stash@{0}` — `rag-query-rewriting tasks.md marker-hygiene WIP`
  - 內容：`openspec/changes/rag-query-rewriting/tasks.md` 把 7 條人工檢查項加上 `#N [discuss]` marker
  - 為何 stash：該 change 仍 in-flight（6.3-6.5 staging acceptance 未跑），7 條 `[discuss]` 人工檢查綁 staging evidence 暫勾不了；marker-hygiene 編輯被 `/commit` 0-MR gate（main + impl[x] + 人工檢查[ ]）擋住，holdout 出本次 commit
  - 收尾：該 change 跑完 staging acceptance、走 `/spectra-archive` Step 2.5 walkthrough 時 `git stash pop` 一起進；或 `git stash drop` 後在 archive 階段重 apply marker

> 旁注：`refs/wt-baseline/*` 有 4 個 dangling rescue ref（`fix-deploy-docs-staging` / `fix-vite-doctor-findings` / `fix-vite-doctor` / `nuxt-bump`），來自已清掉的 worktree。非 worktree / 非 stash，可保留作救援保險絲，要清用 `git update-ref -d <ref>`（此 consumer 未投影 `wt-helper.mjs`，無法走 `wt-helper rescue --prune`）。

## Review-gui Readiness

_Updated: 2026-06-08 /hub-core:handoff Mode B — clade scan_

### ✅ Ready (0)

_(none)_

### ⚠ notReady (0)

_(scan returned 0 changes for nuxt-edge-agentic-rag — 3 個 active change 皆早期階段，尚無 review-gui manual-review tracked state；以 In Progress 段的 tasks 進度為準)_

## Notes

- Working tree 乾淨；main 與 origin/main 同步；最新版本 **v0.56.4**
- CI 紅燈 `ERR_PNPM_OUTDATED_LOCKFILE` 已解決（`vite-doctor` 已在 lockfile，2026-06-05 CI + Deploy run 皆 success）
- `tasks/todo.md` 是已完成的 demo seed audit（all `[x]`），違反 session-tasks per-session 分檔規約，可直接刪除
