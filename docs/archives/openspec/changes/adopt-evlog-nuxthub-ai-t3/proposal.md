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
