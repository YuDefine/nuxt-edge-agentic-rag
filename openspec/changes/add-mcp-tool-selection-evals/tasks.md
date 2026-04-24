## 1. 套件與目錄骨架

- [x] 1.1 `pnpm add -D evalite @ai-sdk/mcp @ai-sdk/anthropic ai` — 實作 Decision 1: Eval framework = `evalite` 與 Decision 2: LLM provider = Anthropic Claude (via `@ai-sdk/anthropic`)；記錄版本到 `pnpm-lock.yaml`（支援 Scored Dimensions / Tool-Selection Eval Coverage 基礎）
- [x] 1.2 建立 `test/evals/` 目錄骨架（`fixtures/`、`helpers/`），補 `test/evals/tsconfig.json`（若與既有 `test/tsconfig.json` 有差異）；為 Goals（覆蓋 4 tool × ≥ 3 pattern、swap provider 容易、可比較）建立檔案輪廓
- [x] 1.3 `.env.example` 加 `ANTHROPIC_API_KEY=`（含註解：實作 Decision 6: LLM API key 命名 = `ANTHROPIC_API_KEY`（沿用 AI SDK 慣例）；「MCP tool-selection eval 使用，runtime 不讀取；可選 `EVAL_MCP_URL` 覆寫 MCP server URL，預設 `http://localhost:3000/mcp`」）

## 2. Scorer 與 unit test（Scored Dimensions、Decision 4: Scoring = 分層加權（tool match + args match））

- [x] 2.1 [P] `test/evals/helpers/scorer.ts`：實作 `scoreSample({ expectedTool, expectedArgsCheck, actualTool, actualArgs, inputSchema })`，以 Decision 4 的 60/40 加權；wrong tool 直接 0；arguments-shape 分項包含 `inputSchema.parse()` + fixture lambda 驗證
- [x] 2.2 [P] `test/unit/evals-scorer.test.ts`：覆蓋三組 case — tool match + args pass = 100、tool match + args fail = 60、tool mismatch = 0；再加一組 args parse throw 的 case

## 3. MCP client helper 與 dataset（Tool-Selection Eval Coverage、Decision 3: MCP client 連線 = AI SDK `experimental_createMCPClient` against local dev server）

- [x] 3.1 [P] `test/evals/helpers/mcp-client.ts`：依 Decision 3 封裝 `experimental_createMCPClient`（AI SDK）連 `EVAL_MCP_URL`（default `http://localhost:3000/mcp`）；啟動前打 readiness probe（最多 retry 5 次、每次 sleep 500ms）；readiness 失敗時 throw 清楚訊息「請先 `pnpm dev`」；harness **不得** 直接 import `server/mcp/tools/*.ts`（本 helper 以 protocol 方式取得 tool 描述）
- [x] 3.2 [P] `test/evals/fixtures/mcp-tool-selection-dataset.ts`：宣告 `DATASET: EvalSample[]`，每筆含 `{ id, query, expectedTool, expectedArgsCheck(args): boolean, notes? }`；依 spec 要求覆蓋 4 個 tool、每個 tool ≥ 3 樣本、至少 1 specific-topic + 1 category-flavored + 1 boundary，總樣本數 ≥ 12；在 dataset 檔頂部 export `DATASET_VERSION` 字串（對應 docs baseline）
- [x] 3.3 建立 `scripts/mint-dev-mcp-token.mts` dev-only CLI（Decision 7，@ingest 2026-04-24）：runtime guard `NUXT_KNOWLEDGE_ENVIRONMENT==='local'`（非 local exit 1）；呼叫 `createToken()` 寫 30-day dev token 到本地 D1，scope 包含 `knowledge.ask` / `knowledge.search` / `knowledge.category.list` / `knowledge.citation.read`；stdout 僅印 token 字串（便於 shell pipe）；`package.json` 加 script `mint:dev-mcp-token`
- [x] 3.4 修 `test/evals/helpers/mcp-client.ts`（Decision 7）：`DEFAULT_MCP_URL` 改 `http://localhost:3010/mcp`；新增 `getEvalBearerToken()` 讀 `EVAL_MCP_BEARER_TOKEN` env；`createEvalMcpClient` 的 `experimental_createMCPClient` transport 加 `headers: { Authorization: 'Bearer ${token}' }`；token 缺失時 throw「請先跑 `pnpm mint:dev-mcp-token` 並填 `.env`」；readiness probe 也帶 token（避免 500 被誤判 ready）
- [x] 3.5 修 `.env.example`：加 `EVAL_MCP_BEARER_TOKEN=` 與註解（取得方式指向 `pnpm mint:dev-mcp-token`；runtime 不讀取；local-only；`NUXT_MCP_AUTH_SIGNING_KEY` 輪替後需重 mint）；備註 `NUXT_MCP_AUTH_SIGNING_KEY` prerequisite 由 `wire-do-tool-dispatch` 擁有

## 4. Eval harness 主檔（Non-Blocking Eval Execution、Regression Threshold Based On Baseline、Decision 5: Threshold = 初次跑建立 baseline + 後續 regression = –5% 才算 fail）

- [x] 4.1 `test/evals/mcp-tool-selection.eval.ts`：`evalite('MCP tool selection', ...)` 套入 dataset；每筆 sample 將 tool list + system prompt + query 餵 Claude Sonnet 4.6（`claude-sonnet-4-6`）with `temperature: 0`；LLM 回應的 tool_use 丟 `scoreSample()`；實作 Decision 5 — 聚合 overall score，對照 `docs/evals/mcp-tool-selection.md` 的 `BASELINE` 檢查；overall < baseline − 5% → `process.exitCode = 1`
- [x] 4.2 `package.json` 新增 scripts：`"eval": "evalite"`、`"eval:watch": "evalite watch"`、`"eval:report": "evalite --reporter verbose"`（實際 CLI flag 依 evalite 版本調整）— 確認 `pnpm check` / `pnpm test` / CI workflow 皆不呼叫這些 script

## 5. 文件與 baseline

- [x] 5.1 新增 `docs/evals/mcp-tool-selection.md`：說明 eval 目的、前置（啟動 dev server、設定 `ANTHROPIC_API_KEY`）、跑法、每個 sample 格式、baseline 更新流程、「**NEVER** 讓 eval 加入 CI 必經 gate」規則；附上 design Non-Goals 摘要（不含 retrieval quality eval、不含 multi-turn、不自動擴資料集）避免日後 scope drift
- [x] 5.2 第一次 `pnpm eval` 執行（**@followup[TD-042]** @ingest 2026-04-24 v2：因 local NuxtHub KV binding 未 bridge → `/mcp` 503，**暫時** 走 staging URL；待 TD-042 解完後 rebaseline）。前置：`EVAL_MCP_URL=https://agentic-staging.yudefine.com.tw/mcp`、staging `/admin/tokens` UI mint 過一個 eval 用 token 已填 `.env` 的 `EVAL_MCP_BEARER_TOKEN`、`ANTHROPIC_API_KEY` 已設。記錄 overall score、per-sample 結果、model 版本、dataset 版本到 `docs/evals/mcp-tool-selection.md` 的「Baseline」章節（Note: environment=staging）
- [x] 5.3 更新 `docs/evals/mcp-tool-selection.md` Prerequisites（@ingest 2026-04-24）：(1) `NUXT_MCP_AUTH_SIGNING_KEY` 已設（由 `wire-do-tool-dispatch` 引入，32+ bytes）；(2) **Staging fallback**（目前預設）：staging `/admin/tokens` UI mint token + `EVAL_MCP_URL=https://...staging.../mcp`；(3) **Local** 暫不可用（@followup[TD-042] local KV bridge infra fix 後才能走）：`pnpm mint:dev-mcp-token` + `EVAL_MCP_URL=http://localhost:3010/mcp`；(4) 兩條路 token 都填 `.env` 的 `EVAL_MCP_BEARER_TOKEN`；(5) signing key 輪替或 token 過期需重 mint

## 6. 驗證與品質閘門

- [ ] 6.1 `pnpm check`（format + lint + typecheck + test）全綠；確認 `pnpm check` 完全沒有觸發 eval / 沒有 LLM API call（Non-Blocking Eval Execution — Eval is excluded from default quality gates）
- [x] 6.2 `pnpm test` 單獨跑 scorer unit test（`test/unit/evals-scorer.test.ts`）全綠
- [x] 6.3 `pnpm spectra:followups` / `pnpm audit:ux-drift` 無新 drift
- [x] 6.4 CI workflow 檢視（`.github/workflows/**` 或對應設定）：確認沒有任何 job 呼叫 `pnpm eval` / `evalite`；如有疑似項，明確排除並註明
- [x] 6.5 以修改某一筆 dataset sample 的 `expectedTool` 為錯誤 tool 方式臨時讓 eval fail（**@followup[TD-043]**）。驗證結果：stderr / stdout **有** 印出 `Eval regression: overall 83.33% is more than 5pp below baseline 91.67% (delta=-8.34pp)` + `lowSamples=ask-specific-launch-readiness ... ask-category-governance-review ...` signal 生效；但 `pnpm eval` 最終 exit code = 0（evalite / vitest afterAll 吃掉 `process.exit` 與 `throw`；三種寫法皆試過）。Decision 5 的 stdout 信號 acceptance 通過、exit code propagation 部分歸 TD-043。已還原 dataset（驗證後 `pnpm eval` 重跑回到 overall=91.67、delta=-0.00）

## 7. 人工檢查

- [ ] 7.1 使用者 review `test/evals/fixtures/mcp-tool-selection-dataset.ts` 的 query 文案，確認每筆代表典型真實使用者提問（非造假 / 非模板化）
- [ ] 7.2 使用者檢視首次 baseline 分數合理性：若 overall < 70% 或任何個別 tool 完全掉分，代表 metadata / description 可能有問題，需討論是否進 `enhance-mcp-tool-metadata` apply 後再 rebaseline
- [ ] 7.3 使用者確認 `.env.example` 與 `docs/evals/mcp-tool-selection.md` 的 API key 命名、警語、成本估算足夠清楚，新進 contributor 跑 `pnpm eval` 不會意外燒錢
