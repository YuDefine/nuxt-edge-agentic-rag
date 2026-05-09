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
