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

**@ingest 2026-04-24 v2 — Staging fallback**: apply 階段發現 NuxtHub local dev 未把 `hubKV()` 注入 `cloudflare.env`，本專案 `getRequiredKvBinding` 在 local 必 503，`POST /mcp` 整條路走不通（見 @followup[TD-042]）。Local infra fix 屬獨立 change scope，本 change **暫時** 允許 `EVAL_MCP_URL` 指向 **staging**（`https://agentic-staging.yudefine.com.tw/mcp`）；staging 在真 Cloudflare Workers runtime，KV binding 正常。TD-042 解完後切回 local，baseline 需 re-run 驗證分數差異 ≤ 5pp。

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

### Decision 7: Eval dev auth = dev-only token mint CLI + `EVAL_MCP_BEARER_TOKEN` env（@ingest 2026-04-24）

**Choice**: 新增 `scripts/mint-dev-mcp-token.mts` dev-only CLI — runtime guard `NUXT_KNOWLEDGE_ENVIRONMENT==='local'`，呼叫 `mcp-token-store.createToken()` 寫一個 30-day dev token 到本地 D1（scope=`knowledge.ask/search/category/citation`），stdout 印出 token 字串。使用者手動貼到 `.env` 的 `EVAL_MCP_BEARER_TOKEN`。Eval harness 的 `mcp-client.ts` 透過 `experimental_createMCPClient` transport 的 `headers: { Authorization: 'Bearer ${token}' }` 帶 token 過 middleware；token 缺失時 throw 清楚訊息指向 mint CLI。

**Rationale**（apply 中發現 task 3.1 實作缺口，ingest 擴充）:

- MCP middleware（`server/mcp/index.ts` → `runMcpMiddleware`）一律強制 Bearer token auth。Decision 3 要求用真實 dev MCP server（不 bypass middleware），因此必須有有效 token，不能 anonymous `tools/list`
- Dev CLI 為一次性手動步驟：**NEVER** 改 production middleware、**NEVER** 把 DB write 副作用藏進 test helper — 兩者皆違反 Non-Goals
- Token 過期 / `NUXT_MCP_AUTH_SIGNING_KEY` 輪替時重 mint；單步驟、explicit、failure mode 清楚
- 同時修正 `DEFAULT_MCP_URL` 從 `http://localhost:3000/mcp` 改 `http://localhost:3010/mcp`（:3000 衝到其他專案 Nuxt dev；本 repo E2E_BASE_URL 即為 :3010）

**Alternatives considered**:

- **Middleware dev-mode bypass**：違反 Non-Goals「NEVER 改 server/mcp/\*\*」— 否決
- **OAuth client_credentials flow**：本專案 connector 目前只實作 authorization_code，新增 CC grant 屬 `wire-do-tool-dispatch` scope — 否決
- **Eval harness 自動寫 D1 mint token**：把 DB 寫入隱藏在 test helper，debug / signing-key 輪替時除錯困難；違反「單一 explicit 步驟」原則 — 否決
- **Admin UI 手動複製 token**：需瀏覽器 GUI 步驟，不符合 CLI-reproducible prerequisites — 否決

**Risks / 落地細節**:

- Token 寫到本地 D1 / fs-lite sqlite；新人第一次跑必須 `pnpm mint:dev-mcp-token`，docs Prerequisites 明列
- `NUXT_MCP_AUTH_SIGNING_KEY` 由 `wire-do-tool-dispatch` 引入，本 change docs 只 _引用_ prerequisite 不 _擁有_ 該 env；若 `wire-do-tool-dispatch` archive 前輪替 signing key，舊 dev token 失效需重 mint
- CLI guard 以 `NUXT_KNOWLEDGE_ENVIRONMENT` 檢查；**NEVER** 在 staging / production 跑（避免意外寫入實環境 D1）
- **@ingest 2026-04-24 v2**: Staging fallback（見 Decision 3 v2 補充）下，此 CLI **不**涵蓋 staging token。使用者需在 staging `/admin/tokens` UI 手動 mint 並把 token 貼到 `.env` 的 `EVAL_MCP_BEARER_TOKEN`。Mint CLI 擴充支援 staging 會放大 blast radius（能對 staging D1 寫 token），與「單步驟、explicit」原則衝突；保持 local-only

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
