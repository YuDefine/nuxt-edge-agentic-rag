# Handoff

## In Progress

- [ ] **dev-login canonical migration**（clade v0.5.10 設計同步） — 已實作未 commit（2026-05-09 由 perno session 主線派 subagent 完成）
  - `server/api/_dev/login.post.ts` (+50/-10): 加 `as` body param（`z.enum(['admin','member','guest']).optional()`）、`DevLoginRole` 型別、403→404、`as=admin` 必須 ALLOWLIST 否則 403、`as=guest` 400 stub、結構化 `log.info('[dev-login]', {...})` 含 route/requestedAs/requestedEmail/resolvedRole/action/environment
  - `e2e/helpers.ts` (+24/-9): `devLogin(page, email, options?: { as? })` 接 optional `as` field
  - `test/integration/dev-login-route.test.ts` (+106/-1): 5 個新 test，7/7 pass
  - **Verify**: lint 0/0、typecheck 0、7/7 test pass
  - **Risks**: `as=guest` 是 400 stub 待 caller 實作；log action 命名（`session_created` / `session_signed_up`）跨 consumer 對齊待視；allowlisted email + `as=member` 允許（讓 admin email 測 member UX）
  - **Next**: `git status` → `/commit`，主題建議 `✨ feat(auth/dev-login): align with canonical — 403→404 + as body param + ALLOWLIST guard`
  - **Source of Truth**: `~/offline/clade/openspec/discussions/dev-login-canonical-design.md` § Migration Plan E（lines 1104-1136）；rule 已 propagate 到 `.claude/rules/modules/auth/better-auth/dev-login.md`

- [ ] **rag-query-rewriting** (16/34 tasks, 47% — 6.1 standing as **partial pass**)
  - Code 已隨 v0.53.0 ship 到 production；staging `features.queryRewriting=true` 已生效
  - **6.1 partial pass**（commit `b5eca44`）：flag wiring + audit 寫入機制 + fallback safety 三層 ✅；
    `rewriter_status='success'` path 與 `rewritten_query` 內容受 local Workers AI binding 限制 → 待 6.4 staging 驗
    - Evidence: `local/reports/notes/rag-query-rewriting-6.1-local-smoke-20260426.md`（gitignored）
  - 剩餘 task：3.3 prompt validation / 6.3 staging deploy / 6.4-6.6 staging acceptance / 7.1-7.5 follow-ups
  - 無 active claim — 接手前 `pnpm spectra:claim -- rag-query-rewriting`

## Blocked / Waiting

- **v0.56.0 deploy run 25405616391 已 fail**：`verify-ci-gate` 找不到 SHA `bb741e3` 的成功 CI run。根因：main branch 落後 origin/main 13 commit，`bb741e3` 沒推上 origin → 沒 ci.yml run 對應 → verify-ci-gate 死循環 attempt 1~44 後 fail。**修法**：先 `git push origin main`（觸發 ci.yml），等 CI 綠燈後 deploy.yml 應可手動 rerun。
- **TD-056 / TD-061 / TD-057 behavior 驗收**：v0.52.1 fix code 已 ship 且 root cause 完美對應
  （3/3 ship 前 pipeline_error 都是 judge `completionTokens=200` 截斷），但 production 24h
  只 1 筆 traffic 沒走 judge / SSE chat path → 需要主動發 chat 才能驗證 fix 生效
- **Clade upstream issue（codex Round 1+2 P1）**：`hub v0.3.39` sync 把 `.claude/skills/spectra-apply/SKILL.md` 的 phase dispatch template 第一行 `[DELEGATED-BY-CLAUDE-CODE]` marker 移除，但 `.claude/rules/agent-routing.md` 「Codex `$spectra-apply` Runtime Gate」仍要求 marker，造成 Codex spectra-apply phase dispatch 會被 gate 擋掉。SKILL 是 LOCKED 投影檔（chmod 444 + hook 自動還原），本地反向修無效，需在 `~/offline/clade` 的 `plugins/hub-core/skills/spectra-apply/` upstream 修並 publish v0.3.40。

## Next Steps

1. **`git push origin main`** ← **最高優先**：本次 13 個 commit（v0.56.0 + v0.56.1 兩波）尚未 push 到 origin/main；v0.56.0 deploy 已因此 fail，先 push main 觸發 ci.yml，再手動 rerun v0.56.0 / v0.56.1 deploy run
2. **修 clade upstream `[DELEGATED-BY-CLAUDE-CODE]` marker 不一致**：到 `~/offline/clade/plugins/hub-core/skills/spectra-apply/SKILL.md` 把 marker hint + prompt body 第一行加回，publish hub v0.3.40，propagate 到 consumers
3. **v0.56.x production verify**（push + deploy 綠燈後）
   - 主要驗 deploy 沒打破 build pipeline
   - 確認 production worker `features.queryRewriting=false` 仍生效
   - production / staging demo seed 系統已可用：`pnpm demo-seed <env> --apply` 寫入 + AI Search sync + structured filter verification（失敗會 fail loudly，不再靜默 exit 0）
4. 主動發 1-2 條 production chat 觸發 judge path 驗 TD-056 / TD-057 behavior
   （登入 `agentic.yudefine.com.tw` 或拿 admin token）
5. **rag-query-rewriting 6.3**：`gh workflow run deploy.yml -f target=staging` 觸發 staging 部署
6. **rag-query-rewriting 6.4 / 6.5**：staging RAG 資料已就緒；對 staging 跑 35 筆 acceptance fixture，記證據到
   `local/reports/notes/main-v0.0.54-acceptance-rewriter-staging-{date}.md`；6.1 的 success path
   會在 staging 驗到，可順帶確認
7. **rag-query-rewriting 3.3**：5 條 fixture prompt validation（建議在 staging 跑，因為 local Workers AI
   會 fallback_error 看不到改寫結果）
8. TD-027 MCP connector first-time auth 實測（DO archive 已完成，可隨時實測 Claude.ai OAuth flow）

## Notes / Pitfalls

- **v0.56.1 commit 範圍**（2 chore + 1 deploy）：
  - `chore`: clade hub v0.3.38 → v0.3.39 sync（spectra-apply / design-gate / post-propose-check / collect-followups / roadmap-sync / upgrade-design-review）
  - `chore`: roadmap-sync.mts 修正 `--check` 缺 spectra CLI 整體早退 bug（codex Round 1 P2）—— 缺 CLI 時 Active Changes / Active Claims / Parallel Tracks / MANUAL drift 都還能跑，只 preserve existing Parked block
  - `chore`: 還原 design-gate.sh executable bit（Edit 工具誤改 100644）
- **v0.56.0 commit 範圍**（8 group + 1 deploy + 1 handoff，分別為）：
  - `feat`: production / staging demo seed 系統（+ TD-050 done closeout）
  - `feat`: 統一 codex review 派工流程（commit 0-A 兩輪 high → xhigh、spectra propose draft + cross-check、apply phase dispatch、Codex `$spectra-apply` Runtime Gate）
  - `feat`: spectra design review 7 步 template 結構性強制（含 DR_TASK_LINES ≥ 7 條件）+ `pnpm spectra:upgrade-design-review` 升級工具
  - `feat`: 新增 `.claude/rules/nuxt-security.md` baseline rule + nuxt.config.ts 對齊
  - `chore`: vite/vitest 升級至 0.1.20 catalog 模式（`pnpm-workspace.yaml` catalog + `package.json` 用 `catalog:` 引用 + lockfile rebuild + `better-auth-passkey-hotfix-version.test.ts` 同步更新期望）
  - `ci`: e2e workflow 補 `NUXT_KNOWLEDGE_ENVIRONMENT` / `NUXT_MCP_AUTH_SIGNING_KEY` env，playwright wrangler dev 加 `--local`
  - `chore`: 雜項（rule reference、ROADMAP TD-050 strikethrough、vitepress nav、design-gate.sh 100755 還原）
- Production / staging demo seed：`pnpm demo-seed <staging|production> --apply` 寫入 12 docs / 14 versions / 94 source chunks / 16 query logs / 5 users / 4 MCP tokens，並觸發 AI Search sync；維護方式見 `docs/runbooks/demo-seed.md`。**新行為**：AI Search sync 失敗或 verifyDemoSearches matched=0 會 throw（exit 1），不再靜默 exit 0
- `demo-seed-worker.ts` 缺 `DEMO_SEED_TOKEN` binding 時 fail closed（500），不再繞過 auth 直接寫 D1/R2
- **csrf-token wiring**（curl 對 `/api/chat` 用）：`GET /` parse `<meta name="csrf-token" content="...">`
  → POST 帶 `csrf-token: <token>` header + cookie jar（含 `csrf=...` + `better-auth.session_token=...`）
- Local Workers AI binding 跑 rewriter judge model 會 fallback_error；fallback safety 機制工作正常，
  不影響 staging / production 真實環境
- vue-tsc stack trace `vue-router/volar/sfc-route-blocks Cannot find module` 是 vue-tsc@3.2.7 對舊
  vue-router optional plugin 的解析錯誤，**typecheck exit 0**，不影響 commit / deploy
- **`pnpm tag` 推 tags rejection noise**：`git push origin --tags` 一次推所有 local tags，撞到 8 個歷史
  tag (v0.47.x ~ v0.50.x) local/remote 不一致 → exit 1。新 tag（如本次 v0.56.0）仍會成功 push，可用
  `git ls-remote --tags origin v<version>` 驗證。下次有空可清 stale local tags 或改用 `git push origin v<version>`
  只推單一 tag
- **Codex `$spectra-apply` Runtime Gate**：Codex 端收到 `$spectra-apply` 必須先驗 prompt body 第一行是 `[DELEGATED-BY-CLAUDE-CODE]`，缺 marker 立即 STOP。Claude Code 主線派 Codex 跑 spectra apply phase 時 prompt 第一行 MUST 加此 marker（已寫進 spectra-apply SKILL 模板）
