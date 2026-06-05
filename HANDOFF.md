# Handoff

## In Progress

- [ ] **rag-query-rewriting** (16/34 tasks, 47%)
  - Code 已隨 v0.53.0 ship 到 production；staging `features.queryRewriting=true` 已生效
  - **6.1 partial pass**：flag wiring + audit 寫入 + fallback safety ✅；`rewriter_status='success'` path 受 local Workers AI binding 限制 → 待 6.4 staging 驗
  - 剩餘：3.3 prompt validation / 6.3 staging deploy / 6.4-6.6 staging acceptance / 7.1-7.5 follow-ups
  - 無 active claim — 接手前 `pnpm spectra:claim -- rag-query-rewriting`

- [ ] **adopt-evlog-nuxthub-ai-t3** (5/39 tasks, 13%)
  - 早期階段，尚未大量推進

- [ ] **migrate-deploy-notify-to-clade-action** (8/10 tasks, 80%)
  - 接近完成，剩 2 tasks

## Blocked / Waiting

- **CI 紅燈 — `ERR_PNPM_OUTDATED_LOCKFILE`**（2026-06-04 run [26934103646](https://github.com/YuDefine/nuxt-edge-agentic-rag/actions/runs/26934103646)）
  - `pnpm install --frozen-lockfile` fail — `vite-doctor@0.0.1` 在 `package.json` 但 lockfile 未同步
  - 根因：clade v1.4.135 propagation 在 working tree 加了 `vite-doctor` devDep + `vendor/doctor-shared/`，尚未 commit + push
  - **修法**：`pnpm install` 更新 lockfile → `/commit` → push → CI 應綠

- **deploy-docs-staging fail — vitepress `dynamic-import-vars`**（2026-05-19 run [26090866330](https://github.com/YuDefine/nuxt-edge-agentic-rag/actions/runs/26090866330)）
  - vitepress build 把 `docs/tech-debt.md` 當含 dynamic import 的 code parse → `Unexpected token`
  - CI 主流程（Format/Lint/Typecheck/Unit tests）皆綠，僅 deploy-docs-staging 卡此
  - 修法選項：(a) 排除 `docs/**` 從 dynamic-import-vars plugin scope；(b) 調整 vite.config.ts

- **TD-056 / TD-061 / TD-057 behavior 驗收**
  - v0.52.1 fix code 已 ship，但 production 低流量無法被動觸發 judge / SSE chat path
  - 需主動登入 `agentic.yudefine.com.tw` 發 1-2 條 chat 觸發

## Next Steps

1. **修 CI 紅燈**（最高優先）：`pnpm install` sync lockfile + commit clade v1.4.135 propagation artifacts → push
2. **主動驗 TD-056/061/057**：production 發 chat → wrangler tail 看 `pipeline_error` 比例 + SSE wide event lifecycle
3. **rag-query-rewriting 6.3-6.6**：staging deploy → 35 筆 acceptance fixture
4. **migrate-deploy-notify-to-clade-action**：完成剩餘 2 tasks
5. **adopt-evlog-nuxthub-ai-t3**：推進 impl（獨立，可平行）
6. **deploy-docs-staging fix**：排除 `docs/` 從 dynamic-import-vars scope

## Worktree & Stash Audit

_Updated: 2026-06-05_

### Worktrees (2)

- `/private/tmp/ci-fix-wt2` (detached HEAD `e91cf92`) — **unmanaged / prunable** — `git worktree remove /private/tmp/ci-fix-wt2`
- `/private/tmp/nuxt-edge-agentic-rag-ci-fix` (detached HEAD `04aba38`) — **unmanaged / prunable** — `git worktree remove /private/tmp/nuxt-edge-agentic-rag-ci-fix`

### Stashes (0)

No stashes.

## Review-gui Readiness

_Updated: 2026-06-05 /hub-core:handoff Mode B — scan_

### ✅ Ready (0)

_(none — nuxt-edge-agentic-rag 無 review-gui tracked changes in ready state)_

### ⚠ notReady (3)

- `adopt-evlog-nuxthub-ai-t3` | bucket=`applyInProgress` | 5/39 (13%)
- `migrate-deploy-notify-to-clade-action` | bucket=`applyInProgress` | 8/10 (80%)
- `rag-query-rewriting` | bucket=`applyInProgress` | 16/34 (47%)

## Notes

- Working tree 有 clade v1.4.135 propagation 未 commit 改動（`.agents/skills/*`、`.clade/`、`.codex/`、`vendor/doctor-shared/`、`package.json`、`pnpm-lock.yaml` 等）
- `tasks/todo.md` 是已完成的 demo seed audit（all `[x]`），違反 session-tasks per-session 分檔規約，可直接刪除
- 最新版本 v0.56.1，main 已與 origin/main 同步
