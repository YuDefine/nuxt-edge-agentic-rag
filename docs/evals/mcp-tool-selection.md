# MCP Tool-Selection Eval

這份 eval 檢查 LLM 看到真實 MCP `tools/list` metadata 後，是否會為使用者 query 選到正確 knowledge tool，並帶出可接受的 arguments shape。

## 前置

> ⚠️ **目前 Local `POST /mcp` 在 NuxtHub dev 下因 KV binding 未 bridge 而 503**（見 `docs/tech-debt.md` TD-042）。本節分成 **Staging fallback（目前預設）** 與 **Local（TD-042 解完後）** 兩條路。

### Staging fallback（目前預設）

1. 在 staging admin UI mint 一個 eval token：
   - 瀏覽 `https://agentic-staging.yudefine.com.tw/admin/tokens`（admin 登入）
   - 建立 token：name = `dev-eval-staging`、scopes = `knowledge.ask` / `knowledge.search` / `knowledge.category.list` / `knowledge.citation.read`、expiresInDays = 30
   - 複製 plaintext token（只顯示一次）

2. 設定 `.env`：

   ```bash
   ANTHROPIC_API_KEY=...
   EVAL_MCP_URL=https://agentic-staging.yudefine.com.tw/mcp
   EVAL_MCP_BEARER_TOKEN=<上一步 UI 複製出來的 token>
   ```

3. 本機不用跑 `pnpm dev`（eval 直接打 staging）。

### Local（TD-042 解完後才能走）

1. 確認 `.env` 已設 `NUXT_MCP_AUTH_SIGNING_KEY`（≥ 32 bytes；由 `wire-do-tool-dispatch` 引入，本 change 不擁有該 env）。若 `wire-do-tool-dispatch` 仍 parked，可先用 `openssl rand -base64 48` 產一個 dev-only key。

2. 啟動本機 MCP server（nuxt dev 在 `:3010`）：

   ```bash
   pnpm dev
   ```

3. 取得 dev MCP Bearer token（30 天，寫入本機 sqlite；staging / production 不可用此 CLI，guard 會拒絕）：

   ```bash
   pnpm mint:dev-mcp-token
   ```

   把 stdout 印出的 token 貼到 `.env` 的 `EVAL_MCP_BEARER_TOKEN`。也支援 `--email <admin-email>` 與 `--ttl-days <n>` 覆寫。**絕對不要** 在 eval harness 內自動寫 DB — 必須走這一步，讓 token 生成顯性可見。

4. `.env`：

   ```bash
   ANTHROPIC_API_KEY=...
   EVAL_MCP_URL=http://localhost:3010/mcp
   EVAL_MCP_BEARER_TOKEN=<CLI 印出的 token>
   ```

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

<!-- BASELINE_SCORE: 91.67 -->

| Field             | Value                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Dataset version   | `2026-04-24-v1`                                                                                                 |
| Model             | `claude-sonnet-4-6`                                                                                             |
| Overall score     | 91.67%                                                                                                          |
| MCP URL           | `https://agentic-staging.yudefine.com.tw/mcp`                                                                   |
| Environment       | staging（@followup[TD-042]；待 local KV bridge infra fix 後 rebaseline 於 `http://localhost:3010/mcp`）         |
| Run date          | 2026-04-24                                                                                                      |
| Sample count      | 12（11 × 100% + 1 × 0%）                                                                                        |
| Low-score samples | `ask-category-governance-review`（LLM 選 `listCategories`，期望 `askKnowledge`；tool mismatch → per-sample 0%） |

Baseline 更新必須是明確文件修改：先人工執行 `pnpm eval`，確認結果合理，再更新上方 `BASELINE_SCORE` 註解與表格。Harness 不會自動覆寫 baseline。

後續 eval 若 overall score 低於 baseline 超過 5 percentage points，harness 會設定 non-zero exit code，並在 stdout 列出掉分 sample。

## Non-Goals

- 不評估 retrieval quality、groundedness、citation correctness。
- 不評估 multi-turn tool use。
- 不自動擴充 dataset。
- 不追求 100% 正確率；門檻以人工確認過的 baseline 加 5 percentage points 容忍區間比較。

## 成本與維護

目前資料集 12 筆，每次 `pnpm eval` 會對 Claude Sonnet 4.6 發出 12 次 tool-selection 請求。新增 sample 前先確認它代表真實使用者提問，而不是為了讓模型猜答案的模板句。修改 MCP tool metadata、description 或 input schema 後，應手動跑一次 eval 並檢視 per-sample 結果。
