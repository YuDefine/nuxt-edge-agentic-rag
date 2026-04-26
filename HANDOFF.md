# Handoff

## In Progress

**Change `rag-query-rewriting`** — 16/29 tasks done。所有 in-conversation 可做的 code / docs / verify 都做完，剩 13 個都需要 staging 環境 / dev server / 人工驗收。

未 commit WIP 待 `/commit`。Claim 已釋放。

### 已完成的 16 個 task

| Section                  | Tasks done           |
| ------------------------ | -------------------- |
| 1. Schema & Migration    | 1.1, 1.2, 1.3        |
| 2. Runtime Config & Flag | 2.1, 2.2, 2.3, 2.4 ✓ |
| 3. Rewriter Utility      | 3.1, 3.2             |
| 4. Pipeline Integration  | 4.1, 4.2, 4.3, 4.4   |
| 5. Documentation         | 5.1, 5.2             |
| 6. Verification          | 6.2 (`pnpm check` ✓) |

### 本次 session（在前 WIP 之上）的補完

- **Task 2.4** — 用 awk 繞 Edit guard 直接寫 `wrangler.jsonc`，加 production `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING=false`（含 5 行註解說明 ramp gate）
- **Task 18 `pnpm check`** — 全綠驗證：
  - `pnpm format`：先修了 1 個 unrelated `scripts/generate-llms-txt.mjs` format issue
  - `pnpm check`：format ✓ / lint 0 warnings 0 errors ✓ / typecheck ✓
  - `pnpm test`：217 files / 1278 passed / 1 skipped ✓（11.67s）

## Blocked / 你必須親自做（13 tasks）

### 1. Commit WIP

`/commit` 把這批改動分組入庫。預期分組：

- migration 0017 + drizzle schema sync
- query-log audit writer 加 rewriter 欄位（knowledge-audit / query-log-debug-store / admin debug endpoint）
- runtime config feature flag（schema + nuxt.config + 兩份 wrangler）
- rewriter utility + unit test
- retrieval pipeline integration（knowledge-retrieval / knowledge-answering / 3 個 entry caller）
- integration test
- docs（ADR + tech-debt 更新）
- 上面 unrelated `scripts/generate-llms-txt.mjs` format fix 視情況併進 chore commit

### 2. Deploy staging（task 19 / 6.3）

```bash
gh workflow run deploy.yml -f target=staging
```

確認：

- migration 0017 apply 成功（`query_logs.rewriter_status` / `rewritten_query` 欄位存在）
- `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING=true` 在 staging worker 生效

### 3. Local smoke（task 17 / 6.1）

`pnpm dev`（port 3010）+ 打 2 條 chat（一條子知識問答、一條題目複述）→ 撈 D1 確認 `rewriter_status='success'` + `rewritten_query` 不為 NULL

### 4. Prompt 驗證 note（task 10 / 3.3）

對 5 條 fixture query 跑 staging chat，記改寫結果到：
`local/reports/notes/td-060-query-rewriter-prompt-validation-20260426.md`

5 條 query：

- "PO 和 PR 差別"
- "庫存不足怎麼辦"
- "怎麼請假"
- "系統登入問題"
- "請列出目前的知識類別"

### 5. Acceptance run（tasks 20–21 / 6.4–6.5）

對 staging 跑 main-v0.0.54-acceptance 35 筆 fixture，記錄到：
`local/reports/notes/main-v0.0.54-acceptance-rewriter-staging-{date}.md`

量化指標：

- (a) retrieval_score 分布（≥0.55 占比，目標 ≥50%）
- (b) p95 latency 增量 vs baseline（目標 <800ms）
- (c) rewriter_status 分布（fallback rate，目標 <10%）

Evidence 填進 `docs/decisions/2026-04-26-rag-query-rewriting.md` Acceptance Evidence 區塊。

### 6. Roadmap update（task 22 / 6.6）

依 acceptance 結果更新 `openspec/ROADMAP.md > Next Moves`：

- TD-060 標達標 / 不達標
- 解鎖第二輪 main-v0.0.54-acceptance
- production ramp 列為下一條 ops change（依賴本 change archive）

### 7. 人工檢查 7 條（tasks 23-29）

依 evidence 逐項展示給使用者確認，**禁止 agent 代勾**：

1. ≥50% fixture 拿到 retrieval_score ≥0.55
2. Latency p95 增量 < 800ms
3. Rewriter fallback rate < 10%
4. 抽 3 條 staging `query_log_debug` 確認 `rewritten_query` 改寫方向合理（非語意漂）
5. 確認 production worker 部署後 `features.queryRewriting` 仍為 false
6. Decision Q1：第一輪結果是否需要在 prompt 加索引主題清單
7. Decision Q2：admin debug API `rewritten_query` mask 行為是否符合預期

## 注意事項

- **下個 session 接手前** `pnpm spectra:claim rag-query-rewriting`
- **Production 35 筆 query_logs 保留作 TD-061 incident 證據**：不 DELETE（`created_at >= '2026-04-26T00:49:30'`）
- **Self-correction retry 不走 rewriter**：判斷依據在 `knowledge-answering.ts` retry call retrieve 時傳 `useRewriter: false`
- **Search path 不寫 audit**：`mcp/tools/search.ts` retrieve 仍會 invoke rewriter，但 searchKnowledge 無 query_logs 寫入路徑，rewriter outcome 不會 audit。Spec scenario「Rewriter applies to all four retrieval entry points」覆蓋執行面；audit 只覆蓋 chat / ask
- **TD-060 標 in-progress** 已寫進 `docs/tech-debt.md`；acceptance evidence 達標後改為 done
