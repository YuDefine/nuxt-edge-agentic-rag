# Handoff

> 本檔只保留目前可接手的工作、外部 gate 與未結案 trigger。已完成的 production chat 空回答已由
> v0.57.10 deploy 與 production evidence 結案，不在此重複歷史敘述。

## In Progress

- [ ] **rag-query-rewriting** — 21/27 tasks（78%）；TD-071 已解（v0.57.1 production deployed），blocker 已移除。
  - 剩餘 3.3、6.1、6.3、6.4、6.5、6.6；先做 staging，再做 production acceptance。
  - 無 active claim；接手前執行 `pnpm spectra:claim -- rag-query-rewriting`。
- [ ] **adopt-evlog-nuxthub-ai-t3** — 5/39 tasks（13%）。TD-069 的 production D1 migration 與 §7.1–7.4
  evidence 仍未完成；`server/database/migrations/` 尚缺 `evlog_events` migration。
- [ ] **TD-045 local dev bootstrap** — cleanroom migration auto-apply、首次 `/api/_dev/login` + `/api/chat` round-trip，
  以及 `[nuxt-hub] DB binding not found` 間歇 500 trace 尚待驗證。

## Ready for review

- [ ] ✅ dismissed（2026-09-02 已判定不需再處置，保留為紀錄）: **2026-09-02 hub.json DB 軸修正** — 已改 `db-schema: cf-d1`、`db-runtime: none`，移除 Supabase 專用投影並通過
  `pnpm hub:check`；證據是 repo 只有 Drizzle/NuxtHub D1、`wrangler.jsonc` 有 D1 binding。
  - 待判 `db-runtime: none` 是否需要 clade 的 D1/Drizzle variant 或 README 說明。
  - `hub.json` 的 `localHooks: post-migration-gen-types.sh` 指向不存在檔案，尚未處理。
  - commit 的 cross-model review gate 0-A.1 尚未跑；主線 push 仍由持有 main 的 session 統一處理。
  - **教訓**：`hub.json` 的 `modules` 改動 **MUST** 在下一次 clade propagate 之前 commit —— propagate 的 main flow 會把 `.claude/hub.json` 與投影層 reset 回 HEAD 再 bump。本次 19:57 就被 v1.12.0 的 propagate 還原過一次，重做才落地。

## Blocked / Waiting

- [ ] **TD-027 MCP connector first-time authorization** — local migration 已驗；需 staging/production deploy 後，
  Claude.ai connector → Google OAuth → 原始 authorize URL → consent → MCP tool call 的完整 6 步 evidence。
- [ ] **TD-054 Safari private mode** — 三個新對話入口需在 Safari private window 實機跑過，確認無 toast / console error。
- [ ] **TD-056 / TD-061 / TD-057 behavior acceptance** — judge truncation、production pipeline_error 與 wide-event lifecycle
  仍需 production evidence；TD-061 最終驗收依賴 `rag-query-rewriting` 讓 fixture 進入 judge gate。
- [ ] **TD-068 deploy secrets** — production/staging runtime secret inventory、GitHub secret 對照、`secrets:` list 與 staging deploy
  evidence 尚待處理。
- [ ] **TD-070 manual-review hygiene** — `rag-query-rewriting` 的 7 個人工檢查項需補 `[discuss]` marker 與 evidence trail。
- [ ] **TD-072 clade push-withheld residual** —本 repo 5 個 commit 已 fast-forward；clade 側仍需對連續 withheld 產生告警或 durable follow-up。

## Commit security gate

- 2026-09-04 的 Tier 3 掃描為 `tool-failure-no-artifacts`，四份 artifacts 缺失或無效；本批尚未 commit。沿用使用者「停下修工具」決定，先取得完整安全掃描結果。
- 受影響：`app/pages/auth/login.vue`、`app/composables/useCurrentUserRole.ts`、`test/unit/auth-login-passkey-register-transition.test.ts`。原掃描目錄：`~/.local/share/clade/security-scans/hook-2026-09-04T13-16-50-866Z`；掃描費用地板尚未量到，配額需當下重驗。
- main WIP 仍含 TD-912 tag push 調整、vite-doctor 修正與 clade 遷移殘項；本輪文件清理不代表這批已通過。
- 原 `pnpm check` baseline 為 exit 1、13 warnings、0 errors；多數 warnings 來自未追蹤 screenshot tests，接手時重跑確認。

- **接手條件**：配額 2026-09-07 10:38 之後重置。重跑
  `node ~/offline/clade/scripts/security-scan.ts path --target . --effort high --max-cost <地板+2> --path app/pages/auth/login.vue --path app/composables/useCurrentUserRole.ts`。
  本 repo 的 preflight 地板**仍未量到**（量地板那一跑就死在配額），`Files: 0/3,432` 是唯一已知數字。

### 一併卡住的未 commit WIP（working tree 原封不動）

| 群 | 內容 |
| --- | --- |
| TD-912 | `package.json` 的 `scripts.tag` 拿掉 `&& git push origin --tags`（本 session 唯一改動，已完成待 commit） |
| vite-doctor 真修（2026-08-29） | `nuxt.config.ts` 移除 19 條 rule override → `doctorConfig`、`app/utils/next-frame.ts`（新）、`useClipboard` / `createUseFetch` 改寫、`docs/vite-doctor-remaining-findings.md` |
| clade 遷移 | `CLAUDE.md` 清空、`.cursor/**` 整批刪除、`.gitattributes` / `.mcp.json` |
| 新測試 | `e2e/screenshots/*.spec.ts`（未追蹤） |

- **2026-09-06 已從本批拆出落地**（皆不含 Tier 3 path，未受本阻塞約束）：`vite.config.ts` 的 oxc-shared
  preset import 修正（`74d3db97`）、`.oxfmtignore` 排除 `.cursor/` 與 `vendor/`（`dc4491d3`）、
  `.gitignore` 收 `.pi/` 與 `openspec/changes/__replay-*`（`78c86266`）、`extract-mutation-summary.mjs`
  套 oxfmt（`d636e84b`）。其餘 WIP 仍原封不動等配額重置。

## 已 commit 未 push（2026-09-06）

main 本機領先 origin 6 個 commit（`74d3db97` → `bdab3fbe`），**尚未 push**：

| commit | 內容 |
| --- | --- |
| `74d3db97` | 修 `vite.config.ts` 的 oxc-shared preset import（`preset.mts` 不存在，lint/format 鏈整條 UNRESOLVED_IMPORT） |
| `dc4491d3` | `.oxfmtignore` 排除 `.cursor/` 與 `vendor/` |
| `f583c767` | HANDOFF 登記 0-S UNSCANNED 阻塞（其內容已於 `bdab3fbe` 併進本檔 `## Commit security gate`） |
| `78c86266` | `.gitignore` 收 `.pi/` 與 `openspec/changes/__replay-*` |
| `d636e84b` | `extract-mutation-summary.mjs` 套 oxfmt |
| `bdab3fbe` | backlog register 清理（本輪 batch land） |

- **卡在哪**：`node scripts/deploy-trigger-check.ts` 回 `verdict=needs-approval` /
  `status=unconfirmable` / `derived=ambiguous`，`detail=production deploy workflows disagree (deploy.yml)
  — declare the production trigger, not the staging one`。依 commit skill Step 6-B.0，此狀態下
  `git push origin main` 需先取得授權，**NEVER** 先推再問。
- **根因（獨立待辦，NEVER 順手併進其他 commit）**：`.claude/consumer-meta.json` 宣告
  `deploy.deployTrigger: "push-main"`，但 `deploy.yml` 自述 `push main → staging deploy`、
  `push tag v* → production deploy`。宣告要改成 production 的那個觸發（`tag-v`），改完
  `deploy-trigger-check.ts` 才會回 `confirmed`。
- **0-A/0-C 證據**：`~/.cache/clade/fleet-backlog-drain/seal2-*`（simplify / 0-A.1 review / checks），
  batch id `9dc0dfe6-c6fa-41c6-a8fd-164ceed78273`，landedHead `bdab3fbe`。
- **batch cleanup 殘留**：integration worktree
  `nuxt-edge-agentic-rag-wt/batch-9dc0dfe6-…` 保留未刪，原因 `Ignored artifact has unsupported
  entry type: .pi/git/github.com/YuDefine/clade/`；來源 worktree `backlog-cleanup` 已移除，
  其 ignored 內容存於 `.git/clade-wt-batch/artifacts/9dc0dfe6-…-MVXCpT/ignored.tar`。

## CI 紅燈：evlog map coverage gate（pre-existing，擋住 staging deploy）

- **現況**：`ci.yml` 的 `Run evlog map coverage gate` step exit 1。實測（run `34037904492`，SHA `7e82f86f`）：
  `evlog map: score 56 · 70 entry points · 0 suppressed check(s) · framework nuxt`，
  **52/70 個 entry point 仍有失敗的 check**（`context` / `structured-errors` / `audit` / `error-handling`）。
  最低分是 `POST /api/_dev/login [high] (25/100)`。
- **連鎖後果**：`deploy.yml` 的 `verify-ci-gate` 要求同 SHA 的 CI success，因此 `deploy-staging`
  自 CI 開始紅之後**一次都沒跑過**——main push 看起來有觸發 Deploy workflow，但實際只跑到 gate 就停。
  `deploy-production` 需要 `verify-staging-gate`，所以 production 發版路徑同樣被這條擋住。
- **不是本輪造成**：`ci.yml` 在 `69f79920` / `fa91ec11` / `a0d70fa0` / `7e82f86f` 四個 SHA 都是同一格失敗。
- **複驗指令**（本機）：`pnpm exec evlog map --min-score <門檻>`；CI 側 `gh run view <id> --log-failed`
  搜 `evlog map coverage gate`。

### 根因（2026-09-06 查明）：模式繼承了會翻轉的上游預設

不是「門檻該不該調」，是 **`ci.yml` 沒把自己的 gate 模式寫出來**。

| 時間 | 事件 |
| --- | --- |
| 2026-07-31 07:27 | 本 repo 以 `9b7fffe2` 導入 gate，commit 標題逐字寫「導入 evlog map 覆蓋率 **ratchet** gate」，同時 commit 一份 score 56 的 `evlog.map.json` 當地板 —— baseline 這個檔只在 ratchet 模式下有意義 |
| 2026-08-02 17:53 | clade 把 action 預設從 ratchet 翻成 strict（clade `448a4412d`「預設改 strict」） |
| 之後 | 下一次 propagate 靜默把本 repo 的 gate 換成 strict。`ci.yml` 只傳 `base-ref`，沒傳 `mode`，所以吃到新預設 |

`.github/actions/evlog-map-gate/gate.ts` 自身預設是 `ratchet`（L65）；是 `action.yml` 的
`mode` 預設值 `min-score`（→ strict）把它蓋掉。56 分的 repo 對上 strict（全 repo 每個 entry point
零失敗）＝ **結構性不可達**，於是 CI 在 main 上 **60/60 全紅**，`deploy-staging` 一次都沒跑過。

**實測對照組**（同一支 gate.ts、同一份 baseline、同一份 changed-files）：

```
--mode ratchet    → exit 0   ✓ ratchet 通過（score 56 >= 56，suppressed 0 <= 0）
--mode min-score  → exit 1   52/70 個 entry point 仍有失敗的 check
```

### 待 Charles 親手套用的 patch（`.github/workflows/` 受 guard 永久保護，agent 改不了）

`.claude/scripts/guard-check.mjs` 的 `PERMANENT_GUARDS` 把 `^\.github/workflows/` 寫死，
訊息逐字是「手動修改請直接編輯檔案，不要透過 Claude」。`/unfreeze` 只能解 `guard-state.json`
裡的自訂凍結，碰不到這條。所以下面這段 **只能由 Charles 手動貼進 `ci.yml`**：

把 `.github/workflows/ci.yml` 的 evlog gate step（約 L80-83）改成：

```yaml
      - name: evlog map coverage gate
        uses: ./.github/actions/evlog-map-gate
        with:
          base-ref: ${{ github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || 'origin/main' }}
          # mode 必須明寫。這個 repo 的 gate 是 ratchet：committed 的
          # evlog.map.json（score 56）是不可倒退的地板，本次 diff 觸及的
          # entry point 必須滿分。省略 mode 會繼承 action 的預設值，而那個
          # 預設值會隨上游改動而變 —— 這裡就發生過一次（clade 448a4412d
          # 把預設從 ratchet 翻成 strict），56 分的 repo 因此永遠紅燈。
          # 爬到 100 分之前，模式由本檔宣告，不由預設值決定。見 TD-073。
          mode: ratchet
```

套用後：`git commit --only -m "..." -- .github/workflows/ci.yml` → `git push` →
CI 應轉綠 → `deploy-staging` 首次跑起來。**驗收不是「CI 綠」，是實際看到 `deploy-staging`
job 從 skipped 變成 success**（`gh run view <deploy-run-id> --json jobs`）。

### 還躺在 working tree 的一行（需要走完整 `/commit`）

`.claude/consumer-meta.json` 的 `deployTrigger` 已由 `push-main` 改成 `tag-v`，**尚未 commit**。
它不在 ad-hoc `--only` 白名單，`pre-bash-git-commit-only-whitelist.sh` 會擋，必須走 `/commit`
（跑 0-A）。改動內容與理由：

- `deploy-trigger-check.ts` 逐字判定：`production deploy workflows disagree (deploy.yml) —
  declare the production trigger, not the staging one`
- 本 repo production 走 `push tag v*`，`push main` 走的是 staging，所以宣告值應為 `tag-v`
- 改完 verdict 仍是 `needs-approval`（同一支 deploy.yml 兩種觸發，機械上推不出唯一值）。
  那是 gate 正常運作，不是漂移 —— **不要**為了讓它變綠再去動宣告值
- schema 已驗：`deploy` 區塊通過；`database` 區塊的 3 個 error 是 HEAD 既有，見 TD-074

### 爬回 strict 的路

52 個 gap 分 6 種缺漏（`structured-errors` 28 / `context` 19 / `audit` 12 / `wide-event` 7 /
`error-handling` 3 / `page-error-handling` 1），已登記 **TD-073**，含分批修法與可跑的自驗指令。
ratchet 是上游 action 自己文件寫明的「repos still climbing to 100」過渡模式，不是繞過。

## Ops follow-ups

- [ ] `debdfba02d89f63d2ef381983e14d2697cc80040`（build script heavy-gate semaphore）已在本地 commit；需確認 deploy trigger 宣告
  與 `deploy.yml` 一致後再依 gate 推送。
- [ ] 5 個既有 test file 的 `setupNuxt()` 10s timeout 仍需獨立 root-cause；另 2 個 chart timeout 先按負載 flake 觀察。
- [ ] clade `scripts/audit-gate-coverage.ts` 尚無 §3b heavy-label coverage；TD-685 relay 的 build acceptance 暫無機械證據。
- [ ] AI Gateway cache 仍關著（v0.57.7 起，`wrangler.jsonc` `NUXT_KNOWLEDGE_AI_GATEWAY_CACHE_ENABLED=false`）——
  空回答根因（judge role 誤切到 kimi reasoning model）已於 v0.57.10 解掉，可重新評估是否開回。
- [ ] sign-out API 500、D1 transaction pitfall、Notion「Secret」頁 staging/runtime 表仍是未重新驗證的 follow-up。

## Deferred discuss items

<!-- deferred-begin:autorag-to-ai-search-migration:#1 -->
- **autorag-to-ai-search-migration #1** — production deploy authorization；signal：production tag push deploy；resume：`/spectra-archive autorag-to-ai-search-migration`。
<!-- deferred-end:autorag-to-ai-search-migration:#1 -->
<!-- deferred-begin:autorag-to-ai-search-migration:#2 -->
- **autorag-to-ai-search-migration #2** — production cutover observation；signal：deploy 後 D1 `query_logs` evidence；resume：`/spectra-archive autorag-to-ai-search-migration`。
<!-- deferred-end:autorag-to-ai-search-migration:#2 -->
<!-- deferred-begin:autorag-to-ai-search-migration:#3 -->
- **autorag-to-ai-search-migration #3** — rag-query-rewriting blocker release；signal：production deploy + TD-071 close；resume：`/spectra-archive autorag-to-ai-search-migration`。
<!-- deferred-end:autorag-to-ai-search-migration:#3 -->
<!-- deferred-begin:rag-query-rewriting:#2 -->
- **rag-query-rewriting #2** — latency p95 增量 < 800ms；signal：staging app endpoint p95 實測；resume：`/spectra-archive rag-query-rewriting`。
<!-- deferred-end:rag-query-rewriting:#2 -->
<!-- deferred-begin:rich-document-extraction-tests:#1 -->
- **rich-document-extraction-tests #1** — staging PDF upload/citation walkthrough；signal：staging deploy + PDF upload + sync/publish；resume：`/spectra-archive rich-document-extraction-tests`。
<!-- deferred-end:rich-document-extraction-tests:#1 -->
<!-- deferred-begin:rich-document-extraction-tests:#2 -->
- **rich-document-extraction-tests #2** — production PDF round-trip authorization/observation；signal：production authorization + staging complete；resume：`/spectra-archive rich-document-extraction-tests`。
<!-- deferred-end:rich-document-extraction-tests:#2 -->
<!-- deferred-begin:rich-document-extraction-tests:#3 -->
- **rich-document-extraction-tests #3** — staging/production `POST /api/chat` round-trip；signal：staging deploy + published PDF；resume：`/spectra-archive rich-document-extraction-tests`。
<!-- deferred-end:rich-document-extraction-tests:#3 -->
<!-- deferred-begin:rich-document-extraction-tests:#4 -->
- **rich-document-extraction-tests #4** — staging/production `GET /api/citations` replay；signal：#3 完成並取得 citationId；resume：`/spectra-archive rich-document-extraction-tests`。
<!-- deferred-end:rich-document-extraction-tests:#4 -->

## Worktree and stash boundary

- 本輪不處理其他 worktree 或 stash；目前可見兩筆 `wt-preserve/*` stash，保留給原工作 owner。
- 任何 worktree/stash 處置前，先重新跑 clade 的 `node ~/offline/clade/vendor/scripts/handoff-scan.ts`，
  並依 clade `plugins/hub-core/skills/handoff/worktree-stash-audit.md` 判定（兩者都不在本 repo 投影內）。
- TD-071 已移至 `docs/archives/tech-debt-closed-2026-09.md`；TD-072 保留在 active register，因 clade residual acceptance 尚未完成。
