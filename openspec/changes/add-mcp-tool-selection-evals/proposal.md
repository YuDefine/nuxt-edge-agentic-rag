## Why

本專案是 Agentic RAG，MCP client（Claude、Cursor、ChatGPT connectors）的 **tool-selection 精準度**直接決定 end-to-end 品質，但目前 `test/integration/mcp-*.test.ts`（11 個檔）只涵蓋 protocol handshake / auth / scope / DO lifecycle 等 **structural** 行為，完全沒有 LLM-視角的行為回歸。例如「使用者問某個 SOP，LLM 是否會呼叫 `askKnowledge` 而不是 `searchKnowledge`？帶的 `query` 是否改寫合理？」這類問題目前零覆蓋。`enhance-mcp-tool-metadata`（parked）補齊了 tool metadata，但缺乏可量化的品質回歸 — 本 change 引入 eval harness，把 tool-selection 從靠直覺的「LLM 應該會選對吧」，變成可跑、可看分數、可阻擋迴歸的 artifact。

## What Changes

- 新增 `test/evals/` 目錄與 eval harness 框架（採 `evalite`，與 vitest 生態相容）
- 新增 `test/evals/mcp-tool-selection.eval.ts`：以「自然語言 query → 期望呼叫的 tool 名稱 + 期望 argument shape」為對照表；用 AI SDK 驅動 LLM 對真實 MCP server（in-process 或 HTTP）的 tool 描述作 tool-selection 決策，對比對照表計分
- 新增 `test/evals/fixtures/mcp-tool-selection-dataset.ts`：典型 query 對照表（具體主題提問、類別探索、citation replay、類別列表，覆蓋 4 個 tool）
- `package.json` 新增 devDependencies：`evalite`、`@ai-sdk/mcp`（MCP client for AI SDK）、至少一個 LLM provider adapter（`@ai-sdk/anthropic` 或 `@ai-sdk/openai`，具體選擇由 design 決定）
- `package.json` 新增 scripts：`eval`、`eval:watch`、`eval:report`（皆為獨立 cmd，**不**併入 `pnpm check` / `pnpm test`）
- `.env.example` 新增 LLM API key 欄位與註解，指向 eval 用途；local `.env` 沿用同命名
- 新增 `docs/evals/mcp-tool-selection.md`：說明 eval 目的、執行方式、資料集維護規則、評分門檻
- 新增 spec capability `mcp-tool-selection-evals`：記錄 tool-selection eval 覆蓋範圍與最低正確率門檻要求

## Non-Goals

- **NEVER** 改動 production MCP server（`server/mcp/**`）的任何行為、metadata、或 handler 邏輯 — 本 change 僅新增 eval harness 與資料集
- **NEVER** 把 eval 併入 `pnpm check` / `pnpm test` / CI mandatory gate — eval 需要 LLM API key、有金錢成本、且 LLM 回應非 deterministic，不適合 block PR；僅作為 manual / nightly run
- **NEVER** 引入 OpenEval / Promptfoo / DeepEval / Braintrust 等其他 eval 框架 — 決定用 `evalite`（與 vitest 生態近）後堅守一家，避免兩套 harness 維護負擔
- **NEVER** 在本 change 涵蓋 retrieval 品質 eval（relevance / groundedness）— 另行規劃 change；本 change 專注於 **tool-selection** 行為
- **NEVER** 在本 change 動 `openspec/specs/mcp-knowledge-tools/spec.md` — 對既有 tool 行為無新需求，spec 延續不變
- **不** 硬鎖特定 LLM 廠商 — harness 支援 swap provider，但 initial dataset 只需單一 provider 建立 baseline
- **不** 在本 change 依賴 `enhance-mcp-tool-metadata` 是否 archive — 兩 change 獨立；metadata 尚未上線時 eval 亦可跑（只是分數可能較低）

## Capabilities

### New Capabilities

- `mcp-tool-selection-evals`: LLM-based tool-selection 品質回歸 eval harness；定義覆蓋範圍（4 個 tool）、資料集維護、最低正確率門檻、執行方式（manual / nightly、non-blocking）

### Modified Capabilities

(none)

## Affected Entity Matrix

本 change 不觸動 DB schema、enum、shared types、或 migration。不需要 Entity Matrix。

## User Journeys

**No user-facing journey (dev-facing eval harness only)**

理由：本 change 純粹新增 developer tooling（eval harness + dataset + docs），不新增 / 不修改 / 不移除任何 Web UI 頁面、管理介面、API endpoint、MCP tool 行為、或 user-triggered 行為。End user 無可感知差異；受益對象是日後修改 MCP tool（metadata / description / inputSchema）的開發者，能透過 eval 捕捉 tool-selection 迴歸。

## Implementation Risk Plan

- Truth layer / invariants: Eval 的 ground truth 放在 `test/evals/fixtures/mcp-tool-selection-dataset.ts`（TypeScript literal，與 spec 中的最低正確率門檻對應）；評分結果為非 deterministic，**NEVER** 當成 single source of truth 用來判 production failure；eval harness 不得 import production config 或 env secret，LLM API key 只走 `.env`
- Review tier: **Tier 2** — 新增 devDeps、新增 test 目錄結構、新增 scripts；需 code review 確認 harness 架構與資料集涵蓋合理，但不涉及 auth / migration / security-critical path
- Contract / failure paths: Eval failure（正確率 < 門檻）**不**阻擋 `pnpm check` 或 CI；LLM API rate limit / quota exceeded → harness 需顯示清楚訊息並 exit non-zero（用於 manual run 回饋），但 CI 不會觸發；網路錯誤 / API key 缺失時不可跑 eval，harness 需有 friendly fallback message 指引修正
- Test plan: Unit — 為 eval harness 的 scoring logic 寫單元測（不呼叫真 LLM，mock response 驗證 pass/fail 邏輯）；Integration — `pnpm eval` 跑一次 green 為驗證基線（local only，需 API key）；Screenshot — 無 UI；Manual evidence — 第一次 `pnpm eval:report` 輸出結果 snapshot 附在 `docs/evals/mcp-tool-selection.md` 當基準分數
- Artifact sync: `package.json`（devDeps + scripts）、`pnpm-lock.yaml`、`.env.example`、`docs/evals/mcp-tool-selection.md`（新檔，說明執行與維護）、`openspec/specs/mcp-tool-selection-evals/spec.md`（新 spec）；不動 `server/mcp/**`、不動 `test/integration/**`、不動 `CHANGELOG.md`（dev tooling）；`HANDOFF.md` 完成時移除 MCP Toolkit Review follow-ups 的對應項

## Impact

- Affected specs: `mcp-tool-selection-evals`（New）
- Affected code:
  - New:
    - test/evals/mcp-tool-selection.eval.ts
    - test/evals/fixtures/mcp-tool-selection-dataset.ts
    - test/evals/helpers/mcp-client.ts (harness helper，連 MCP server 並呼叫 LLM)
    - test/evals/helpers/scorer.ts (tool-selection scoring logic)
    - test/unit/evals-scorer.test.ts (scoring logic unit test)
    - docs/evals/mcp-tool-selection.md
    - openspec/specs/mcp-tool-selection-evals/spec.md (由 spec delta 落地後產生)
  - Modified:
    - package.json (devDependencies + scripts)
    - pnpm-lock.yaml
    - .env.example
  - Removed: (none)
- Dependencies / bindings:
  - 新增 devDeps：`evalite`、`@ai-sdk/mcp`；LLM provider adapter（`@ai-sdk/anthropic` 或 `@ai-sdk/openai`，design 決定）
  - 新增 env var：LLM API key（名稱於 design 決定），僅 local / nightly eval 用；production runtime 不讀取
  - 無新 wrangler binding、無新 migration、無新 Cloudflare resource
- Parallel change coordination:
  - 與 `upgrade-mcp-to-durable-objects` 獨立（後者動 `server/mcp/index.ts` + DO transport；本 change 只動 test / package / docs）
  - 與 `enhance-mcp-tool-metadata` 獨立，兩 change 可並行；metadata change 完成後，本 eval 分數預期提升，可作為該 change 的品質證據
