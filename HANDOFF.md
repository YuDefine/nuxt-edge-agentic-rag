# Handoff

## In Progress

- 無 active spectra change（TD-040 implementation 已 ship 於 v0.51.0；
  TD-009 implementation 已 revert，code 退回 working tree 暫不 active）
- TD-040 / TD-009 兩個 spectra change 仍在 `openspec/changes/` 下，
  **人工檢查 task 9.x / 7.x 未跑**（TD-040 雖已 production deploy 但
  人工檢查需使用者親自跑，不能 agent 代勾）
- **`main-v0.0.54-acceptance` 第一輪已完成**（2026-04-26）：production 35
  筆 seed acceptance fixture 跑出延遲與治理路徑統計，已回填
  `local/reports/archive/main-v0.0.54-working.md` 與 `main-v0.0.54-draft.md`
  表 47-A，evidence 在
  `local/reports/notes/main-v0.0.54-acceptance-latency-run-20260426.md`。
  第二輪重測待 TD-060 解（retrieval 索引提升）後由人重跑。
- **2026-04-26 second session 進度**（uncommitted WIP，待 `/commit`）：
  - **A docs deploy fix** ✅ `package.json` 加 `vue 3.5.33`（vitepress
    implicit dep）+ `docs/tech-debt.md` line 1634 用 `<span v-pre>` 包
    inline code 避 vue template 把 `${{ github.sha }}` 當 expression。
    `pnpm docs:build` 7.89s 過。
  - **B TD-061 調查** ✅ subagent 撈完 production D1 raw evidence + 寫
    `local/reports/notes/td-061-pipeline-error-investigation-20260426.md`，
    **重大發現：TD-061 = TD-056 同源**（agentJudge `max_completion_tokens: 200`
    JSON 截斷），「r2 批次 cache 競爭」是假象，真實切割是 `retrieval_score
∈ [0.45, 0.7)` 進 judge → 100% truncation fail。已更新 `docs/tech-debt.md`
    TD-061 entry root cause + TD-056 entry 升級 priority `low → high` 加
    cross-ref。
  - **C TD-057 SSE wide event lifecycle fix** ✅ subagent 在 SSE 路徑用
    `createRequestLogger` + `_deferDrain` 開 child request logger，stream
    settled 後手動觸發 `evlog:enrich` / `evlog:drain` hook 並把 drain promise
    註冊到 `cloudflare.context.waitUntil`。改 3 檔：`server/api/chat.post.ts`、
    `server/utils/chat-sse-response.ts`、`test/integration/chat-route.test.ts`。
    `pnpm typecheck` 過、`chat-route-heartbeat.spec.ts` 3/3、
    `chat-route.test.ts` 11/11、acceptance tests 14/14。Production 驗證：
    deploy 後 1-2 條真實 SSE chat 即可在 wrangler tail 確認 warning 消失，
    並能在 wide event 觀察到 `operation: 'web-chat-sse-stream'` 子事件帶
    `_parentRequestId` + `result` / `error` 欄位。
  - **D TD-056/061 1-line fix** ✅ `server/utils/workers-ai.ts:135`
    `max_completion_tokens: 200 → 1024` + 加 2 條 vitest unit test：
    (a) lock max_completion_tokens=1024、(b) 模擬 truncated JSON 確認
    `judge` adapter 會 throw `SyntaxError`（lock TD-061 root cause path）。
    `test/unit/workers-ai.test.ts` 8/8、typecheck EXIT=0。**Production
    deploy 後預期降 28.6% pipeline_error 到接近 0**。
  - **E TD-060 retrieval 診斷 report** ✅
    `local/reports/notes/td-060-retrieval-score-diagnosis-20260426.md`
    完整 7-day production query_logs 分布分析。**Root cause 不是 thresholds
    設過高、不是 chunking、不是 embedding 模型** — 是 acceptance fixture
    「子知識問答 form」vs 索引「題目複述 form」的 query gap。Production
    自然 query「採購流程」可達 0.72，fixture「PO 和 PR 差別」只能拿 0.38。
    建議方向：query rewriting / HyDE > reranker > chunk 重切。**完全不
    建議**單做降 thresholds（會掩蓋 query/index 對應問題）。

## Blocked

無

## Next Steps

優先序由高至低：

1. **跑 `/commit` 把本 session WIP 入庫（最優先）** — 8 檔 modified：
   - `docs/tech-debt.md`（TD-049 ${{ }} v-pre + TD-061 root cause + TD-056 升級）
   - `package.json` + `pnpm-lock.yaml`（vue 3.5.33）
   - `server/api/chat.post.ts` + `server/utils/chat-sse-response.ts`（TD-057）
   - `server/utils/workers-ai.ts`（TD-056/061）
   - `test/integration/chat-route.test.ts`（TD-057 tests）
   - `test/unit/workers-ai.test.ts`（TD-056/061 tests）
   - 建議拆 4-5 個 commit：
     - `🐛 fix(docs): TD-049 v-pre escape ${{ }} + 加 vue dep 修 vitepress build`
     - `🐛 fix(observability): TD-057 SSE wide event lifecycle 改 child request logger`
     - `🐛 fix(workers-ai): TD-056/061 judge max_completion_tokens 200 → 1024`
     - `📝 docs: TD-056/061 同源 root cause + TD-060 診斷 report`
   - **第二輪 docs deploy + production deploy 後可一次驗證 4 條 fix**

2. **TD-040 production verification（高）** — v0.51.0 production deploy
   已成功，請跑人工檢查 task 9.1-9.4：
   - 9.1 local `pnpm dev` 跑 admin 流程：建 token → 用 token 對 `/mcp` 跑
     `tools/list`（建 DO session）→ admin revoke token → wrangler tail /
     evlog 觀察 cascade cleanup log
   - 9.2 local 後續驗證：對該 sessionId 直接 fetch DO → storage 應為空
   - 9.3 production deploy 後對測試 token 跑同流程，wrangler tail 觀察
     cascade cleanup 成功日誌
   - 9.4 production 觀察 7 天，確認 (a) 既有 token revoke flow 不受影響、
     (b) 無 HMAC verify failure 噪音（evlog `mcp.invalidate.verify_failed`
     計數 = 0）、(c) 無 DO error spike

3. **TD-061 / TD-056 / TD-057 production verify（高，依賴 #1 commit + deploy）** —
   - 這次 commit deploy 後 wrangler tail 觀察 1-2 條 SSE chat：
     - (a) `[evlog] log.error/log.set called after the wide event was emitted`
       warning 應消失（TD-057 fix）
     - (b) wide event 觀察到 `operation: 'web-chat-sse-stream'` 子事件帶
       `_parentRequestId` + `result` / `error` 欄位（TD-057 fix）
     - (c) `decision_path=pipeline_error` 比例下降到接近 0（TD-056/061 fix）
   - production 觀察 24-48 hr 後撈 D1 確認：
     ```sql
     SELECT decision_path, COUNT(*) FROM query_logs
     WHERE created_at >= datetime('now', '-1 days')
     GROUP BY decision_path;
     ```
     pipeline_error 比例應 < 5%（從 28.6%）。

4. **TD-060 fix change（高，依賴 #3 production verify）** —
   `td-060-retrieval-score-diagnosis-20260426.md` 給的優先序：
   - 第一波：query rewriting / HyDE（retrieval 前用 LLM 改寫使用者 query
     成「索引內可能出現的句式」）— 直接攻擊 root cause、加一次 LLM call
     ~500ms 延遲
   - 第二波（如果 query rewriting 不夠）：reranker（cross-encoder
     BGE-reranker-large 對 top 20 → top 8 重排）
   - 第三波（last resort）：chunk 重切 256 tokens + chunk-level Q&A 增強
   - **完全不建議**單做降 thresholds（symptom 不治根）
   - acceptance criteria：≥50% acceptance fixture 拿到 retrieval_score ≥0.55
     進 judge gate；驗收決策寫進 `docs/decisions/YYYY-MM-DD-rag-query-rewriting.md`

5. **第二輪 main-v0.0.54-acceptance 重測（高，依賴 #4）** — TD-060 解後跑
   33-50 筆 fixture 對 production，補入 Judge 觸發率、引用正確率、回答正確率、
   policy classifier precision。**結果寫進 `local/reports/notes/main-
v0.0.54-acceptance-latency-run-{date}.md` 第二輪 evidence note**，並
   更新表 47-A 第二輪欄位，不覆蓋第一輪。

6. **TD-009 重做（中-高）** — 另一條 session 正在做，本 session 不碰。
   詳見另一條 session HANDOFF 與 `openspec/changes/passkey-user-profiles-
nullable-email/`。

7. **TD-040 archive（低）** — 人工檢查 9.x 通過後跑 `/spectra-archive`，
   spec delta 合併進 `openspec/specs/oauth-remote-mcp-auth/spec.md` +
   `docs/tech-debt.md` 把 TD-040 改 done。

8. **TD-058 user_profiles 6 條 orphaned rows**（low）— TD-053 立即驗收
   附帶發現，建議等 TD-009 重做完再評估（HANDOFF 第 9 條原註明可能合併處理）。

## 注意事項

- **TD-061 = TD-056 同源**（本 session 重大發現）：原本以為 TD-061
  是「r2 batch cache 競爭 / rate-limit 軟降級」，調查後確認是 judge model
  `max_completion_tokens: 200` 截斷 JSON 引發。`docs/tech-debt.md` 已更新
  cross-ref + priority 升級。
- **TD-060 不是 thresholds 問題**（本 session 重大發現）：production 自然
  query 可達 0.72，acceptance fixture 卡 0.38 是 query form gap，不是
  threshold 設過高。降 thresholds 是 symptom 治療，**不要走這條路**。
- **TD-040 已 production live**：`MCPSessionDurableObject.fetch()` 開頭
  加了 `X-Mcp-Internal-Invalidate` HMAC bypass；admin
  `/api/admin/mcp-tokens/[id].delete` 加了 best-effort cascade cleanup。
  HMAC trust anchor 是 `NUXT_MCP_AUTH_SIGNING_KEY`（既有），無新 secret。
- **TD-009 失敗教訓**：local libsql `:memory:` 跑 0016 全綠，但 D1 wrangler
  migration apply 失敗。**本機 libsql test 不是 D1 production 行為的可信
  proxy**，特別是 schema migration / FK / PRAGMA 行為。下次 schema
  migration 必須加上 wrangler local D1 emulator 驗證。
- **dep bump 副作用 + vitepress 1.6.4 ${{ }} parsing**：本次 docs build
  失敗有兩個 root cause：(a) `@nuxt/ui 4.6.1→4.7.0` 升級造成 vitepress
  build 找不到 vue（pnpm strict mode + implicit peer dep）；(b) tech-debt.md
  line 1634 inline code 內 `${{ github.sha }}` 被 vitepress 當 vue template
  expression 解析。**留意 prior session 已 commit 的 dep bump 不一定可信任**，
  建議下次 `/commit` 看到 pre-existing dep bump 時先單獨跑 `pnpm build`
  （app + docs）確認 no regression。
- **`local/excalidraw-diagram-workbench` dirty submodule 已不影響 commit**
  — 9e40005 把 `local/` 整個目錄加入 .gitignore，gitlink pointer 仍在 tree
  但 git status 不再顯示 dirty。
- **`main-v0.0.54-acceptance` token 已 revoke**：
  - Staging `84f108e9-baec-4f7d-b6d4-877d21ee4f4c`（2026-04-26T01:05Z）
  - Production `b73f0d8c-85b3-4bbf-ba68-74780f2189b2`（2026-04-26T01:05Z）
  - `.env` `EVAL_MCP_BEARER_TOKEN` 已清空（加註 revoke 日期）
  - 下次需要 eval token 時用 `pnpm mint:dev-mcp-token`（local）或
    `/admin/tokens` UI mint 新 token；**不要復用已 revoked token**。
  - **Notion Secret 頁面同步 pending**：本次 Notion MCP 不可用，需手動同步
    staging / production 「Application-layer MCP bearer tokens」表格，
    在這兩筆 entry 標 revoked。
- **production 35 筆 query_logs 保留作 TD-061 incident 證據**：不 DELETE，
  下次調查 pipeline_error 時 query `created_at >= '2026-04-26T00:49:30'`
  即可拉到全部 35 筆原始紀錄。
- **TD-057 修法選擇 manual mode 而非 evlog/toolkit `forkBackgroundLogger`**：
  Subagent 報告 `evlog/toolkit` 的 `forkBackgroundLogger` 走 `getGlobalDrain()`
  而非 Nitro hooks，跟本專案 drain 路徑不同步。所以走 `createRequestLogger`
  - `_deferDrain` + 自己跑 enrich/drain hooks。這是設計決策，下次有人想用
    `forkBackgroundLogger` 時請先確認 drain 路徑一致。
