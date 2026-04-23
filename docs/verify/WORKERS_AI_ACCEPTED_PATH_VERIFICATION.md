# Workers AI Accepted-Path Verification

## Purpose

用固定題組重跑 Web / MCP accepted path，確認：

- Web 與 MCP 都真的走 Workers AI answer generation
- 固定題組同時覆蓋 `direct_answer` 與 `judge_pass`
- 同一輪 smoke 可留下 response、query log、Workers AI / AI Gateway 對應證據

## Fixed Sample Set

固定題組 source of truth 在 [test/acceptance/workers-ai-accepted-path-samples.ts](/Users/charles/offline/yuntech-project/repo/nuxt-edge-agentic-rag/test/acceptance/workers-ai-accepted-path-samples.ts)。

- `web + TC-01`：`direct_answer`
- `mcp + TC-01`：`direct_answer`
- `web + TC-06`：`judge_pass`
- `mcp + TC-06`：`judge_pass`

不要自行換題。若要改題，先改 sample set 與對應 acceptance fixture。

## Smoke Command

```bash
pnpm test:workers-ai-accepted-path
```

這個 command 會重跑：

- `test/integration/acceptance-tc-01.test.ts`
- `test/integration/acceptance-tc-06.test.ts`

## Evidence To Capture

每次 smoke 至少保留以下證據：

1. 測試執行結果
   - 保存 `pnpm test:workers-ai-accepted-path` 的完整輸出

2. Query log rows
   - 針對本輪 sample 查出 `channel`、`decision_path`、`retrieval_score`、`completion_latency_ms`
   - `TC-01` 應可對到 `direct_answer`
   - `TC-06` 應可對到 `judge_pass`

3. Response snapshot
   - Web：回答文字與 citation 摘要
   - MCP：tool response 與 citation 摘要

4. Workers AI / AI Gateway activity
   - 保存對應時間窗的 gateway log、analytics 截圖或匯出
   - 至少能對到模型請求存在、時間窗對齊、請求量非零

## Suggested Query Log Check

```bash
wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT channel, query_text, decision_path, retrieval_score, completion_latency_ms, created_at FROM query_logs ORDER BY created_at DESC LIMIT 20;"
```

## Evidence Folder Convention

建議每輪 smoke 以時間戳建立一個資料夾，例如：

```text
evidence/<reportVersion>/workers-ai-accepted-path/2026-04-24T02-00-00Z/
```

至少放入：

- `test-output.txt`
- `query-logs.json`
- `web-response.json`
- `mcp-response.json`
- `gateway-activity.png` 或 `gateway-activity.json`

## Pass Criteria

- 固定題組四筆 sample 全部可重跑
- `web` / `mcp` 都至少有一筆 `direct_answer`
- `web` / `mcp` 都至少有一筆 `judge_pass`
- response 與 query log 可互相對上
- 可提出同一輪對應的 Workers AI / AI Gateway 活動證據
