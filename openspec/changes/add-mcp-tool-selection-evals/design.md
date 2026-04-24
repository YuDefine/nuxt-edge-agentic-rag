## Context

`enhance-mcp-tool-metadata` 補齊了 4 個 MCP tool 的 discovery metadata（field descriptions、annotations、inputExamples），但目前缺乏量化機制回答核心問題「LLM 實際拿到這些 metadata 後，tool-selection 到底有多準？」。現有 `test/integration/mcp-*.test.ts` 只測 protocol / auth / DO lifecycle 等 structural 行為，完全沒有 LLM 視角的回歸覆蓋。本 design 定義 eval harness 的技術選型、執行模型、評分策略，與與既有 test 體系的邊界。

專案是 Cloudflare Workers + D1 + Vitest (`@voidzero-dev/vite-plus-test`)，既有 test target 以 `vp test run` 驅動。Harness 需與 vitest 生態相容，避免兩套 runner。LLM 呼叫不得在 CF Workers runtime 跑（會超 30s CPU + 外部 egress cost），eval 必須是 Node.js local / nightly job。

## Goals / Non-Goals

### Goals

- 提供單一指令 `pnpm eval` 就能跑 MCP tool-selection eval，輸出可讀報告與分數
- 覆蓋 4 個 tool（`askKnowledge` / `searchKnowledge` / `getDocumentChunk` / `listCategories`）× 至少 3 類典型 query pattern = 最少 12 筆 ground truth
- Harness swap provider 容易（今天用 Anthropic，未來換 Workers AI 只改 1 行 adapter）
- 評分輸出可重跑 + 可比較（保留 run id、model 版本、dataset 版本、分數分佈）

### Non-Goals

- 不覆蓋 retrieval quality（relevance / groundedness / citation correctness）— 另行 change
- 不覆蓋多輪對話（multi-turn tool use）— 初版僅單輪 query → 單次 tool-selection
- 不自動化資料集擴充 — 新增樣本仍手動維護
- 不嘗試達到「100% 正確率」— 門檻依 baseline 調整

## Decisions

### Decision 1: Eval framework = `evalite`

**Choice**: 用 `evalite`（`@matt-pocock/evalite` 或現行 npm 發布名稱，由 `pnpm add` 時決定）。

**Rationale**:

- 與 vitest API 近：`evalite()` 類似 `describe()` / `it()`，既有心智模型直接複用
- 自帶 web dashboard（`evalite watch`），可視化分數趨勢
- 已和 AI SDK 有官方 example，無須額外黏合
- TypeScript 原生，無須額外 transform

**Alternatives considered**:

- **Promptfoo**：YAML config driven，對 TS project 是外來生態；dashboard 較豐富但成本高於需求
- **Braintrust**：SaaS，免費額度有限；本 change 要跑 local / nightly 不需 SaaS 後端
- **自寫**：Scoring / reporting / watch mode 全部重造輪子，不划算

### Decision 2: LLM provider = Anthropic Claude (via `@ai-sdk/anthropic`)

**Choice**: Initial baseline 用 Claude Sonnet 4.6 (`claude-sonnet-4-6`) 作為 eval LLM。Harness 保留 `LlmAdapter` 介面，未來可無痛 swap。

**Rationale**:

- MCP 是 Anthropic 提的協議，Claude 對 tool-selection 的行為最接近 Claude Desktop / Claude API 實際客戶端使用情境（dogfooding）
- Sonnet 4.6 tool use 支援成熟、成本 << Opus，適合 nightly eval 跑 10+ 樣本
- 與專案既有 `@nuxtjs/mcp-toolkit` 的 primary audience（Claude）對齊
- AI SDK 的 `@ai-sdk/anthropic` provider + tool calling 生態成熟

**Alternatives considered**:

- **OpenAI GPT-4o**：tool use 也 OK，但 MCP support 剛推出不久，client 行為與 Claude 差異大，不適合作為「MCP 品質」基準
- **Workers AI**：成本 $0，但目前 Workers AI 的 tool-use 品質顯著弱於 Claude，會讓 eval 分數失去訊號（分不清是 tool metadata 爛還是 LLM 選擇力弱）
- **Multi-provider baseline**：初版範圍過大；先做 Claude，穩定後再擴

### Decision 3: MCP client 連線 = AI SDK `experimental_createMCPClient` against local dev server

**Choice**: 用 `@ai-sdk/mcp` 的 `experimental_createMCPClient({ transport: { type: 'sse', url: 'http://localhost:3000/mcp' } })`（或 streamable-http），eval 前置用 `pnpm dev` / test harness 啟動 local Nuxt server，transport 形式由 runtime config 決定。

**Rationale**:

- 最接近真實：真的 MCP server + 真的 auth + 真的 tools/list payload → LLM 看到的 metadata 與 production 完全一致
- 不動 production code：eval 完全跑在 dev env
- `@ai-sdk/mcp` 是 official AI SDK 的 MCP client，與 Claude / OpenAI tool use integration 已抽好

**Alternatives considered**:

- **In-process（直接 import `server/mcp/tools/*.ts`）**：省掉啟 server，但繞過 middleware / auth / session / metadata 註冊流程，eval 結果不反映真實客戶端體驗 — 否決
- **Mock MCP server**：快但與真實 tool list payload 脫鉤，metadata 改動時 eval 不會反應 — 否決

**Risks / 落地細節**: eval 需先起 dev server（或獨立 test server），harness 要有 readiness probe 等 server 啟動；如 dev server port 衝突，sticky 到 `EVAL_MCP_URL` env var。

### Decision 4: Scoring = 分層加權（tool match + args match）

**Choice**: 每筆 ground truth 評分為：

- **Tool-name match**（60% 權重）：LLM 選的 tool 名稱是否等於期望 tool — binary（0 / 1）
- **Args shape match**（40% 權重）：LLM 給的 arguments 是否通過期望 tool 的 `inputSchema.parse()`，且關鍵欄位（如 `query` 是否包含期望關鍵字）符合 fixture 定義的判定器 — binary（0 / 1）

總分 = Σ(per-sample weighted score) / sample count × 100%。

**Rationale**:

- Tool-name 是首要訊號，args shape 次要：選錯 tool 是品質災難，選對但 args 爛只是次優
- 關鍵字比對用 fixture 裡的 lambda，避免過度嚴格字面 match 導致 false negative
- Binary per-dimension 比 cosine similarity 簡單、可重現、易 debug

**Alternatives considered**:

- **Pure tool-name match**：忽略 args 是否合理，訊號太粗
- **LLM-as-judge**：用另一個 LLM 判分，成本加倍且又引入新的 non-determinism
- **Full args deep equality**：過嚴，LLM 改寫 query 語意相同但字面不同會 false negative

### Decision 5: Threshold = 初次跑建立 baseline + 後續 regression = –5% 才算 fail

**Choice**:

- **Baseline run**（第一次成功跑）的分數記入 `docs/evals/mcp-tool-selection.md`
- 後續 eval 分數低於 baseline − 5 個百分點 → harness exit non-zero（manual / nightly 回饋用）
- `pnpm check` / CI **永不**呼叫 eval；eval 是 nightly / manual only

**Rationale**:

- LLM 非 deterministic：即使 temperature=0，tool-use JSON 組裝仍有輕微浮動；5% buffer 吸收雜訊
- 硬性固定 80% 等絕對數字脫離 LLM 能力演進曲線：provider 升級可能自然提分，dataset 擴充可能自然降分；相對 baseline 才有意義
- CI 不跑：API cost + key management + network flakiness 會污染 PR 閘門訊號

**Alternatives considered**:

- **絕對門檻 80%**：僵化，provider / model 升級後不 update 門檻會 false positive
- **每次 auto-update baseline**：drift 風險，LLM 變差也察覺不到

### Decision 6: LLM API key 命名 = `ANTHROPIC_API_KEY`（沿用 AI SDK 慣例）

**Choice**: `.env` / `.env.example` 用 `ANTHROPIC_API_KEY`；harness 讀取時直接用 `@ai-sdk/anthropic` 預設行為。

**Rationale**:

- AI SDK provider package 預設讀取 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`，沿用慣例降低新人 onboarding 成本
- 不要自訂 `EVAL_LLM_KEY` 這種 project-specific name，避免未來多處硬編碼

## Risks / Trade-offs

- **LLM flakiness** → **Mitigation**: baseline + 5% buffer；每次 eval 跑固定 seed / temperature=0；每樣本最多 retry 1 次（網路錯誤不計分）
- **API cost 失控** → **Mitigation**: dataset 起步 ≤ 20 筆；`pnpm eval:watch` 預設不自動跑全部；`.env` sample `ANTHROPIC_API_KEY` 寫警語；harness 印「預估本次跑 N samples, 估計成本 ~$X」
- **MCP server 啟動依賴** → **Mitigation**: harness 啟動前先打 `/health` or `/mcp` probe；超時清楚指示 `pnpm dev` 未跑；docs 寫明 prerequisite
- **Dataset 偏差 / over-fit** → **Mitigation**: docs 要求每次改 tool metadata / description 時也審視 dataset 是否需更新；spec 中規定最少覆蓋面（4 tools × 3 patterns = 12 samples）
- **Provider 選定後被鎖** → **Mitigation**: harness 用 `LlmAdapter` interface，初版只實作 Anthropic，日後加 adapter 不動其他部分

## Migration Plan

本 change 為新增 dev tooling，無 runtime migration 需求。

Rollout 順序：

1. 安裝 devDeps、建 `test/evals/` 目錄骨架、scorer + unit test（不需 API key 亦可跑）
2. 建 dataset fixture（12+ samples）
3. 建 harness + MCP client helper
4. 加 `package.json` scripts + `.env.example`
5. 寫 `docs/evals/mcp-tool-selection.md`（先留 baseline 位置為 TBD）
6. 第一次 `pnpm eval` 在 local 跑成功 → 把 baseline 分數填進 docs
7. archive change

## Open Questions

- 是否需要 eval 的結果上傳到 central dashboard（如 Braintrust / evalite hosted）？**初版否，local file / terminal 輸出即可**，未來視需要再 discuss
- 多 provider 比對（Anthropic vs OpenAI vs Workers AI）是否有價值？**初版否**，專注 Claude baseline；待 baseline 穩定後另行 discuss
