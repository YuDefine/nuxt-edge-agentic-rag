# Workers AI Baseline Reporting

## Purpose

這份文件定義本 change 在成本與延遲上的對外說法邊界：

- `measured baseline` 只來自固定題組的真實 Workers AI 執行
- `scenario estimate` 只是不同比例 / 流量假設下的外推，不能寫成正式實測總量

## Measured Baseline Procedure

1. 在部署環境執行：

```bash
pnpm test:workers-ai-accepted-path
```

2. 立刻匯出對應 query log：

```bash
wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT channel, decision_path, completion_latency_ms, workers_ai_runs_json, created_at FROM query_logs ORDER BY created_at DESC LIMIT 20;"
```

3. 只取固定 sample set 對應的四筆：
   - `web + TC-01`
   - `mcp + TC-01`
   - `web + TC-06`
   - `mcp + TC-06`

4. 從 `workers_ai_runs_json` 記錄以下最小欄位：
   - `modelRole`
   - `model`
   - `latencyMs`
   - `usage.promptTokens`
   - `usage.completionTokens`
   - `usage.totalTokens`
   - `usage.cachedPromptTokens`

5. 另存同時間窗的 Workers AI / AI Gateway activity，確保 query log 與 gateway activity 可互相對上。

## What Counts As Measured

只有下列內容可標成 `measured baseline`：

- 固定 sample set 四筆的 `completion_latency_ms`
- 固定 sample set 四筆 `workers_ai_runs_json` 中的 per-run latency / token usage
- 同時間窗 Gateway / Analytics 顯示的 request presence 與 request count

以下內容不得標成 `measured baseline`：

- 一整天 / 一整學期的總成本推估
- 未執行題型的 token / latency 推論
- 使用 mock data 或人工假設換算出的成本

## Required Wording

報告、海報、答辯簡報若引用這批數據，請用這種句型：

```text
Measured baseline：以 2026-04-24 fixed sample smoke（TC-01 / TC-06，Web + MCP）實測，
Workers AI accepted-path query_logs 已記錄 completion latency 與 per-run token usage。

Scenario estimate：若每日查詢量與 prompt 長度接近本次 fixed sample，則可用這批實測 token / latency
作為外推基線；此外推不是正式 production total measurement。
```

## Reviewer Checklist

- 是否明確分開 `measured baseline` 與 `scenario estimate`
- 是否引用固定 sample set，而不是臨時抽樣
- 是否保留 `workers_ai_runs_json` 與 gateway activity 證據
- 是否避免把外推數字寫成「實際總成本」或「正式平均延遲」
