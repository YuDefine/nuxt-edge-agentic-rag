## Affected Entity Matrix

### Entity: AI Gateway runtime config（新邏輯實體，非 DB entity）

| Dimension       | Values                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| Columns touched | `runtimeConfig.knowledge.aiGateway.id`、`.cacheEnabled`（新增 schema）      |
| Roles           | server-side only（無 user-facing 寫入）                                     |
| Actions         | 注入 gateway 參數到 `env.AI` 呼叫                                           |
| States          | configured / unconfigured（fallback 直連）                                  |
| Surfaces        | `server/utils/ai-search.ts`、`/api/chat`、`/api/mcp/ask`、`/api/mcp/search` |

### Entity: Usage analytics（無 D1 entity，純 Cloudflare Analytics API 讀取聚合）

| Dimension       | Values                                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| Columns touched | 無（純 read 上游 API）                                                         |
| Roles           | admin only                                                                     |
| Actions         | read（aggregate）                                                              |
| States          | loading、success、empty、error、unauthorized                                   |
| Surfaces        | `/api/admin/usage`（new endpoint）、`/admin/usage`（new page）、admin nav 入口 |

## User Journeys

### Admin 查看當日 token 用量

- **Admin** 在 admin 區點擊側邊「Usage」入口 → 進入 `/admin/usage` → 看到當日 Neurons 用量、剩餘額度進度條、cache hit rate、近 24h 折線
- 預設刷新區間：每 60 秒自動 refetch；可手動點 Refresh 按鈕立即重抓
- 顯示「Last updated: N seconds ago」讓 admin 知道資料新鮮度

### Admin 切換時間範圍

- **Admin** 在 `/admin/usage` 頁面點擊範圍切換器（today / 7d / 30d）→ 系統重新呼叫 `/api/admin/usage?range=...` → UI 換成新範圍資料
- 若該範圍內無任何呼叫 → 顯示 empty state 並提示切換更長範圍

### Admin 撞到免費額度警告

- 當日 Neurons 消耗達 80% → 進度條顯示警告色 + 文字提示
- 達 100% → 顯示「quota exhausted」狀態，剩餘額度顯示 `0`

### Non-admin 嘗試直連被擋

- **Non-admin** 直接 navigate 到 `/admin/usage` → server-side 認證檢查回 403 → 頁面顯示 unauthorized state，不洩漏任何用量數字

### Web User / MCP Client 透明感受不到 gateway

- **User** 在 `/chat` 問問題 → server 端 chat handler 把 AI 呼叫包裝 `gateway: { id }` 參數送出 → User 體感無變化
- gateway dashboard 後台同時看到該次呼叫的 token 計數

## 1. Schema 與 Runtime Config

- [x] 1.1 在 `shared/schemas/knowledge-runtime.ts` 加 `aiGateway: { id: string; cacheEnabled: boolean }` Zod schema 與 default 值（id 預設空字串、cacheEnabled 預設 true）。對應 spec **Gateway Identifier Comes From Runtime Configuration**；對應 design 章節 **Gateway ID 來源：runtime config**
      2026-04-20 PASS：新增 `KnowledgeAiGatewayConfig` interface、`aiGateway` 進 Zod schema、`parseBooleanWithDefault` helper；`createKnowledgeRuntimeConfig` 生成 `{ id: '', cacheEnabled: true }` 預設。
- [x] 1.2 [P] 更新 `nuxt.config.ts` 中的 `createKnowledgeRuntimeConfig` 呼叫，新增從 `process.env.NUXT_KNOWLEDGE_AI_GATEWAY_ID` 讀取 + `process.env.NUXT_KNOWLEDGE_AI_GATEWAY_CACHE_ENABLED`
      2026-04-20 PASS：nuxt.config.ts 的 `createKnowledgeRuntimeConfig({...})` 加 `aiGateway: { id, cacheEnabled }`。
- [x] 1.3 [P] 更新 `.env.example` 增加 `NUXT_KNOWLEDGE_AI_GATEWAY_ID=`、`NUXT_KNOWLEDGE_AI_GATEWAY_CACHE_ENABLED=true`、`CLOUDFLARE_API_TOKEN_ANALYTICS=`、`CLOUDFLARE_ACCOUNT_ID=`
      2026-04-20 PASS：.env.example 加「--- AI Gateway ---」區塊，四個變數全到位。
- [x] 1.4 在 `wrangler.jsonc` 的 `vars` 區塊加 `NUXT_KNOWLEDGE_AI_GATEWAY_ID`（值待 1.6 建好 gateway 後補）；secrets 透過 `wrangler secret put` 設定 `CLOUDFLARE_API_TOKEN_ANALYTICS`、`CLOUDFLARE_ACCOUNT_ID`
      2026-04-20 PASS：wrangler.jsonc 加 `NUXT_KNOWLEDGE_AI_GATEWAY_ID=""`、`NUXT_KNOWLEDGE_AI_GATEWAY_CACHE_ENABLED="true"`；secrets 待 1.6 完成後由使用者 `wrangler secret put`。
- [x] 1.5 為 `aiGateway` schema 寫單元測試 `test/unit/knowledge-runtime-config.test.ts`：驗證 default、env 注入、edge case（空字串）
      2026-04-20 PASS：新增 `describe('knowledge runtime aiGateway')` 6 個 case（default / 顯式 boolean / string "true"/"false" / unknown string / 空 id），全數通過（1+6=7 tests）。
- [ ] 1.6 在 Cloudflare Dashboard 手動建立 AI Gateway instance `agentic-rag-production`（依 design **Gateway 啟用方式** 章節）
      2026-04-20 BLOCKED：外部依賴（Cloudflare Dashboard 手動操作 + `wrangler secret put CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN_ANALYTICS`）。

## 2. AI Gateway 路由實作

- [x] 2.1 在 `server/utils/ai-search.ts` 的 `createCloudflareAiSearchClient` 新增 `gatewayConfig?: { id: string; skipCache?: boolean }` 參數，若有則傳給 `aiBinding.autorag(indexName, { gateway })`。對應 spec **AI Gateway Routing For All Workers AI Calls**；對應 design 章節 **Gateway 啟用方式：透過 `gateway` 參數注入，而非改用 fetch**
      2026-04-20 PASS：新增 `CloudflareAiGatewayOptions` / `CloudflareAiAutoragOptions` / `AiGatewayRuntimeConfig` types；`autorag()` 簽章加 optional `options`；`buildAutoragOptions` helper 在 `id` 為空時 return undefined（fallback）。
- [x] 2.2 修改 `server/api/chat.post.ts` 第 39-42 行的 `createCloudflareAiSearchClient` 呼叫，注入 `gatewayConfig` from `runtimeConfig.aiGateway`
      2026-04-20 PASS：chat.post.ts:101 `createCloudflareAiSearchClient({...gatewayConfig: runtimeConfig.aiGateway})`。
- [x] 2.3 [P] 修改 MCP ask tool 同步注入 gatewayConfig（依 spec scenario **MCP search endpoint routes through gateway** 同類處理）
      2026-04-20 PASS：原 tasks.md 寫 `server/api/mcp/ask.post.ts`，經 2026-04-19 `migrate-mcp-to-toolkit` 遷移後實際路徑是 `server/mcp/tools/ask.ts`。已於 line 38 注入 `gatewayConfig: runtimeConfig.aiGateway`。
- [x] 2.4 [P] 修改 MCP search tool 同步注入 gatewayConfig
      2026-04-20 PASS：同上，實際路徑 `server/mcp/tools/search.ts` line 59 注入 `gatewayConfig: runtimeConfig.aiGateway`。
- [x] 2.5 為 ai-search.ts 加單元測試：mock binding 並驗證有設定時呼叫帶 gateway 參數、未設定時不帶。對應 spec **Missing gateway id falls back to direct binding** scenario
      2026-04-20 PASS：新增 `test/unit/ai-search.test.ts` 7 個 case（gateway on/off、cacheEnabled 開關、skipCache override、空 id fallback、undefined config fallback、5xx surface、KnowledgeSearchCandidate projection），全數通過。
- [x] 2.6 為 chat-route.test.ts 加 integration test：runtime config 有 gateway id 時，chat 呼叫 mock binding 收到 `gateway: { id }` 參數
      2026-04-20 PASS：chat-route.test.ts 加 2 個 case（aiGateway 顯式設定時 createCloudflareAiSearchClient 收到 gatewayConfig / 未設定時 fallback 空 id）。
- [x] 2.7 確認 admin 寫入路徑（document re-index、知識庫 sync）若有 AI 呼叫，傳入 `skipCache: true`。對應 spec **Cache Skipping For Admin Operations** 與 design 章節 **Cache 預設：開啟，但 admin 操作 skip**
      2026-04-20 N/A：`grep env.AI / aiBinding / \.autorag(` 僅找到 `chat.post.ts` + `mcp/tools/ask.ts` + `mcp/tools/search.ts` 三個 read 路徑；admin 無直接 AI binding 呼叫（document re-index 走 AutoRAG HTTP API 不經 `env.AI` binding）。`skipCache` 參數仍保留在 `createCloudflareAiSearchClient` 介面中，日後若 admin 直連 AI 再傳 true。
- [x] 2.8 確認 chat / MCP read 路徑**不**傳 `skipCache`（依賴 cache 節省 Neurons）
      2026-04-20 PASS：三個呼叫點均未傳 `skipCache` override，由 `buildAutoragOptions` 依 `cacheEnabled`（預設 true）決定 `skipCache=false`。
- [x] 2.9 驗證 gateway 5xx 不被 silent retry；既有 try/catch 直接 surface。對應 spec **Gateway Routing Failures Surface To Caller**
      2026-04-20 PASS：ai-search.test.ts 的 "surfaces binding errors (gateway 5xx) without swallowing" case 驗證 Error 直接 propagate，無隱式 retry。

## 3. Admin Usage Endpoint

- [x] 3.1 新增 `server/api/admin/usage.get.ts` handler：使用 `requireAdmin()` 守門、Zod 驗證 `range=today|7d|30d`、`useLogger(event)` 第一行、`log.set({ user, operation })`。對應 spec **Admin Usage Endpoint Aggregates Server-Side**；對應 design 章節 **Admin endpoint design：聚合 server-side，UI 只顯示** 與 **Analytics API：分離 read-only token**
      2026-04-20 PASS：handler 走 `requireRuntimeAdminSession`（既有 admin 守門 util）+ Zod `usageQuerySchema` + `useLogger(event)` 首行。default range='today'。
- [x] 3.2 在 endpoint 內呼叫 Cloudflare Analytics API（`https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai-gateway/gateways/{GATEWAY_ID}/logs`），帶 `Authorization: Bearer <CLOUDFLARE_API_TOKEN_ANALYTICS>` header
      2026-04-20 PASS：`server/utils/usage-analytics.ts` → `fetchAnalyticsLogs`；Account id 與 token 從 `useRuntimeConfig(event).cloudflare` 注入，nuxt.config.ts 新增 `cloudflare.accountId/analyticsApiToken` 區塊對映環境變數。
- [x] 3.3 server 端聚合：累加 input/output tokens、計算 cacheHitRate = cached / total、計算 freeQuotaRemaining = 10000 - todayNeurons、組 timeline buckets
      2026-04-20 PASS：`aggregateUsage` + `buildTimeline`；today→hourly 24 buckets、7d/30d→daily；Neurons 首選 per-log `neurons`，缺值時 fallback 至 totalTokens；remaining clamp 0。
- [x] 3.4 統一 response shape `{ data: { tokens, neurons, requests, timeline, lastUpdatedAt } }`；錯誤一律走 `createError({ statusCode, statusMessage, message })`，不洩漏 raw upstream body
      2026-04-20 PASS：shared/types/usage.ts 定義 `UsageResponse`；integration test "does not leak upstream error body in 503 response" 驗證 secret 不外洩。
- [x] 3.5 上游錯誤處理：Analytics API 5xx → 回 503「服務暫時無法使用，請稍後再試」+ `log.error`。對應 spec scenario **Upstream Analytics API failure**
      2026-04-20 PASS：handler `try/catch` → `log.error` + 503 泛用訊息；integration test "maps upstream 5xx to 503 with generic message" 驗證。
- [x] 3.6 [P] 新增 `shared/types/usage.ts` 定義 response TypeScript types（`UsageResponse`、`UsageRange`），共用給 server / client
      2026-04-20 PASS：`USAGE_RANGE_VALUES` const array + `UsageRange` / `UsageTokens` / `UsageNeurons` / `UsageRequests` / `UsageTimelineBucket` / `UsageSnapshot` / `UsageResponse` interfaces + `WORKERS_AI_FREE_QUOTA_PER_DAY=10_000` 常數。
- [x] 3.7 [P] 寫 integration test `test/integration/admin-usage-route.test.ts`：mock Analytics API、驗證 admin 200、non-admin 403、未認證 redirect、invalid range 400、上游錯誤 503
      2026-04-20 PASS：9 個 case：401 unauth / 403 non-admin / invalid range / gateway 未設定 503 / token 缺少 503 / 成功 aggregate / 上游錯誤不外洩 / 5xx→503 / neurons fallback，全數通過。

## 4. Admin Usage UI

- [ ] 4.1 新增 `app/pages/admin/usage.vue` 頁面，使用 `definePageMeta({ middleware: 'admin' })`（既有 admin middleware）。對應 spec **Admin Usage Dashboard Page**
- [ ] 4.2 用 Pinia Colada `useQuery({ key: ['admin','usage', range], query: () => $fetch('/api/admin/usage?range='+range), refetchInterval: 60_000, staleTime: 30_000 })`。對應 spec **Dashboard Auto Refresh And Manual Refetch**；對應 design 章節 **UI 刷新策略：60s polling，不 SSE**
- [ ] 4.3 [P] 新增 `app/components/admin/UsageOverviewCards.vue`：顯示 4 張 metric card（today tokens、today neurons、cacheHitRate、requests）。各 card 顯式寫 Nuxt UI props（`color`、`variant`、`size`）
- [ ] 4.4 [P] 新增 `app/components/admin/UsageQuotaProgress.vue`：實作 free-quota 進度條，根據 percent 切色（< 80% default、80-99% warning、100% error）。對應 spec **Dashboard Free-Quota Visualization**
- [ ] 4.5 [P] 新增 `app/components/admin/UsageTimelineChart.vue`：用 `nuxt-charts` 畫近 24h tokens 折線
- [ ] 4.6 [P] 新增 `app/components/admin/UsageRangeSwitcher.vue`：UTabs / USelectMenu 切換 today/7d/30d，emit 給父頁面
- [ ] 4.7 處理 4 種 state（loading / success / empty / error）。loading 用 `<USkeleton>`；error 顯示 retry 按鈕呼叫 `refetch()`；empty 顯示文案 + 範圍切換建議。對應 spec **Dashboard Empty And Error States**
- [ ] 4.8 顯示「Last updated: N seconds ago」相對時間（用 VueUse `useTimeAgo` 或自寫 computed）
- [ ] 4.9 列舉處理 enum 必須用 `switch + assertNever`（state 種類、range 種類），**禁止** if/else if 鏈
- [ ] 4.10 在 `app/layouts/desktop.vue` 的 admin 導覽區塊新增「Usage」連結，icon 用 `i-lucide-bar-chart-3`，順序排在 Documents 之後

## 5. Design Review

- [ ] 5.1 檢查 `.impeccable.md` 是否存在，若無則執行 /impeccable teach
- [ ] 5.2 執行 /design improve `app/pages/admin/usage.vue` `app/components/admin/Usage*.vue`（含 Design Fidelity Report）
- [ ] 5.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [ ] 5.4 依 /design 計劃按 canonical order 執行 targeted skills（預期會用到 /layout、/typeset、/colorize、/harden）
- [ ] 5.5 執行 /audit `app/pages/admin/usage.vue` — 確認 Critical = 0
- [ ] 5.6 執行 review-screenshot — 視覺 QA（loading / success / empty / error / 80% warning / 100% exhausted 各狀態）
- [ ] 5.7 Fidelity 確認 — design-review.md 中無 DRIFT 項

## 人工檢查

- [ ] H.1 在 admin 帳號下開 `/admin/usage`，畫面正確顯示 4 張 metric card 與進度條
- [ ] H.2 觸發幾次 chat 後（30 秒內），手動點 Refresh，看數字有更新
- [ ] H.3 等 60 秒不操作，自動 refetch，看 last updated 時間重置
- [ ] H.4 切換 range 從 today → 7d → 30d，曲線與數字正確刷新
- [ ] H.5 用 non-admin 帳號（一般 Google 登入但不在 allowlist）navigate 到 `/admin/usage`，看到 unauthorized state，不洩漏任何數字
- [ ] H.6 未登入直接訪問 `/admin/usage`，跳到登入頁
- [ ] H.7 Cloudflare Dashboard → AI Gateway → `agentic-rag-production` 看到 chat / MCP 呼叫 log，token / cache hit 數字與 `/admin/usage` 對得起來
- [ ] H.8 暫時刪除 `NUXT_KNOWLEDGE_AI_GATEWAY_ID` 重 deploy，確認 chat 仍可用（fallback 直連 Workers AI）
- [ ] H.9 刻意輸入 `/api/admin/usage?range=foo` 拿 400 + Zod 錯誤訊息
