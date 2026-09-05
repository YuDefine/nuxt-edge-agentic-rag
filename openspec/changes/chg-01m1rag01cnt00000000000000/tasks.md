<!-- control-plane-change-id: chg_01M1RAG01CNT00000000000000 -->
<!-- control-plane-projector: ai-control-plane/tasks-v1 -->
<!-- control-plane-cursor: intent:1;flow:16;runtime:20;evidence:0;decision:0 -->
<!-- control-plane-input-digest: sha256:48da7ec00d2e87773c85c96533acdf7f21d3fb35c1a9198de2132c1e44583d04 -->
# ===== openspec/changes/adopt-evlog-nuxthub-ai-t3/proposal.md =====
<!--
Spectra change template T3 — evlog-adopt-cfworkers-nuxthub-ai
clade SoT: openspec/templates/evlog-adopt-cfworkers-nuxthub-ai/
copy 進 consumer 端 openspec/changes/<rename>/，跑 spectra-apply 即可。
-->

## Consumer baseline (nuxt-edge-agentic-rag)

當前 stack 與既有實作（apply 前快照）：

- `evlog@^2.14.0`（須升 `^2.16.0` 才能用 NuxtHub drain + sampling.keep + redact 完整 API）
- `@evlog/nuxthub` 尚未安裝；nuxt.config 已掛 `evlog/nuxt` module，但缺 D1 drain
- `@nuxthub/core@^0.10.7`、Cloudflare Workers preset (`cloudflare_module`)，D1 binding `DB`
- AI SDK：`@ai-sdk/anthropic@^3.0.71` + `@ai-sdk/mcp@^1.0.36` + `ai@^6.0.168`，主要 model 為 Anthropic `claude-haiku-4-5` / `claude-sonnet-4-5`，加上 Workers AI binding（free tier，cost = 0）
- Auth：`better-auth@^1.6.9` + `@better-auth/passkey@^1.6.9` + `@onmax/nuxt-better-auth`，三層 role（admin / member / guest），passkey-first 流程已上線
- 主要 SSE/MCP entry：`server/api/chat.post.ts`（17.1K），TD-057 已自家實作 `createRequestLogger` + `_deferDrain` + `runStreamLogDrain` child pattern；本 change 把它收斂到 `forkChildLogger` / `emitChildLogger` helper
- 既有 `server/plugins/`：`error-sanitizer.ts` / `local-kv-bridge.ts` / `register-mcp-session-durable-object.ts` / `register-mcp-streaming-bypass.ts`，**沒有** evlog enricher / cost-keep plugin
- 既有 `nuxt.config.evlog`：`{ env: { service: 'nuxt-edge-agentic-rag' }, include: ['/api/**'] }`，缺 sampling / redact / transport / retention

## Why

本 consumer 是 Cloudflare Workers + NuxtHub D1 + AI agent stack（target：nuxt-edge-agentic-rag）。Supabase 系列 T1/T2 不適用：

- Drain 主 sink 必須走 NuxtHub D1（`@evlog/nuxthub` Nuxt module），不是 Sentry / Postgres
- AI SDK 呼叫（`generateText` / `streamText` / tool call / moderation / embedding）必須把 cost / token / duration 灌進 wide event 的 `ai.*` 欄位
- SSE / MCP / Durable Object lifecycle 跨越 Nitro `afterResponse`，parent `useLogger` 會在 stream 還沒結束就 emit，必須走 child logger pattern
- Better Auth + passkey 必須整合 `createAuthMiddleware` 灌 user identity

clade 5 consumer 中只有 nuxt-edge-agentic-rag 適用 T3。

Reference：

- `~/offline/clade/docs/evlog-master-plan.md` § 8.4（agentic-rag T3 完整步驟）
- `~/offline/clade/vendor/snippets/evlog-nuxthub-drain/`
- `~/offline/clade/vendor/snippets/evlog-ai-sdk-logger/`
- `~/offline/clade/vendor/snippets/evlog-mcp-sse-child-logger/`

## What Changes

- Drain：套用 `evlog-nuxthub-drain/` snippet（`@evlog/nuxthub` Nuxt module，自動加 server plugin + cron retention handler）。
- Enricher stack：套用 `evlog-enrichers-stack/` 5 件套 + Workers AI enricher（`workersAI.gateway` / `workersAI.modelId`）。
- AI SDK convention：套用 `evlog-ai-sdk-logger/` snippet（`recordAIGeneration` / `recordToolCall` / `recordModeration` / `recordEmbedding` 4 個 helper）。
- SSE / MCP child logger：套用 `evlog-mcp-sse-child-logger/`，把現有 `createRequestLogger` 改用 `forkChildLogger` + `emitChildLogger` pattern。
- Better Auth integration：`createAuthMiddleware` 把 user identity 灌進 evlog context（passkey flow 也適用）。
- Sampling 微調：cost / token 子事件量大時必 sample（建議 `cost > $0.001` 才 keep）。
- `nuxt.config.ts` 加 `@evlog/nuxthub` module + `evlog.retention` 配置。

## Capabilities

### New Capabilities

- evlog-adoption: NuxtHub AI variant — D1 drain + AI SDK convention + child logger pattern + Better Auth identity，對應 `rules/core/evlog-adoption.md` Adoption depth 自評 AI variant column。

===== openspec/changes/adopt-evlog-nuxthub-ai-t3/tasks.md =====
# Tasks — T3 evlog-adopt-cfworkers-nuxthub-ai

> Snippet 路徑全部以 clade 中央倉為基準：`~/offline/clade/vendor/snippets/`
> 本 template 是 NuxtHub D1 + AI agent 完整 stack；不疊在 T1 / T2 之上，是平行入口。

## 0. Pre-flight

- [ ] 0.1 確認 consumer 已裝 `evlog`、`@evlog/nuxthub`、`@nuxthub/core`；缺則 `pnpm add evlog @evlog/nuxthub @nuxthub/core`
- [ ] 0.2 確認 AI SDK 已裝（`ai` + provider，例如 `@ai-sdk/openai` / `@ai-sdk/anthropic` / Workers AI binding）
- [ ] 0.3 確認 Better Auth 已裝（含 passkey plugin 如有）
- [ ] 0.4 NuxtHub D1 binding 已 `wrangler d1 create` 且 `nuxt.config.ts` 有 `nuxthub.bindings.d1` 設定

## 1. NuxtHub D1 drain

- [ ] 1.1 `nuxt.config.ts` `modules` array 加 `'@evlog/nuxthub'`（會自動 install `evlog/nuxt` + `@nuxthub/core`）
- [ ] 1.2 `nuxt.config.ts` 加 `evlog: { retention: '90d' }` 配置 cron 自動 drop > 90 day rows
- [ ] 1.3 `wrangler dev --region apac` 觸發任意 endpoint，跑 `wrangler d1 execute <db> --remote --command "SELECT count(*) FROM evlog_events"` 應有 row
- [ ] 1.4 確認 `server/api/_cron/evlog-cleanup` handler 已自動加（由 module 注入）

## 2. Enricher stack（含 Workers AI enricher）

- [ ] 2.1 `cp ~/offline/clade/vendor/snippets/evlog-enrichers-stack/enrichers.ts server/plugins/evlog-enrich.ts`
- [ ] 2.2 加 Workers AI enricher：在 `enrichers.ts` 內補 `workersAIEnricher()`，從 `event.context.cloudflare?.env?.AI` binding 讀 gateway / modelId 寫入 `event.workersAI.*`
- [ ] 2.3 plugin alphabetical loading：`evlog-enrich.ts` 在 Better Auth plugin 之後
- [ ] 2.4 觸發 endpoint 看 wide event 帶 `event.userAgent` / `event.geo` / `event.traceContext` / `event.workersAI.*`

## 3. AI SDK convention

- [ ] 3.1 `cp ~/offline/clade/vendor/snippets/evlog-ai-sdk-logger/ai-logger.ts server/utils/ai-logger.ts`
- [ ] 3.2 維護 consumer 自家 `PRICING` 表（snippet README 範例），對齊實際使用的 model id
- [ ] 3.3 對 AI endpoint（例：`server/api/chat.post.ts`）改寫：
  - `generateText` / `streamText` 落地後呼叫 `recordAIGeneration(log, result)`
  - tool call 結束呼叫 `recordToolCall(log, toolName, durationMs, success)`
  - moderation 結束呼叫 `recordModeration(log, result)`（flagged 時自動 emit warn）
  - embedding 結束呼叫 `recordEmbedding(log, result)`（cost > $0.001 才 keep）
- [ ] 3.4 dev 觸發 chat endpoint，D1 `SELECT * FROM evlog_events ORDER BY created_at DESC LIMIT 1` 看 `event.ai.cost_usd` / `event.ai.tool_calls` / `event.ai.tokens`

## 4. SSE / MCP child logger

- [ ] 4.1 `cp ~/offline/clade/vendor/snippets/evlog-mcp-sse-child-logger/child-logger.ts server/utils/sse-child-logger.ts`
- [ ] 4.2 對使用 SSE 的 endpoint（例：`server/api/chat.post.ts`）改寫：

  ```ts
  import { forkChildLogger, emitChildLogger } from '~/server/utils/sse-child-logger'

  if (wantsSseResponse(event)) {
    const streamLog = forkChildLogger(event, {
      operation: 'web-chat-sse-stream',
      user: { id: user.id },
    })
    return createSseChatResponse({
      log: streamLog,
      onStreamSettled: ({ error }) => emitChildLogger(event, streamLog, { error }),
    })
  }
  ```

- [ ] 4.3 對 MCP tool session 同樣 fork child；session 結束 emit
- [ ] 4.4 所有 SSE / MCP path 在 `try / catch / finally` 三條都呼叫 `emitChildLogger`，避免 stream error path 漏 emit
- [ ] 4.5 Durable Object alarm callback 內 fork child（與初始 fetch 分離）

## 5. Better Auth identity

- [ ] 5.1 找到 Better Auth 設定（通常 `server/utils/better-auth.ts` 或 `server/api/auth/[...all].ts`）
- [ ] 5.2 在 `createAuthMiddleware` hook 內注入 evlog context：
  ```ts
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.context.session?.user) {
        useLogger(ctx.context.event).set({
          actor: { id: ctx.context.session.user.id },
        })
      }
    })
  }
  ```
- [ ] 5.3 passkey flow 同樣經此 hook，無需獨立 wiring
- [ ] 5.4 client `setIdentity({ userId })` 在 sign-in 成功 callback 內呼叫；`clearIdentity()` 在 sign-out

## 6. Sampling 微調（cost-based via Nitro hook）

> evlog `sampling.keep[]` 是 declarative `{ status, duration, path }` only，不接 callback。AI cost-based filter 走 `evlog:emit:keep` Nitro hook（自定 condition）；audit event 由 evlog 內部自動 forceKeep。

- [ ] 6.1 `nuxt.config.ts` 內 `evlog.sampling`：`{ rates: { error: 100, warn: 100, info: 50, debug: 0 }, keep: [{ status: 400 }, { duration: 1000 }] }`
- [ ] 6.2 建 `server/plugins/evlog-cost-keep.ts` wire cost-based forceKeep：
  ```ts
  export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('evlog:emit:keep', (ctx) => {
      // 高成本 AI event 強制 keep；audit 由 evlog 內部處理
      const aiCost = (ctx.event as { ai?: { cost_usd?: number } }).ai?.cost_usd
      return Boolean(aiCost && aiCost > 0.001)
    })
  })
  ```
- [ ] 6.3 info embedding 量大時可把 `rates.info` 降到 10（仍滿足 logging.md 下限），cost-based hook 會把高成本拉回

## 7. Verify

- [ ] 7.1 D1 `SELECT count(*) FROM evlog_events WHERE created_at > now() - interval '1 hour'` > 0
- [ ] 7.2 `event.ai.cost_usd` / `event.ai.tokens` / `event.ai.tool_calls` 在 chat endpoint event 內均存在
- [ ] 7.3 SSE stream settle 後 child event 進 D1（含 `_parentRequestId`）
- [ ] 7.4 Better Auth sign-in 後 server-side wide event 帶 `event.actor.id`
- [ ] 7.5 region-pinned smoke test：`wrangler dev --region apac` 連續觸發 100 次 chat，無 D1 100 writes/s 錯誤（若有需評估走 batch）
- [ ] 7.6 跑 `node ~/offline/clade/scripts/evlog-adoption-audit.mjs --repo .` 驗 5 check 全綠（drainPipeline 對 NuxtHub drain 應認可）

## 8. Manual review

- [x] #1 D1 binding 在 `nuxt.config.ts` 已 wire，`@evlog/nuxthub` module 自動加 server plugin + cron — `nuxt.config.ts:96-114,119-124` modules + `hub.db: 'sqlite'`；`:343,397-400` retention `'90d'` + scheduledTasks `0 3 * * *`
- [x] #2 `PRICING` 表覆蓋實際使用所有 model id — `server/utils/ai-logger.ts:63-73` 對應 runtime models in `server/utils/workers-ai.ts:54-57`（kimi-k2.5 + llama-4-scout）；AutoRAG 內處理 embedding，無 standalone embedding call
- [x] #3 SSE / MCP `emitChildLogger` 在 try / catch / finally 三條都呼叫 — `server/api/chat.post.ts:280-308` + `server/utils/chat-sse-response.ts:112-184` settled flag idempotent；DO MCP `mcp-event-shim.ts:82-99` 是 documented deferred (no-op logger)
- [x] #4 Better Auth hook 內注入 evlog identity 對 passkey flow 也生效 — `server/middleware/00-evlog-actor.ts:21-45` global path-prefix middleware（passkey/OAuth/email 都涵蓋；H3 event 不可達 better-auth hook 是 0.0.2-alpha.19 限制，已記在 `auth.config.ts:256-263`）
- [x] #5 cost-based sampling threshold 對 consumer 實際流量 reasonable — `server/plugins/evlog-cost-keep.ts:18-25` threshold `0.001` 合理；`recordPrimaryAiGeneration` (`chat.post.ts:436-465`) 目前不寫 `cost_usd`（Workers AI 免費），cost-keep 是 dark-launch 直到 paid-tier 上線。user 已認可此狀態（2026-05-10）

===== openspec/changes/adopt-evlog-nuxthub-ai-t3/design.md =====
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

===== openspec/changes/adopt-evlog-nuxthub-ai-t3/.openspec.yaml =====
schema: spec-driven
template: evlog-adopt-cfworkers-nuxthub-ai
template_version: 1
template_source: ~/offline/clade/openspec/templates/evlog-adopt-cfworkers-nuxthub-ai/
stack: cf-workers + NuxtHub D1 + AI
depth: '1+AI → NuxtHub complete'
target_consumers:
  - nuxt-edge-agentic-rag
target_consumer: nuxt-edge-agentic-rag
estimated_effort: 1 day
created: 2026-05-09
created_by: charles <abcd854884@gmail.com>
created_with: claude

===== openspec/changes/adopt-evlog-nuxthub-ai-t3/specs/evlog-adoption/spec.md =====
# Spec — evlog-adoption (T3 NuxtHub AI)

> 本 spec detection pattern 對齊 evlog@2.16+ 真實 API（見 `docs/evlog-master-plan.md` § 14 校正紀錄）。`createAILogger` **不存在**；AI SDK 走 convention helper（`recordAIGeneration` / `recordToolCall` 等）。

## ADDED Requirements

### Requirement: NuxtHub D1 主 sink

NuxtHub stack consumer MUST 用 `@evlog/nuxthub` Nuxt module 把 wide event 寫進 D1。MUST NOT 自寫 D1 drain（重造 schema migration / retry / retention）。

#### Scenario: @evlog/nuxthub module 已啟用

- **WHEN** review 讀 `nuxt.config.ts` `modules` array
- **THEN** 必含 `'@evlog/nuxthub'`
- **AND** 配 `evlog: { retention: '<duration>' }`（例：`'90d'`）

#### Scenario: 自寫 D1 drain 被擋

- **WHEN** review 跑 `rg -n "createD1Drain\\(|wrangler d1 execute.*evlog_events" server`
- **THEN** 命中即視為反模式，必改回 `@evlog/nuxthub` module

### Requirement: AI SDK 子事件

AI endpoint MUST 在 AI SDK 呼叫後 emit 對應 `ai.*` 子事件：generateText / streamText 落地後 `recordAIGeneration`、tool call 結束 `recordToolCall`、moderation 結束 `recordModeration`、embedding 結束 `recordEmbedding`。

#### Scenario: chat endpoint 缺 recordAIGeneration

- **WHEN** review 跑 `rg -n "generateText\\(|streamText\\(" server/api`
- **THEN** 同檔內必有 `recordAIGeneration\\(` 呼叫
- **AND** result 內必含 `event.ai.cost_usd` / `event.ai.tokens` 欄位

#### Scenario: cost 計算缺 PRICING 表

- **WHEN** consumer 用未在 `PRICING` 表內的 model id
- **THEN** snippet 應 emit warn `ai.unknown_model` 而非 silently 0
- **AND** consumer 必補 `PRICING` 條目才能 merge

### Requirement: SSE / MCP child logger pattern

跨 Nitro `afterResponse` lifecycle 的 endpoint（SSE / MCP / Durable Object）MUST 用 `forkChildLogger` + `emitChildLogger` pattern。**MUST NOT** 在 stream 內 `log.set` 撞 sealed wide event。

#### Scenario: SSE endpoint 用 child logger

- **WHEN** review 讀 `server/api/chat.post.ts` 或同等 SSE endpoint
- **THEN** 必 import `forkChildLogger` + `emitChildLogger`
- **AND** stream settle / error / abort 三條 path 都呼叫 `emitChildLogger`

#### Scenario: parent log.set 在 stream 內

- **WHEN** review 跑 `rg -nA20 "createSseChatResponse|createSseResponse" server/api | rg "log\\.set\\("`
- **THEN** 命中即反模式（撞 sealed wide event），必改用 child logger

### Requirement: Better Auth identity 整合

Better Auth `createAuthMiddleware` hook MUST 注入 evlog identity（含 passkey flow）。**MUST NOT** 在每個 endpoint 手寫 `setIdentity`。

#### Scenario: createAuthMiddleware hook 注入 actor

- **WHEN** review 讀 Better Auth 設定（`server/utils/better-auth.ts` / `server/api/auth/[...all].ts`）
- **THEN** `hooks.after` 必有 `createAuthMiddleware` callback 內呼叫 `useLogger(ctx.context.event).set({ actor: { id: ... } })`

### Requirement: cost-based forceKeep（透過 Nitro hook）

evlog `sampling.keep[]` 只支援 declarative `{ status, duration, path }` 條件，**不**支援 cost / event-shape callback。AI agent consumer 要對 high-cost event 強制 keep，MUST 用 `evlog:emit:keep` Nitro hook attach custom condition。

#### Scenario: cost-based keep hook

- **WHEN** consumer 採用 T3 + AI SDK
- **THEN** 必有 `server/plugins/evlog-cost-keep.ts`（或同等檔）內 wire `nitroApp.hooks.hook('evlog:emit:keep', ctx => ctx.event.ai?.cost_usd > 0.001)`
- **AND** audit event 由 evlog 內部 `auditOnly` / `signed` chain 自動 forceKeep，不需在此 hook 重複配

#### Scenario: 誤用 keep[] callback shape 被擋

- **WHEN** review 讀 `nuxt.config.ts` 內 `evlog.sampling.keep`
- **THEN** array element 必為 `{ status?, duration?, path? }` declarative shape
- **AND** **MUST NOT** 出現 `{ when: callback }` / `forceKeep: callback` 等 legacy matcher 寫法（不存在於真實 API，會 type fail）

> Generated by ai-control-plane/tasks-v1. Do not edit; rebuild from canonical facts.

## Current intent

- Profile: `opsx-v2`
- Change: `chg_01M1RAG01CNT00000000000000`
- Intent revision: r1

| Requirement | Revision | Text digest |
| --- | --- | --- |
| `req_rag01legacy` | r1 | `sha256:3749a2ea4361c27804bba948adb0032eb72a23386100ae374a06b5f2b7bde499` |

## Impact matrix

| Impact | Requirement | Target | Consistency | Rationale |
| --- | --- | --- | --- | --- |
| `imp_rag01legacy` | `req_rag01legacy` r1 | work_spec:`wsp_rag01verification` | unknown | Legacy source and reconciliation context are preserved verbatim in native OPSX; implementation and prior manual acceptance are carried forward while all unverified sections remain queued for current evidence revalidation. |

## Work DAG

| Work spec | Label | Depends on | Work | State | Blocking gates | Latest valid evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `wsp_rag01preflight` | Revalidate evlog adoption pre-flight dependencies | — | `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-evlog-adoption-pre-flight` | ready | — | `none` |
| `wsp_rag01d1drain` | Revalidate NuxtHub D1 drain and retention | — | `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-nuxthub-d1-drain-and-retention` | ready | — | `none` |
| `wsp_rag01enrichers` | Revalidate the Workers AI enricher stack | — | `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-workers-ai-enricher-stack` | ready | — | `none` |
| `wsp_rag01aisdk` | Revalidate AI SDK event conventions | — | `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-ai-sdk-event-conventions` | ready | — | `none` |
| `wsp_rag01ssechild` | Revalidate SSE and MCP child logger lifecycle | — | `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-sse-and-mcp-child-logger-lifecycle` | ready | — | `none` |
| `wsp_rag01authidentity` | Revalidate Better Auth identity propagation | — | `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-better-auth-identity-propagation` | ready | — | `none` |
| `wsp_rag01sampling` | Revalidate cost-based sampling policy | — | `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-cost-based-sampling-policy` | ready | — | `none` |
| `wsp_rag01verification` | Revalidate end-to-end evlog adoption evidence | `wsp_rag01sampling` | `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-end-to-end-evlog-adoption-evidence` | ready | — | `none` |

## Attempts

- None

## Evidence timeline

- None

## Verification feature map

| Feature | Map | Entry point | Subject revision | Digest | Receipt |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |

## Human gates

| Gate | Family | State | Judgment | Response |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |

## Human attention

No actionable human judgment.

## Archive readiness

Ready: **no**

| Predicate | Result |
| --- | --- |
| current_intent_valid | pass |
| impacts_current_and_consistent | block |
| required_work_terminal_with_current_evidence | block |
| required_gates_terminal | pass |
| no_active_attempt_or_lease | pass |
| projection_cursors_current | pass |
| single_writer | pass |
| no_stale_evidence | pass |

## 9. 人工檢查

- [ ] #1 Revalidate evlog adoption pre-flight dependencies (policy `legacy-revalidation-v1`, spec `wsp_rag01preflight`, work `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-evlog-adoption-pre-flight`, state `ready`, evidence `none`)
- [ ] #2 Revalidate NuxtHub D1 drain and retention (policy `legacy-revalidation-v1`, spec `wsp_rag01d1drain`, work `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-nuxthub-d1-drain-and-retention`, state `ready`, evidence `none`)
- [ ] #3 Revalidate the Workers AI enricher stack (policy `legacy-revalidation-v1`, spec `wsp_rag01enrichers`, work `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-workers-ai-enricher-stack`, state `ready`, evidence `none`)
- [ ] #4 Revalidate AI SDK event conventions (policy `legacy-revalidation-v1`, spec `wsp_rag01aisdk`, work `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-ai-sdk-event-conventions`, state `ready`, evidence `none`)
- [ ] #5 Revalidate SSE and MCP child logger lifecycle (policy `legacy-revalidation-v1`, spec `wsp_rag01ssechild`, work `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-sse-and-mcp-child-logger-lifecycle`, state `ready`, evidence `none`)
- [ ] #6 Revalidate Better Auth identity propagation (policy `legacy-revalidation-v1`, spec `wsp_rag01authidentity`, work `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-better-auth-identity-propagation`, state `ready`, evidence `none`)
- [ ] #7 Revalidate cost-based sampling policy (policy `legacy-revalidation-v1`, spec `wsp_rag01sampling`, work `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-cost-based-sampling-policy`, state `ready`, evidence `none`)
- [ ] #8 Revalidate end-to-end evlog adoption evidence (policy `evidence-revalidation-v1`, spec `wsp_rag01verification`, work `W-2026-09-06-nuxt-edge-agentic-rag-revalidate-end-to-end-evlog-adoption-evidence`, state `ready`, evidence `none`)
