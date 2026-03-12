# 整合 Cloudflare AI Gateway 並建立 Token 使用量儀表板

## Why

目前所有 AI 呼叫（`/api/chat`、`/api/mcp/ask`、`/api/mcp/search`、`/api/admin/uploads/*` 等知識庫 pipeline 內的 embedding / generation 呼叫）直接走 `env.AI` binding。沒有：

- Token 用量追蹤（embedding tokens、LLM tokens、Neurons 消耗）
- 免費額度剩餘量視覺化（Workers AI 每日 10,000 Neurons 上限）
- 重複請求快取（同 query 重算 embedding 浪費 Neurons）
- 成本歸因（哪個 endpoint / channel / user 用得多）

對 v1.0.0 demo 階段風險可控，但驗收後想擴大使用、或把 system 移交給其他人營運時，**沒有用量數字無法評估擴張安全性、無法在快撞額度時主動降載、也無法做容量規劃**。Cloudflare AI Gateway 是官方解法，免費 100k logs/月，整合成本低於自己做埋點。

## What Changes

- 新增 Cloudflare AI Gateway instance（`agentic-rag-gateway`），所有 Workers AI 呼叫經此 gateway 路由
- 重構 `server/utils/ai-search.ts` 與相關 AI 呼叫點，在初始化 binding 時注入 gateway 設定（透過 `gateway: { id, skipCache, ... }` 參數）
- 新增 server endpoint `/api/admin/usage` 呼叫 Cloudflare Analytics API 拉取 gateway 用量（tokens / requests / cache hits / cost）
- 新增 admin 頁面 `/admin/usage` 顯示：當日 / 當月 token 用量、Neurons 剩餘額度、cache hit rate、近 24h 折線圖
- Admin 導覽新增「用量」入口
- `wrangler.jsonc` 加 `ai_gateway` binding（若 NuxtHub / Workers 支援；否則用 fetch 直接走 gateway URL）
- `.env.example` 加 `CLOUDFLARE_API_TOKEN_ANALYTICS`（讀 Analytics API 的 read-only token，與部署 token 分開）

## Non-Goals

- **不**做 per-user / per-conversation 用量歸因（v1 階段使用者 < 5 人，account-level 數字夠用）
- **不**做 alert / 自動降載（撞額度時 fallback 行為交給 v1.1 處理）
- **不**改既有 AI 呼叫的 prompt / model 選擇（純粹包一層 gateway）
- **不**做歷史用量回填（gateway 啟用前的呼叫沒有 log，承認 gap）
- **不**改 MCP token 額度機制（MCP 仍用既有 rate limit KV，gateway 是 observability 不是 enforcement）

## Capabilities

### New Capabilities

- `ai-gateway-routing`：將 Workers AI 呼叫統一路由到 Cloudflare AI Gateway，提供快取、log、cost 追蹤的 server-side 基礎設施
- `admin-usage-dashboard`：admin 介面顯示 token 消耗量、免費額度進度、cache hit rate 等用量指標

### Modified Capabilities

無。本次新增的是基礎設施層（gateway routing）與獨立的新 surface（usage dashboard），既有 capabilities 的 spec-level requirements 不變。

## Impact

- **Affected specs**：`ai-gateway-routing`（新）、`admin-usage-dashboard`（新）
- **Affected code**：
  - `server/utils/ai-search.ts`（注入 gateway 設定）
  - `server/api/chat.post.ts`、`server/api/mcp/ask.post.ts`、`server/api/mcp/search.post.ts`（呼叫點適配）
  - `server/api/admin/usage.get.ts`（新）
  - `app/pages/admin/usage.vue`（新）
  - `app/components/admin/UsageOverview.vue`（新）
  - `app/layouts/desktop.vue`（admin nav 入口）
  - `wrangler.jsonc`（gateway binding / vars）
  - `.env.example`（新環境變數）
  - `shared/schemas/knowledge-runtime.ts`（gateway config schema）
- **Affected runtime bindings**：新增 AI Gateway routing；新增 Analytics API token secret
- **Affected milestones**：屬於 M5（admin 管理介面強化）的延伸，不擋 M1-M4 核心閉環
- **Truth-source 影響**：無——D1 / R2 / AI Search 真相來源不變，gateway 純粹是 AI 呼叫的 transparent proxy
- **環境隔離**：preview / staging / production 各自獨立 gateway instance（與既有 D1/R2/KV 隔離原則一致）
