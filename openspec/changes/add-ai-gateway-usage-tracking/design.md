# 設計：AI Gateway 路由 + Admin 用量儀表板

## Context

**現況**：

- `server/utils/ai-search.ts` 直接呼叫 `env.AI.autorag(indexName).search(...)`
- `server/api/chat.post.ts` 透過 `ai-search.ts` 取 evidence；目前的 fallback answer 不呼叫 LLM，但未來 `models.defaultAnswer` 落地後會呼叫
- `server/api/mcp/ask.post.ts`、`server/api/mcp/search.post.ts` 同樣走 `env.AI`
- 沒有 token / Neurons 用量追蹤；只能去 Cloudflare Dashboard 手動看
- Admin 區（`app/pages/admin/`）已有 documents 管理頁與 layout 入口

**約束**：

- Workers AI 免費 plan：每日 10,000 Neurons；超過會自動扣費
- AI Gateway 免費 plan：每月 100,000 logs（每次 AI 呼叫一筆 log）
- Cloudflare Analytics API 需要 read scope token，與部署用 token 必須分開（最小權限）
- 部署目標 Workers / NuxtHub，handler 仍受 30s CPU、128MB 限制
- Admin authority 真相來源是 runtime `ADMIN_EMAIL_ALLOWLIST`，每次 request 重檢
- 既有 `evlog` 已記錄 request-level event；不重蓋它，gateway 是補充而非取代

**Stakeholders**：

- Web Admin（charles）：唯一受眾，需要看用量決定是否擴增使用
- Web User / MCP Client：透明改變，不感知 gateway 存在

## Goals / Non-Goals

**Goals**：

- 所有 Workers AI 呼叫經過 AI Gateway，產生可查 log
- Admin 在 `/admin/usage` 看到：當日 + 當月 token / Neurons 消耗、剩餘額度進度條、cache hit rate、近 24h 折線
- 切換時不影響既有 chat / MCP 行為（透明 proxy）
- 每個環境（preview / staging / production）獨立 gateway instance，避免用量混雜

**Non-Goals**：

- per-user / per-conversation 用量歸因（v1 用量小，不需要）
- 撞額度時自動降載 / fallback model 切換（留 v1.1）
- Cache 設定調校（先用 default，後續驗證後再 tune）
- 歷史回填（gateway 啟用前的呼叫沒有 log）
- 修改 `env.AI` 以外的呼叫（不影響 R2 / D1 / KV）

## Decisions

### Gateway 啟用方式：透過 `gateway` 參數注入，而非改用 fetch

**選擇**：在 `env.AI.autorag(indexName, { gateway: { id, skipCache?, cacheTtl? } })` 等呼叫點傳入 gateway 設定。

**為什麼**：

- Cloudflare Workers AI binding 原生支援 `gateway` 參數，會自動把呼叫導向 gateway 路由
- 不需要改成手動 `fetch('https://gateway.ai.cloudflare.com/...')`，降低 retry / auth 維護成本
- 保留 `env.AI` binding 既有的型別、錯誤處理、SDK 整合

**替代方案**：

- 全部改 fetch gateway URL：需要自己管 API key、retry、timeout、type → 工作量大、易出錯
- 用 Vercel AI SDK provider 包一層：多一層依賴，且 `env.AI.autorag()` 沒有對應 SDK provider

### Gateway ID 來源：runtime config

**選擇**：在 `shared/schemas/knowledge-runtime.ts` 加 `aiGateway: { id: string; cacheEnabled: boolean }`，由 `NUXT_KNOWLEDGE_AI_GATEWAY_ID` env 注入。

**為什麼**：

- 與既有 `aiSearchIndex`、`adminEmailAllowlist` 模式一致
- 環境隔離天然成立：preview / staging / production 各自設不同 gateway id
- Cache 開關獨立可控（cache 對 chat 是 want，對 admin operations 可能要 skip）

**替代方案**：

- 寫死在 wrangler.jsonc vars：environment 切換時要改檔重 deploy，比 env 麻煩
- Hardcode 在程式碼：違反「sensitive bindings 必須 runtime config」規則

### Analytics API：分離 read-only token

**選擇**：在 Cloudflare Dashboard 建一個專門的 API token，scope 只給 `Account → Analytics → Read`。secret 名 `CLOUDFLARE_API_TOKEN_ANALYTICS`。

**為什麼**：

- 部署用的 token 是寫權限太大；用 read-only 走最小權限
- secret 而非 vars：token 屬敏感資訊
- 只有 `/api/admin/usage` 用這個 token；blast radius 限縮

**替代方案**：

- 共用部署 token：洩漏即可寫整個 account，不可接受
- 不呼叫 Analytics API 改用 D1 自己存：自己埋點代價遠高於官方 API

### Admin endpoint design：聚合 server-side，UI 只顯示

**選擇**：`/api/admin/usage` 接受 `range=today|7d|30d`，server 呼叫 Analytics API、聚合、回 `{ data: { tokens, neurons, requests, cacheHitRate, freeQuotaRemaining, timeline } }`。

**為什麼**：

- Analytics API token 不可暴露到 client
- 聚合計算（剩餘額度 = 10000 - todayNeurons）放 server，UI 純顯示
- 統一 response shape 配合 Pinia Colada `useQuery`

**替代方案**：

- Client 直接呼叫 Analytics API：token 會洩漏
- 把整段 raw timeline 丟回 client 算：浪費頻寬

### UI 刷新策略：60s polling，不 SSE

**選擇**：Pinia Colada `useQuery({ refetchInterval: 60_000 })`。手動 refresh 按鈕呼叫 `refetch()`。

**為什麼**：

- Analytics API 本身有延遲（~1-2 分鐘），SSE 沒有比較快
- 60s polling 對 100k logs/月免費額度影響可忽略（每月 admin 開頁面預估 < 100 次）
- 簡化設計，不用 maintain WebSocket / SSE 連線

**替代方案**：

- WebSocket / SSE：Workers 不原生支援 long-lived connection，要 Durable Objects，過度工程
- 不 polling 純手動 refresh：使用者體驗差

### Cache 預設：開啟，但 admin 操作 skip

**選擇**：chat / MCP 走 cache（同 query 短時間內回 cache），admin 操作（document re-index 等）傳 `skipCache: true`。

**為什麼**：

- chat / MCP 的 query 重複率高，cache 直接省 Neurons
- admin 操作要看到最新狀態，cache 會誤導

**替代方案**：

- 全程 skipCache：浪費官方提供的優化
- 全程 cache：admin 看到 stale 結果

## Risks / Trade-offs

- **[Risk] AI Gateway 故障 / latency 增加** → Mitigation：`env.AI` binding 在 gateway 配置存在時自動走 gateway，gateway 故障時 Cloudflare 會回 5xx，handler 既有 try/catch 直接 surface 給使用者。**不**做自動 fallback bypass gateway——避免 silent 跳過 log 導致用量歸零誤判
- **[Risk] Analytics API 延遲（1-2 分鐘）導致 UI 數字不即時** → Mitigation：UI 顯示「最後更新：N 分鐘前」，明示資料來源延遲。手動 refresh 按鈕讓 admin 主動拉最新
- **[Risk] 100k logs/月免費額度被 burst 用爆** → Mitigation：UI 同時顯示 logs 用量百分比；超過 80% 時顯示警告。撞額度後 gateway 不再 log（呼叫仍會送，只是少了觀察性），不影響服務
- **[Risk] gateway id 命名衝突 / 漂移** → Mitigation：命名規範 `agentic-rag-{environment}`（preview / staging / production），與既有 D1/R2 命名一致
- **[Trade-off] cache 機制可能讓 chat 回答不一致**（同 query 在 cache TTL 內回同樣答案）→ 接受，因為知識庫本身就應該對同一問題回同樣答案。要新答案就改 prompt 措辭
- **[Trade-off] 多一層 gateway = 多一個故障點** → 接受，因為 Cloudflare gateway SLA 與 Workers AI 同等級，相依性風險可接受

## Migration Plan

1. **Cloudflare Dashboard 建 gateway**（手動）：`agentic-rag-production`
2. **建 Analytics API token**（手動）：scope `Account → Analytics → Read`
3. **wrangler.jsonc 加 vars**：`NUXT_KNOWLEDGE_AI_GATEWAY_ID="agentic-rag-production"`
4. **wrangler secret put**：`CLOUDFLARE_API_TOKEN_ANALYTICS`、`CLOUDFLARE_ACCOUNT_ID`
5. **改 schema**：`shared/schemas/knowledge-runtime.ts` 加 `aiGateway` 欄位
6. **改呼叫點**：`server/utils/ai-search.ts` 與 chat / mcp endpoints 注入 `gateway` 參數
7. **新增 endpoint + UI**：`/api/admin/usage`、`/admin/usage` 頁面、admin nav 入口
8. **驗證**：跑 chat → 檢查 gateway dashboard 有 log → 檢查 `/admin/usage` 數字 = dashboard 數字
9. **Rollback**：移除 wrangler.jsonc 的 `NUXT_KNOWLEDGE_AI_GATEWAY_ID`，重 deploy；呼叫點 `gateway` 參數會收到 undefined，binding 退回直連模式（程式碼需保證 `gateway` 是 optional）

## Open Questions

- Workers AI binding 是否完整支援 `gateway` 參數對 `autorag()` 子方法（待測試確認）；若不支援，autorag 部分需用 fetch 走 gateway HTTP API
- Cache TTL 預設值（gateway dashboard 設定）對 chat 場景是否合適，或要程式碼指定 `cacheTtl`
- `/admin/usage` 是否要顯示 per-endpoint breakdown（chat vs mcp），還是只看 account 總和——v1 先看總和，v1.1 視需求加
