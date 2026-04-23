# Handoff

## In Progress

### 待接手：`auth-redirect-refactor`（使用者立刻另外做）

**狀態**：尚未 propose，使用者已宣告要另開 change 處理。從現行 repo 觀察到的 3 個關聯問題：

1. **`/` 混合 login + chat，`/login` 是假的 legacy redirect**
   - `app/pages/auth/login.vue` 目前只做 `navigateTo('/')`，不是真正登入頁
   - 真正登入 UI 在 `app/pages/index.vue`（`auth: false` + 手動切 layout），同時也是 chat 容器
   - 期待：`/login` 變成真正獨立登入頁；`/` 專職 chat（auth required）

2. **登入後不自動跳回原目標 URL**
   - `app/middleware/auth.global.ts:9` `navigateTo('/')` 沒帶 `?redirect=`
   - 登入後停在 `/`，忘掉原本要去的 `/admin/...` / `/account/...` / 等
   - `/auth/mcp/authorize` 有自己的 `saveMcpConnectorReturnTo(route.fullPath)` 機制不受影響，但一般頁面受影響
   - 期待：`/login?redirect=<path>` + 登入成功後 `navigateTo(redirect)`；middleware 導向時帶上 `to.fullPath`

3. **未登入首頁立刻打 `/api/conversations` 回 401**
   - `app/pages/index.vue:119-125`：`watch(historyRefreshKey, ..., { immediate: true })` 不檢查 `loggedIn.value` 就跑 `refreshConversationHistory()` → `GET /api/conversations` → 401 → toast「無法更新對話列表」
   - 根因：`/` 當登入頁但內部仍初始化 chat history composable
   - 拆分 `/` 與 `/login` 後自動解（`/` 只有已登入才進得去）

**建議走法**：

- `/spectra-discuss auth-redirect-refactor` 先釐清收斂 scope，再 `/spectra-propose`
- 要決的事：
  - `/` 變純 chat 還是保留 public landing？
  - `/login` 獨立全頁 vs. modal / tab？
  - `?redirect=` 安全策略（防 open redirect — 強制 same-origin + 可能用 allowlist prefix）
  - Google OAuth callback `/auth/callback` 要不要也 honour redirect
  - 與 `code-quality-review-followups` 批 2/3 都要動 `app/pages/index.vue`，**必須**先協調順序（先等批 2 完成 or stash）
- Tier 3（auth path + middleware）+ Design Review（UI 拆分會動 layout / page）

**⚠ 執行前必看**：

- `app/pages/index.vue` 目前有 `code-quality-review-followups` 批 2/3 的 uncommitted 改動，動它前 `git status` 看清楚
- 動 `app/middleware/auth.global.ts` 要確認不破壞 `/auth/mcp/authorize` 既有 return-to 流程
- 別忘了 `app/pages/auth/callback.vue` 裡 Google OAuth callback 流，redirect query 要透傳

---

### 待接手：`fix-mcp-streamable-http-session`（新 change，draft 狀態）

**背景**：前置 change `fix-mcp-transport-body-consumed` 已 archive 到 `v0.34.5`（commit `bf6a07e`），`POST /mcp initialize` 從 400 → 200，tools/list 200 — body consumption 的 transport 問題已修好。但 Claude.ai 端 tool/call 仍失敗。

**真正 root cause**（tail 觀察收斂）：MCP Streamable HTTP 協議需要 SSE long-lived session，但 server 走 stateless 模式：

1. Claude.ai 首次 initialize 成功後發 `GET /mcp` 開 SSE channel
2. Stateless transport 不快速回 405，hold 30 秒 → Worker runtime `"code had hung"` cancel
3. Claude retry `POST initialize`（body 不完整）→ 400
4. 死循環 → UI 顯示 "Error occurred during tool execution" / "Authorization failed"

**提案的三個方向（待 discuss 收斂）**：

- A. 啟 Streamable HTTP session 模式（優先）— `Mcp-Session-Id` header、真 SSE stream、跨 request session reuse；session state 存 KV / Durable Objects / memory cache
- B. GET /mcp 快速回 405（fallback）— 讓 Claude fallback 到 POST-only
- C. Protocol version downgrade 到 2024-11-05

**建議走法**：`/spectra-discuss fix-mcp-streamable-http-session` 先釐清方向、Cloudflare Workers SSE 可行性、session store 選擇

**⚠ 執行前必看**：

- 本 change 是 Tier 2-3（動 MCP protocol + auth path），要 Design Review（雖無 UI，但 API contract 變動）
- 動 `server/mcp/index.ts` 要保留 `fix-mcp-transport-body-consumed` 留下的 `rehydrateMcpRequestBody` call，或明確評估為 no-op 後移除（unit test 要一起移）
- Cloudflare Workers 30 秒 CPU 限制對 SSE 的影響

**現況**：

- `openspec/changes/fix-mcp-streamable-http-session/` 已建立 proposal + tasks + draft spec
- `pnpm exec spectra analyze` ✓ No issues

---

### `code-quality-review-followups`（上輪 session，批 2/3 待新 session）

Active change: `code-quality-review-followups`（in-progress，10/43 tasks）

批 1（server / util / test，無 UI）已完成並入庫：

- ✅ TD-017 AI binding 共用 helper（含 simplify 擴展涵蓋 mcp/tools/ask + search）
- ✅ TD-018 chat error classification util + lookup table
- ✅ TD-020 ChatGPT connector OAuth path regex 收緊

批 2、3 尚未開始，等新 session 接手。

### 批次計劃

| 批   | Groups     | 內容                                                                           | 狀態             |
| ---- | ---------- | ------------------------------------------------------------------------------ | ---------------- |
| 批 1 | 1, 2, 3    | TD-017 / 018 / 020（server + util + test，無 UI）                              | ✅ 完成並 commit |
| 批 2 | 4, 5, 6, 9 | TD-021 / 022 / 023（都碰 ConversationHistory.vue + index.vue） + Design Review | 待新 session     |
| 批 3 | 7, 8, 10   | TD-024 test 改寫 + tech-debt docs + 人工檢查（7 項你親測）                     | 待新 session     |

### 接手方式（新 session）

1. 確認 claim 未過期：`pnpm spectra:claim code-quality-review-followups`（若 stale）
2. 進入批 2：`/spectra-apply code-quality-review-followups` 會自動載入進度，從 tasks.md 最後一個未勾項（4.1）續跑
3. 批 2 必須做 Design Review（spectra.yaml design_review: true），請跑 `/design improve app/components/chat/ConversationHistory.vue app/pages/index.vue` 起頭
4. 批 3 的 group 10 有 7 項人工檢查，必須使用者本人瀏覽器實測（跨午夜、aria-expanded AT、OAuth reject 三種 payload、classifyError 五類錯誤、AI binding 503、fetch dedup Network tab）

### 本次 commit 的 scope 微調（告知接手者）

- **TD-017**：helper 放新檔 `server/utils/ai-binding.ts`（非原 task 寫的 chat.post.ts 內 local）。
  原因：`server/utils/cloudflare-bindings.ts` 被 15+ integration test 透過 `vi.mock` 攔截。
- **TD-018**：抽到 `app/utils/chat-error-classification.ts`（非原 task 寫的 Container.vue 內）。
  原因：`.spectra.yaml` 開 tdd: true，SFC 內部 function 無法直接 unit test。

## Next Steps

0. **auth-redirect-refactor（最優先，使用者立刻接手）**：見 In Progress 區塊第一項，`/spectra-discuss` 起步，留意與 `code-quality-review-followups` 批 2/3 在 `index.vue` 的 file ownership 衝突。
   0-b. **fix-mcp-streamable-http-session**（另開新 change，上個 session 發現）：MCP transport body fix 已 deploy（v0.34.5），但 Claude tool/call 仍因 SSE session 問題失敗。走 `/spectra-discuss fix-mcp-streamable-http-session` 收斂方向 A/B/C。詳見 In Progress 第二項。
1. **批 2（TD-021 / 022 / 023 + Design Review）**：最優先，新 session 接手；需要瀏覽器
   端驗證跨午夜重分組、aria-expanded 切換。
2. **批 3（TD-024 + tech-debt docs + 人工檢查）**：在批 2 完成後做；人工檢查必須使用者
   本人。
3. **Deploy 後 smoke `/admin/usage`**：上一輪 `fix(admin-usage)` 改為從 Cloudflare
   Workers env 讀 secret；production / staging 第一次請求前確認 `wrangler secret put`
   已寫入 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN_ANALYTICS` /
   `NUXT_KNOWLEDGE_AI_GATEWAY_ID`，admin 進 `/admin/usage` 不再回 503「尚未設定完成」。
4. **驗證日期格式變化**：上上輪 refactor 把 6 個頁面的日期顯示從 `YYYY/MM/DD HH:mm` 改成
   `YYYY/M/D HH:mm:ss`。deploy 後到 `/account/settings`、`/admin/documents/:id`、
   `/admin/members`、`/admin/query-logs`（list + detail）、`/admin/tokens` 目視確認
   新格式符合預期，若不滿意可調整 `app/utils/format-datetime.ts`。
5. **本 change archive 後**：
   - TD-009（user_profiles.email_normalized 全面改 nullable）仍 open，sentinel
     workaround 仍在；另開 Tier 3 migration change 處理。
   - TD-015（SSE heartbeat）+ TD-019（SSE reader pattern 抽共用）+ TD-016
     （isAbortError 抽共用）：SSE 相關技術債，下一條 change（B2 線）合併處理。

## 使用者並行 WIP（不屬於本 change）

以下檔案是使用者自己在做的、與本 change 無關（已確認不碰）：

- `scripts/check-staging-gate.mjs`
- `test/unit/staging-gate.test.ts`

GitHub Actions staging-gate 檢查腳本 + 其測試；由使用者自行決定 commit 時機。
