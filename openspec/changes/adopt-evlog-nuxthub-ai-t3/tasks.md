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
- [ ] #5 cost-based sampling threshold 對 consumer 實際流量 reasonable — **NEEDS_USER**: `server/plugins/evlog-cost-keep.ts:18-25` threshold `0.001` 合理；但 `recordPrimaryAiGeneration` (`chat.post.ts:436-465`) 目前不寫 `cost_usd`（Workers AI 免費），cost-keep 是 dark-launch 直到 paid-tier 上線。user 認可此狀態即可勾
