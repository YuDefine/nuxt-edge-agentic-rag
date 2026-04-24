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
- `query`: 模擬真實**非技術使用者**提問；中文口吻為主，**不**使用英文技術術語（JSON key / pnpm 指令 / citation ID / "chunk" 等）— Decision 8 persona 原則。
- `expectedTool`: 期望 tool，限 `askKnowledge`、`searchKnowledge`、`listCategories`（3 個 user-facing tool）。
- `expectedArgsCheck(args)`: 檢查 LLM tool call arguments 是否包含必要語意關鍵字（中文名詞為主）。
- `pattern`: `specific-topic`、`category-flavored` 或 `boundary`。
- `notes`: 可選維護註記。

資料集最低覆蓋（spec Tool-Selection Eval Coverage 要求）：3 個 user-facing tool × 每 tool 4 筆（specific×2 / category×1 / boundary×1）= 12 筆。`getDocumentChunk` 明列排除（agent-internal citation replay 工具，非端使用者自然語言觸發；structural coverage 由 `test/integration/mcp-*.test.ts` 處理）。

## 評分

每筆 sample 以 100 分制計算：

- Tool-name match: 60 分。
- Arguments shape match: 40 分。Arguments 必須通過該 tool 的 eval input schema，且通過 sample 的 `expectedArgsCheck`。
- 選錯 tool 直接 0 分，不再檢查 arguments。

Overall score 是所有 sample 分數的未加權平均。

## Baseline

<!-- BASELINE_SCORE: 83.33 -->

| Field             | Value                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dataset version   | `2026-04-24-v2`                                                                                                                                                                                                                                                                                                              |
| Model             | `claude-sonnet-4-6`                                                                                                                                                                                                                                                                                                          |
| Overall score     | 83.33%                                                                                                                                                                                                                                                                                                                       |
| MCP URL           | `https://agentic-staging.yudefine.com.tw/mcp`                                                                                                                                                                                                                                                                                |
| Environment       | staging（@followup[TD-042]；待 local KV bridge infra fix 後 rebaseline 於 `http://localhost:3010/mcp`）                                                                                                                                                                                                                      |
| Run date          | 2026-04-24                                                                                                                                                                                                                                                                                                                   |
| Sample count      | 12（10 × 100% + 2 × 0%）                                                                                                                                                                                                                                                                                                     |
| Low-score samples | `ask-boundary-onboarding-overview`（LLM 選 `listCategories`，期望 `askKnowledge`；「治理流程」boundary query 誘導誤選）／ `search-category-evidence-publishing`（LLM 選 `listCategories`，期望 `searchKnowledge`；「這一類」誘導誤選）。兩者皆屬 metadata description 可改善處，feed into `enhance-mcp-tool-metadata` change |

**v1 → v2 變更**（Decision 8）：舊 v1 baseline 91.67%（11/12 對）作廢。v2 移除 `getDocumentChunk` 3 筆、把 askKnowledge / searchKnowledge / listCategories 每 tool 從 3 筆擴到 4 筆、所有 query 以非技術中文口吻重寫；分數下修代表舊 v1 query 含英文術語（如 `launch readiness` / `evidence publishing requirements`）時人工拉高了 LLM 的匹配信號，v2 才是真實端使用者分佈。

Baseline 更新必須是明確文件修改：先人工執行 `pnpm eval`，確認結果合理，再更新上方 `BASELINE_SCORE` 註解與表格。Harness 不會自動覆寫 baseline。

後續 eval 若 overall score 低於 baseline 超過 5 percentage points，harness 會設定 non-zero exit code，並在 stdout 列出掉分 sample。

## Non-Goals

- 不評估 retrieval quality、groundedness、citation correctness。
- 不評估 multi-turn tool use。
- 不自動擴充 dataset。
- 不追求 100% 正確率；門檻以人工確認過的 baseline 加 5 percentage points 容忍區間比較。
- 不覆蓋 `getDocumentChunk`（agent-internal citation replay 工具；端使用者不會用自然語言觸發；structural coverage 在 integration test）。
- Dataset query **不**使用英文技術術語；拉高的匹配信號會 inflate baseline、失去 metadata 品質的真實信號（Decision 8）。

## 成本與維護

目前資料集 12 筆，每次 `pnpm eval` 會對 Claude Sonnet 4.6 發出 12 次 tool-selection 請求。新增 sample 前先確認它代表真實使用者提問，而不是為了讓模型猜答案的模板句。修改 MCP tool metadata、description 或 input schema 後，應手動跑一次 eval 並檢視 per-sample 結果。
