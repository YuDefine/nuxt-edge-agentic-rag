# Handoff

## In Progress

### v0.42.0 已發布（2026-04-24）

- `main` push `a2ecbb1` → staging deploy 全綠：run `24898590937`
- tag `v0.42.0` → production deploy + docs production + smoke + notify 全綠：run `24898814022`
- 版本：`0.41.0` → `0.42.0`（minor）
- staging smoke-test 有 annotation：GitHub runner health check target 被 Cloudflare WAF/Bot protection 回 `403`，但 workflow 判定成功；與先前 custom domain smoke 情況一致。

### `consolidate-conversation-history-config`

- Progress: 20/26 tasks（77%）；factory 抽取、unit test、`index.vue` / `ConversationHistory.vue` 接上 factory、既有測試 / 文件 / TD-026 收斂皆已完成。
- Claim: `charles@charlesdeMac-mini.local`（2026-04-24 16:34 最後 heartbeat）。
- 剩餘：
  - §6.2 review-screenshot（`/` signed-in、inline sidebar `lg`+、off-canvas drawer `<lg`）
  - §7.1–7.5 人工檢查（local dev 登入 → refresh / 選擇 / 刪除 / 新增 / 清空 active 5 個 journey）

### `wire-do-tool-dispatch`

- 使用者要求立刻完成 staging MCP protocol 驗證與修復，production 24h / 7d observation window 仍未開始。
- ownKeys root cause 已定位並修掉，已 push + tag `v0.42.2`：
  - `fa95128`（v0.42.1 debug patch：DO CallTool handler wrap 把 throw stack 丟到 wrangler tail）→ `7bf5197`（deploy v0.42.1，Deploy run `24903823122` staging 全綠）
  - `ef6d59c`（v0.42.2 真 fix：`build/nitro/rollup.ts` 把 `reflect-metadata/Reflect.js` polyfill 包進外層 IIFE、`server/durable-objects/mcp-session.ts` 移除 debug patch）→ `a3a43ac`（deploy v0.42.2，Deploy run `24905096791` staging 全綠）。
  - Root cause：polyfill 內 `var Reflect;` 洩到 Nitro server bundle module scope，minifier rename 為 `a` / `a16` 並把 `{}` 指派給它；zod v4 `ZodRecord.parse` 的 `Reflect.ownKeys(input)` 讀到的是 `{}` → `{}.ownKeys` 不是 function。本地 `.output/server/chunks/nitro/nitro.mjs` 驗證：修復後 bundle 頂端不再有 `var a;`，ZodRecord 的 ownKeys 呼叫已明確指向 native `Reflect.ownKeys`。
- Staging v0.42.2 立即驗證（`/tmp/mcp-staging-debug/mcp-probe-full.sh`，2 輪獨立 session）：
  - ✅ `initialize`、`notifications/initialized`、`tools/list` 皆 HTTP 200、`Mcp-Session-Id` 有出現
  - ✅ `askKnowledge` x2、`searchKnowledge` x2 皆 HTTP 200
  - ✅ 無 JSON-RPC `-32603 a16.ownKeys`、無 501、無 `TD-041`、無 `Server already initialized` re-init loop
  - ✅ Staging custom domain `agentic-staging.yudefine.com.tw` 可達
- **但**：4 個 tool call 的 body 都是 `{"result":{"content":[{"type":"text","text":"Tool execution failed. Please retry later."}],"isError":true}}` — 這是我們 `normalizeErrorToResult` 的 fallback message（`TOOL_EXECUTION_FAILED_MESSAGE`）；即 **tool handler 內部仍 throw**（不是 SDK parse 層）。Wrangler tail 只留 info-level wide event（duration 1–1.6 秒、status 200），看不到 handler error 真正內容（DO `logDoError` 走 `createDoNoopLogger`）。
- Task 7.1 的明文驗收條件全部滿足（`AskKnowledge`/`SearchKnowledge` 各 2+ 次 + 非 501 + 非 re-init + HTTP 200 + 無 ownKeys + 無 401 auth context failure），但 handler `isError: true` 是獨立問題，會直接影響 8.1–8.2 的人工 UI 驗收（使用者會看到 "Tool execution failed" 而非真實答案）。Production flag flip 前必須先解。
- 下一步：
  1. 重推一版臨時 debug patch（只 wrap 自家 tool handler try/catch 在 `normalizeErrorToResult` 前，把 error 的 `stack` + `message` + `status` 用 `console.error` 打到 wrangler tail；或改 `createDoNoopLogger` 為 minimal `console.*` logger）。
  2. 抓 staging handler error stack，定位是 Workers AI binding / AutoRAG index / D1 / staging seed data / auth scope / 其他。
  3. 修根因 → 再跑 immediate validation（4 個 tool call 回真實 answer、`isError: false` / 有 `content.text` 非 fallback）。
  4. 更新 `openspec/changes/wire-do-tool-dispatch/tasks.md` 7.1 並勾選；Notion Secret 頁補 sanitized evidence（禁止貼任何 token / key / secret）。
- Production flag：仍 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=false`。v0.42.2 production build 已 tag / deploy，但 flag off 對 production 流量無影響；**確定 tool handler 修好 + staging 完整 immediate validation 後**才能 flip production。
- Notion：Secret 頁尚未寫最終驗收 comment（等 tool handler bug 修完再一起補）。

### `upgrade-mcp-to-durable-objects`

- Progress: 17/27 tasks（63%）；session lifecycle scope 仍 active，與 `wire-do-tool-dispatch` 同碰 `mcp-knowledge-tools`，ROADMAP 標為 mutex。
- 後續應確認是否由 `wire-do-tool-dispatch` 完成 rollout 後一起 archive / 收斂。

## Blocked

- 截圖審查時 local dev `/api/auth/me/credentials` 曾間歇性回 `500`：`[nuxt-hub] DB binding not found`。UI 本身無阻塞缺陷，但完整 dark mode 正常態審查被 local binding 問題限制；若要追，先看 NuxtHub local DB binding 初始化。

## Next Steps

1. `consolidate-conversation-history-config`：跑 review-screenshot + 陪使用者走 §7.1–7.5 五條 journey（人工檢查 **不能自勾**）。
2. `wire-do-tool-dispatch`：立刻完成 staging MCP 驗證；目前先修 `tools/call` 的 `a16.ownKeys is not a function or its return value is not iterable`。
3. `tools/call` 修好後重跑 immediate validation：`initialize`、`notifications/initialized`、`tools/list`、`askKnowledge` x2、`searchKnowledge` x2、確認無 `TD-041` / `501` / `Server already initialized`。
4. immediate validation 通過後更新 `openspec/changes/wire-do-tool-dispatch/tasks.md` 7.1，並在 Notion Secret 頁補 sanitized evidence comment。
5. staging immediate validation 通過後再評估是否 flip production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`，production 24 小時密集 tail；任一 anomaly 立刻 flag=false。
6. 7 天 production 穩定後，把 `docs/tech-debt.md` 的 TD-030 / TD-041 標 done，並 archive `wire-do-tool-dispatch` / 收斂 `upgrade-mcp-to-durable-objects`。
7. 追 local dev binding 問題：`/api/auth/me/credentials` 的 NuxtHub DB binding 500 會影響 screenshot review 穩定性。
