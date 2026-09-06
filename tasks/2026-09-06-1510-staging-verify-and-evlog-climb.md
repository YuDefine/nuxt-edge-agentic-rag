# staging 驗收解封 + evlog 覆蓋率爬坡（TD-073）

> Session: 2026-09-06 15:10
> 狀態: in-progress
> 前一棒 work: `W-2026-09-06-agentic-rag-staging-ci-evlog-gate`（已 done，見下方「已完成的前提」）

**你是繼任者，不是被派出去做一件子工作的 worker。** 前一個 session 因 context 越過 hard tier
（509k / 500k）交棒，工作本身沒有卡住 —— 它剛解掉的是**你要做的這兩件事的前提**。

前一棒**沒有** in-flight dispatch，沒有未收割的 handshake。

## 已完成的前提（不必重做，但要知道）

staging 自 2026-07-31 起從未部署過，根因是 `ci.yml` 沒宣告 evlog gate 模式、繼承了 clade
`448a4412d` 翻成 strict 的預設；本 repo 是 ratchet（`9b7fffe2` 標題逐字寫 ratchet，並 commit
一份 score 56 的 baseline 當地板）。已加 `mode: ratchet`（`bebbb215`）。

**實測結果**（`gh run view --json conclusion,jobs`）：

| | 修改前 `3c9325d3` | 修改後 `9ac3ca3b` |
| --- | --- | --- |
| CI | `34039555084` failure | `34040483314` **success** |
| `deploy-staging` | **skipped** | **success** |
| `smoke-test-staging` | skipped | **success** |
| `deploy-production` | skipped | skipped（要 tag `v*`，未建） |

全部已 push（HEAD `0c4ca38f`）。完整時間線與根因在 `HANDOFF.md` §「CI 紅燈：evlog map
coverage gate」。

## 你要做的兩件事（**serial，不要拆平行**）

順序有依賴：**先做 (1) 再做 (2)**。(2) 會改 `server/api/**` 的 handler，改完重新部署會讓 (1)
收到的 staging evidence 全部 stale。

### (1) 4 條因 staging deploy 解除封鎖的 deferred 驗收項

`HANDOFF.md` §`Deferred discuss items` 裡的 8 條中，**這 4 條的 awaiting-signal 已發生**：

| item | 等的 signal | 現況 |
| --- | --- | --- |
| `rag-query-rewriting #2` | staging app endpoint p95 實測 | ✅ staging 已部署，可量 |
| `rich-document-extraction-tests #1` | staging deploy + PDF upload + sync/publish | ✅ 可跑 |
| `rich-document-extraction-tests #3` | staging deploy + published PDF → `POST /api/chat` | ⛓ 依賴 #1 |
| `rich-document-extraction-tests #4` | #3 完成並取得 citationId → `GET /api/citations` replay | ⛓ 依賴 #3 |

`#1 → #3 → #4` 是一條鏈，`rag-query-rewriting #2` 可獨立先跑。

**仍封鎖、NEVER 動的 4 條**（等的是 production，而 production 要 tag `v*`，本輪未授權建 tag）：
`autorag-to-ai-search-migration #1/#2/#3`、`rich-document-extraction-tests #2`。

resume 入口照該段各條自己寫的（`/opsx` 對應 change）。

### (2) TD-073 — evlog 覆蓋率 56 → 100

`docs/tech-debt.md` § TD-073 有完整分類、分批修法與**已實跑過**的自驗指令。摘要：

score 56、70 個 entry point、**52 個**有失敗 check、0 suppressed。6 類：

| check | 意思 | 命中數 |
| --- | --- | ---: |
| `structured-errors` | `createError()` 缺 `why` / `fix` | 28 |
| `context` | 沒有 `log.set()` 累積 request context | 19 |
| `audit` | 敏感路徑有 logger 與 context 但沒 `log.audit()` | 12 |
| `wide-event` | handler 對 wide event 零貢獻 | 7 |
| `error-handling` | catch 吞 error | 3 |
| `page-error-handling` | `useFetch()` 沒接 error | 1 |

**第一優先是 MCP auth 那 6 支**（`server/api/auth/mcp/{authorize.get,authorize.post,
chatgpt-client-metadata.get,register.post,token.post}.ts` 與
`server/api/auth/passkey/verify-authentication.post.ts`）—— 全 0 分、四項 check 全滅，
而它們是 OAuth 授權端點，**沒有稽核軌跡**。

每批落地後重跑 `evlog map` 並把新分數 commit 回 `evlog.map.json`，ratchet 地板隨之抬高。

自驗（baseline 2026-09-06：score 56、52/70 失敗、0 suppressed）：

```bash
node .github/actions/evlog-map-gate/gate.ts \
  --baseline evlog.map.json --changed-files /dev/null --cwd . --mode ratchet
```

**NEVER** 用 `disable` 註解豁免 check 抬分 —— gate 對 suppressed > 0 直接 fail。

## Approved Tools（清單外一律回報，NEVER 自取）

可讀寫：`server/**`、`app/**`、`openspec/changes/**`、`docs/tech-debt.md`、`HANDOFF.md`、
`evlog.map.json`、`tasks/**`。

可跑：`pnpm check` / `pnpm test` / `pnpm typecheck` / `pnpm run doctor`、
`node .github/actions/evlog-map-gate/gate.ts …`、`gh run view|list`、`git`（見下方禁令）。

## 邊界（逐條，NEVER 讀成建議）

- **NEVER 建 `v*` tag** —— 那會觸發 production deploy，不在任何既有授權內。要發版先問 Charles
- **`.github/workflows/` 受 `guard-check.mjs` 的 `PERMANENT_GUARDS` 永久保護**，Edit/Write 被擋、
  `/unfreeze` 解不掉。要改 workflow **MUST 逐次取得 Charles 授權**；2026-09-06 那次是他逐字說
  「授權你改」之後才由 agent 從 Bash 側寫入的，**不構成常設許可**
- **main 上 39 檔 parked WIP 原封不動**（2026-09-04 security-scan 配額批次）。它們卡在配額，
  接手條件寫在 `HANDOFF.md` §`Commit security gate`
- **push main 前 MUST 依 commit skill Step 6-B.0 取得授權**：`deploy-trigger-check.ts` 對本 repo
  恆回 `needs-approval` / `derived=ambiguous`（一支 deploy.yml 同時吃 main push 與 tag push，
  機械上推不出唯一 production trigger）。**那是 gate 正常運作，NEVER 為了讓它變 `confirmed`
  去動 `deployTrigger` 宣告值**
- **0-C 的既有紅 baseline**（不是你造成的，也 NEVER 為了讓它變綠去動 parked WIP）：
  `lint` 13 warnings 全在 parked WIP 的 `e2e/screenshots/*.spec.ts`；`doctor` exit 1 但
  0 blockers / 0 errors / 29 個既有 warning。`typecheck` exit 0、`test` 218/218 全過
  —— **但 test 要單獨跑**：與 typecheck / doctor 並行會把 `setupNuxt()` 壓過 10s timeout，
  造成 5 個 file collect 失敗的假象

## 交接進來的一行：TD-912（別 session p1N 的 WIP，**要一起收**）

p1N session 在 main 工作區改了 `package.json` 一行，**未 commit、index 未動**，明確要求由你的
`/commit` 一起收（它自己被白名單擋住：`package.json` 不在 ad-hoc `--only` 路徑白名單，
而 `/commit` 會全包 WIP）。

已核實（`git diff -- package.json`）：

```diff
-"tag": "git tag v$(node -p \"require('./package.json').version\") && git push origin --tags",
+"tag": "git tag v$(node -p \"require('./package.json').version\")",
```

理由與 `commit.detail` § Step 6-A 逐字一致：`scripts.tag` 自帶 `git push origin --tags` 會讓
tag 在 main 之前送出，被 `tag-position` gate 擋下、`&&` 整條中止，main 與 tag 兩個都不落地
（TD-906 死鎖）。移除後對齊 perno / yuntech-usr-sroi / nuxt-supabase-starter。

- detail：`tasks/2026-09-06-2355-td-912-tag-script.md`（p1N 的檔，**NEVER Edit**，只讀）
- 驗收：`node -p "require('./package.json').scripts.tag"` 不含 `git push`
- 範圍：只有那一行。**NEVER** 順手改 `package.json` 其他任何一行

**這一行與上面 39 檔 parked WIP 是兩回事**：parked WIP 卡在 security-scan 配額、原封不動；
這一行是 p1N 驗收完、明確要求落地的。

## 已登記但不在本棒 scope

`TD-074`（`.claude/consumer-meta.json` 的 `database` 區塊不符 schema，HEAD 即已違規，
`hosted` 正確值需依實際情形判定、不要憑猜填）。
