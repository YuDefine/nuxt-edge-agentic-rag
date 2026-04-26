# Handoff

## In Progress

**Change `rag-query-rewriting`** — 16/29 tasks done。code 已隨 v0.53.0 ship 到
production（feature flag false ramp gate），剩 13 個都需要 staging 環境
/ dev server / 人工驗收，無人接手。

下個 session 接手前先 `pnpm spectra:claim rag-query-rewriting`。

## Blocked / 你必須親自做

### A. v0.53.0 production verify（剛 ship）

1. 確認 production worker `features.queryRewriting` 仍為 `false`：
   ```bash
   wrangler tail --format pretty | grep -i 'queryRewriting'
   # 預期看不到 rewriter_status='success'，全部 disabled
   ```
2. 確認 docs site agentic-rag-docs 顯示新 OpenAPI metadata（chat /
   conversation / citation / guest-policy / mcp auth 各 endpoint
   tags / summary / responses 都有）
3. 確認 RAG 答案 markdown 排版新規則生效：抽 1-2 條真實 chat，回答
   不應出現 `#` / `##` / `###` 標題語法

### B. v0.52.1 production verify（接續上一輪 hand-over）

剛 ship 的 v0.53.0 沒動到 v0.52.1 修法，TD-057 / TD-056 / TD-061
仍待驗證：

- **TD-057** wrangler tail 觀察 1-2 條真實 SSE chat：
  - `[evlog] log.error/log.set called after the wide event was emitted`
    warning 應消失
  - wide event 觀察到 `operation: 'web-chat-sse-stream'` 子事件帶
    `_parentRequestId` + `result` / `error` 欄位
- **TD-056 / TD-061** 24-48 hr 後撈 D1 確認：
  ```sql
  SELECT decision_path, COUNT(*) FROM query_logs
  WHERE created_at >= datetime('now', '-1 days')
  GROUP BY decision_path;
  ```
  `pipeline_error` 比例應 < 5%（baseline 28.6%）。

### C. rag-query-rewriting 後續 13 tasks

#### 1. Staging 啟用驗證（task 19 / 6.3）

v0.53.0 已 deploy 到 staging，但 staging worker `NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING=true`
是否生效需確認：

```bash
# 或透過 wrangler tail 觀察 staging worker
curl https://staging.<host>/api/admin/debug/runtime-config
```

確認：

- migration 0017 apply 成功（`query_logs.rewriter_status` /
  `rewritten_query` 欄位存在）
- `features.queryRewriting=true` 在 staging worker 生效

#### 2. Local smoke（task 17 / 6.1）

`pnpm dev`（port 3010）+ 打 2 條 chat（一條子知識問答、一條題目複述）
→ 撈 D1 確認 `rewriter_status='success'` + `rewritten_query` 不為 NULL

#### 3. Prompt 驗證 note（task 10 / 3.3）

對 5 條 fixture query 跑 staging chat，記改寫結果到：
`local/reports/notes/td-060-query-rewriter-prompt-validation-20260426.md`

5 條 query：

- "PO 和 PR 差別"
- "庫存不足怎麼辦"
- "怎麼請假"
- "系統登入問題"
- "請列出目前的知識類別"

#### 4. Acceptance run（tasks 20–21 / 6.4–6.5）

對 staging 跑 main-v0.0.54-acceptance 35 筆 fixture，記錄到：
`local/reports/notes/main-v0.0.54-acceptance-rewriter-staging-{date}.md`

量化指標：

- (a) retrieval_score 分布（≥0.55 占比，目標 ≥50%）
- (b) p95 latency 增量 vs baseline（目標 <800ms）
- (c) rewriter_status 分布（fallback rate，目標 <10%）

Evidence 填進 `docs/decisions/2026-04-26-rag-query-rewriting.md`
Acceptance Evidence 區塊。

#### 5. Roadmap update（task 22 / 6.6）

依 acceptance 結果更新 `openspec/ROADMAP.md > Next Moves`：

- TD-060 標達標 / 不達標
- 解鎖第二輪 main-v0.0.54-acceptance
- production ramp 列為下一條 ops change（依賴本 change archive）

#### 6. 人工檢查 7 條（tasks 23-29）

依 evidence 逐項展示給使用者確認，**禁止 agent 代勾**：

1. ≥50% fixture 拿到 retrieval_score ≥0.55
2. Latency p95 增量 < 800ms
3. Rewriter fallback rate < 10%
4. 抽 3 條 staging `query_log_debug` 確認 `rewritten_query` 改寫方向
   合理（非語意漂）
5. 確認 production worker 部署後 `features.queryRewriting` 仍為 false
6. Decision Q1：第一輪結果是否需要在 prompt 加索引主題清單
7. Decision Q2：admin debug API `rewritten_query` mask 行為是否符合
   預期

### D. Notion Secret 頁面同步 pending（接續上一輪）

`main-v0.0.54-acceptance` token 已 revoke（2026-04-26T01:05Z），但
Notion「Application-layer MCP bearer tokens」表格**尚未同步標記
revoked**：

- Staging entry `84f108e9-baec-4f7d-b6d4-877d21ee4f4c`
- Production entry `b73f0d8c-85b3-4bbf-ba68-74780f2189b2`

理由：使用者親手進 Notion 改。

### E. v0.53.0 follow-up tech-debt（已 register）

`docs/tech-debt.md` 內 5 條開放項目，依優先序處理：

- **TD-062** (mid) `buildRetrieveWithRewriter` helper 抽出（chat /
  mcp ask / mcp search 三處 ~28 LoC × 3 closure 重複）
- **TD-063** (low) `useRewriter: false on retry` 4 處 docstring 收斂
- **TD-064** (mid) integration test 改用真實 D1 round-trip 覆蓋
  audit dynamic UPDATE
- **TD-065** (low) `UpdateQueryLog.rewriterStatus` 型別與 NOT NULL
  不一致
- **TD-066** (low) `RewriterStatus` 比對改 `switch + assertNever`

## 注意事項

- **本次 /commit 額外修了一個 dead code**：`server/mcp/tools/search.ts`
  的 rewriter closure 原本建立未被消費的 `WorkersAiRunRecorder`，已
  改成不傳 `onUsage`（searchKnowledge 沒有 audit 寫入點）
- **本次 /commit 額外修了一個 CI bug**：`test/setup-env.ts` 補
  `defineRouteMeta` no-op stub，因為 Group 2 為 mcp endpoint 加
  OpenAPI metadata 後，integration test 在 vitest node env 直接
  import handler 會 ReferenceError
- **Production 35 筆 query_logs 保留作 TD-061 incident 證據**：不
  DELETE（`created_at >= '2026-04-26T00:49:30'`）
- **Self-correction retry 不走 rewriter**：判斷依據在
  `knowledge-answering.ts` retry call retrieve 時傳 `useRewriter: false`
- **Search path 不寫 audit**：`mcp/tools/search.ts` retrieve 會 invoke
  rewriter，但 searchKnowledge 無 query_logs 寫入路徑，rewriter
  outcome 不會 audit。Spec scenario「Rewriter applies to all four
  retrieval entry points」覆蓋執行面；audit 只覆蓋 chat / ask
- **TD-060 標 in-progress** 已寫進 `docs/tech-debt.md`；acceptance
  evidence 達標後改為 done
