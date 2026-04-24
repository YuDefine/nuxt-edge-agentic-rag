# Handoff

## In Progress

### `code-quality-review-followups`（ready to archive）

- **43/43 tasks complete**，所有人工檢查已實測或以 unit test 為證據通過（2026-04-24 session）
- 所有 code 改動已 commit：批 1（32f6df2/fb2f1f7/a817b91 — TD-017/018/020）、批 2/3 + TD-025（bea4deb）
- 人工檢查勾選已隨 v0.35.0 一併 commit（`27935b2`）
- **下一步**：`/spectra-archive code-quality-review-followups`

### `auth-redirect-refactor`（proposal 已 commit，實作尚未開始）

- proposal / design / tasks / spec 已建立，commit `1ee01d8`
- Phase 1 infra 已進：`app/utils/auth-return-to.ts`（`parseSafeRedirect` + generic return-to sessionStorage helper）+ 22 個 unit test（commit `82835dc`）
- **下一步**：`/spectra-apply auth-redirect-refactor` 跑後面的 middleware / pages 改動

**背景（為何拆）**：`/` 目前同時承擔 landing / login / chat 容器 / chat-history fetch 起點四個角色，造成：

1. `/login` 是假路由（`navigateTo('/')`）、真正登入 UI 混在 `index.vue`
2. 登入後不回原目標（`auth.global.ts` 無條件去 `/` 不帶 `redirect`）
3. 未登入首頁立刻打 `/api/conversations` 回 401（history 初始 watch 無 `loggedIn` 防護）

### `fix-mcp-streamable-http-session`（draft，待 discuss）

前置 change `fix-mcp-transport-body-consumed` 已 archive（v0.34.5），`POST /mcp initialize` 從 400 → 200。但 Claude.ai tool/call 仍失敗，root cause 是 MCP Streamable HTTP 需要 SSE long-lived session，stateless transport 撞 Worker 30s `"code had hung"`。

**三個方向（待收斂）**：

- A. 啟 Streamable HTTP session 模式（優先）— `Mcp-Session-Id` header、SSE stream、session store (KV / Durable Objects)
- B. `GET /mcp` 快速回 405（fallback，讓 Claude 走 POST-only）
- C. Protocol version downgrade 到 2024-11-05

**下一步**：`/spectra-discuss fix-mcp-streamable-http-session` 釐清方向、Cloudflare Workers SSE 可行性、session store 選型。

## Next Steps

1. **`spectra-archive code-quality-review-followups`** — 一行指令結案，v0.35.0 已含全部改動
2. **接續 `auth-redirect-refactor` 實作**：`/spectra-apply auth-redirect-refactor`，tasks 包含 `/login` 新頁、`auth.global.ts` 帶 redirect、`index.vue` 瘦身
3. **`fix-mcp-streamable-http-session` discuss**：`/spectra-discuss fix-mcp-streamable-http-session`，從 A/B/C 收斂
4. **Deploy 後 smoke 檢查**：
   - `/admin/usage` 首次打開確認 503「尚未設定完成」不再出現（依賴 production wrangler secret `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN_ANALYTICS` / `NUXT_KNOWLEDGE_AI_GATEWAY_ID`）
   - staging-gate workflow 實際跑一次（`scripts/check-staging-gate.mjs` 已 ship）
   - production chat 送訊息確認 TD-025 CSRF fix 生效（`POST /api/chat` 200，不再 403）
5. **Residual TDs（code-quality-review-followups archive 後的後續 change 候選）**：
   - TD-009（`user_profiles.email_normalized` 改 nullable）Tier 3 migration
   - TD-015（SSE heartbeat）+ TD-019（SSE reader pattern 抽共用）+ TD-016（isAbortError 抽共用）SSE 合併處理
   - TD-026（index.vue vs ConversationHistory owner-fallback 重複 config）low priority
   - 新發現：`scripts/check-ci-gate.mjs` 與 `scripts/check-staging-gate.mjs` 約 70% 結構重複（`fetchWorkflowRuns` / `waitFor*Gate` / `main`）可抽 `scripts/_github-gate-helpers.mjs`；要修時記得補 TD entry
6. **日期格式 smoke（遺留自上上輪 refactor）**：`/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認新格式（`YYYY/M/D HH:mm:ss`）符合預期；若不滿意可調 `app/utils/format-datetime.ts`
