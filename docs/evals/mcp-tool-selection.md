# MCP Tool-Selection Eval

這份 eval 檢查 LLM 看到真實 MCP `tools/list` metadata 後，是否會為使用者 query 選到正確 knowledge tool，並帶出可接受的 arguments shape。

## 前置

1. 啟動本機 MCP server：

   ```bash
   pnpm dev
   ```

2. 設定 Anthropic API key：

   ```bash
   ANTHROPIC_API_KEY=...
   ```

3. 如需覆寫 MCP URL，設定 `EVAL_MCP_URL`。預設是 `http://localhost:3000/mcp`。

`pnpm eval` 會呼叫 LLM API 並產生成本。**NEVER** 將 `pnpm eval`、`evalite` 或任何 eval script 加入 `pnpm check`、`pnpm test`、PR CI 必經 gate、部署 gate。Eval 只允許 manual 或 nightly channel 使用。

## 跑法

```bash
pnpm eval
pnpm eval:watch
pnpm eval:report
```

`pnpm eval:report` 會輸出 `.evalite/mcp-tool-selection.json`，供人工保存或比較。

## Dataset 格式

Dataset 位於 `test/evals/fixtures/mcp-tool-selection-dataset.ts`。

每筆 sample 包含：

- `id`: 穩定 sample id。
- `query`: 模擬真實使用者提問。
- `expectedTool`: 期望 tool，限 `askKnowledge`、`searchKnowledge`、`getDocumentChunk`、`listCategories`。
- `expectedArgsCheck(args)`: 檢查 LLM tool call arguments 是否包含必要語意或 citation id。
- `pattern`: `specific-topic`、`category-flavored` 或 `boundary`。
- `notes`: 可選維護註記。

資料集最低覆蓋：4 個 tool，每個 tool 至少 3 筆，總樣本數至少 12，且每個 tool 至少涵蓋 specific-topic 與 category-flavored 或 boundary pattern。

## 評分

每筆 sample 以 100 分制計算：

- Tool-name match: 60 分。
- Arguments shape match: 40 分。Arguments 必須通過該 tool 的 eval input schema，且通過 sample 的 `expectedArgsCheck`。
- 選錯 tool 直接 0 分，不再檢查 arguments。

Overall score 是所有 sample 分數的未加權平均。

## Baseline

<!-- BASELINE_SCORE: TBD -->

| Field           | Value               |
| --------------- | ------------------- |
| Dataset version | TBD                 |
| Model           | `claude-sonnet-4-6` |
| Overall score   | TBD                 |
| MCP URL         | TBD                 |
| Run date        | TBD                 |

Baseline 更新必須是明確文件修改：先人工執行 `pnpm eval`，確認結果合理，再更新上方 `BASELINE_SCORE` 註解與表格。Harness 不會自動覆寫 baseline。

後續 eval 若 overall score 低於 baseline 超過 5 percentage points，harness 會設定 non-zero exit code，並在 stdout 列出掉分 sample。

## Non-Goals

- 不評估 retrieval quality、groundedness、citation correctness。
- 不評估 multi-turn tool use。
- 不自動擴充 dataset。
- 不追求 100% 正確率；門檻以人工確認過的 baseline 加 5 percentage points 容忍區間比較。

## 成本與維護

目前資料集 12 筆，每次 `pnpm eval` 會對 Claude Sonnet 4.6 發出 12 次 tool-selection 請求。新增 sample 前先確認它代表真實使用者提問，而不是為了讓模型猜答案的模板句。修改 MCP tool metadata、description 或 input schema 後，應手動跑一次 eval 並檢視 per-sample 結果。
