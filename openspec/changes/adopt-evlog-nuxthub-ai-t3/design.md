## Context

T3 是 NuxtHub D1 stack 完整版，與 Supabase 系列 T1/T2 完全獨立 wiring（不共用 drain / 不共用 schema）。target consumer 是 nuxt-edge-agentic-rag（AI agent + RAG + agentic workflow）。

T3 不疊在 T1 / T2 之上，是平行入口 — 新 NuxtHub stack consumer 直接從 T3 起步，不必先跑 T1。

### 為什麼 T3 不共用 T1 的 Sentry drain

agentic-rag 沒裝 Sentry SDK，且 NuxtHub D1 是 stack-native sink。把 wide event 寫進 D1 後可走 NuxtHub 自家 query 介面 + cron 自動 retention，無需 Sentry SaaS 成本。

如果未來 agentic-rag 加 Sentry（例：production incident pager），可額外裝 Sentry drain 與 NuxtHub D1 並存（pipeline 內兩個 drain），但 T3 baseline 不含。

### 釐清 evlog API：createAILogger 不存在

master plan § 1 / § 8.4 早期版本提到 `createAILogger` —— 這個 evlog API **不存在**（M2.4 修正）。`evlog-ai-sdk-logger/` snippet 是 convention：在現有 `useLogger(event)` 上掛 `ai.*` 欄位 + 用 `log.info('ai.tool_call', ...)` 發子事件。

優點：

- 共享 enricher / drain / sampling / redaction 配置
- cost / token 與 user / route / tenant 在同一筆 wide event
- 不是新 logger 種類，認知成本低

## Goals / Non-Goals

### Goals

- 所有 server endpoint wide event 寫進 NuxtHub D1，可自家 SQL query
- AI SDK 呼叫的 cost / token / tool / moderation / embedding 子事件全帶 `ai.*` 欄位
- SSE / MCP / Durable Object lifecycle 用 child logger pattern，避免 sealed wide event 撞
- Better Auth 流程（含 passkey）自動帶 user identity 進 wide event
- cost-based sampling：低成本 embedding 大量呼叫時自動 drop

### Non-Goals

- Supabase D-pattern audit（agentic-rag 用 D1 knowledge audit，不適用 perno D-pattern）
- Sentry drain 整合（T3 baseline 不含，後續 ad-hoc 加裝）
- multi-package layout（agentic-rag 是 single-package）
- typed fields（agentic-rag AI 場景欄位變化大，typed 反而僵化）

## Decisions

### Decision 1: D1 主 sink 用 @evlog/nuxthub Nuxt module，不自寫 D1 drain

`@evlog/nuxthub` 已封 D1 schema migration + retry + retention，自寫等於重造。Schema 與寫入邏輯固定（不可自訂 column），與 `evlog-postgres-drain` 自家 schema 不同。

如果未來 agentic-rag 加 Supabase（例：user table），兩個 drain 可並行（沒先例，需 review collision）。

### Decision 2: AI SDK 走 convention 而非新 logger 種類

`evlog-ai-sdk-logger/` 4 個 helper（`recordAIGeneration` / `recordToolCall` / `recordModeration` / `recordEmbedding`）只是把 AI SDK 結果 map 到 `event.ai.*` 欄位。優點：

- 共享 evlog enricher / drain / sampling / redaction 配置（不必重做）
- AI cost / token 與 user / route / tenant 在同一筆 wide event（cross-reference 容易）
- 升 evlog 版本不會被 AI SDK API 變動連動

### Decision 3: cost-based sampling for embedding

embedding 是高頻低成本，全 keep 會把 D1 100 writes/s 上限吃光。evlog `sampling.keep[]` 只接 declarative conditions（不能用 cost callback），所以 cost-based forceKeep 走 Nitro hook：

```ts
// server/plugins/evlog-cost-keep.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:emit:keep', (ctx) => {
    const aiCost = (ctx.event as { ai?: { cost_usd?: number } }).ai?.cost_usd
    return Boolean(aiCost && aiCost > 0.001)
  })
})
```

cost > $0.001 才強制 keep；audit event 由 evlog 內部 `auditOnly` / `signed` chain 自動 forceKeep（不需在此 hook 重複）。consumer 可微調 threshold。

### Decision 4: SSE / MCP 用 child logger pattern

agentic-rag TD-057 已實證：parent `useLogger(event)` 在 SSE response 構造時 emit；stream 內 `log.set` 撞 sealed wide event。解法：

- `forkChildLogger(event, options)`：從 parent log 建獨立 child；child 帶 `operation` + `_parentRequestId`；不自動 emit
- `emitChildLogger(event, child, { error })`：stream settle / session close 時手動觸發 enricher + drain；error 時 `_forceKeep` 防被 sampling 丟

### Decision 5: Better Auth + passkey 走 createAuthMiddleware

Better Auth 提供 `createAuthMiddleware` hook，可在 sign-in / sign-out 路徑統一注入 evlog context。passkey flow 同樣經 hook，不需要為 passkey 寫獨立 wiring。

## Risks / Trade-offs

| Risk                                               | Mitigation                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| D1 100 writes/s 上限（free tier）打到              | cost-based sampling drop 低成本 embedding；high-traffic 升 paid tier                           |
| `@evlog/nuxthub` schema 變更需走 NuxtHub migration | 不可手動 `wrangler d1 execute`；遵守 NuxtHub migration tooling                                 |
| cross-region D1 latency 不可預期                   | M3a.4 apply 前以 `wrangler dev --region <pinned>` smoke test 量測；超 100/s 才走 batch overlay |
| AI cost 計算錯誤（model pricing 表過期）           | snippet README 標明 `PRICING` 由 consumer 維護，evlog 不知道 model 價格                        |
| SSE child logger 漏 emit（stream error path）      | 在 `try / catch / finally` 三條路徑都呼叫 `emitChildLogger`                                    |

## Migration Plan

1. 確認 consumer 已裝 `evlog`、`@evlog/nuxthub`、`@nuxthub/core`、AI SDK（`ai` + provider）
2. `nuxt.config.ts` 加 `@evlog/nuxthub` module + retention 配置
3. 套 enricher stack + Workers AI enricher
4. 改既有 `createRequestLogger` → `forkChildLogger` / `emitChildLogger`（每個 SSE / MCP endpoint）
5. AI SDK 呼叫處插入 4 個 helper（`recordAIGeneration` / `recordToolCall` / `recordModeration` / `recordEmbedding`）
6. Better Auth `createAuthMiddleware` 內注入 evlog identity
7. 跑 `wrangler dev --region apac` 觸發 chat endpoint，驗：
   - D1 `SELECT count(*) FROM evlog_events` 有 row
   - `event.ai.cost_usd` / `event.ai.tool_calls` / `event.ai.tokens` 落地
   - SSE stream settle 後 child event 進 D1
8. production smoke：`pnpm deploy` → 觸發 chat → D1 + cron retention 確認
