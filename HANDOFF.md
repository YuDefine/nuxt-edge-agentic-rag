# Handoff

## In Progress

### v0.43.0 已發布（2026-04-25）

- main push `5a47a63` → staging deploy 全綠：run `24908001430`（`deploy-staging` + `smoke-test-staging` 都 success；`deploy-docs-staging` 失敗，見下「⚠️ deploy-docs-staging UTF-8 commit message issue」）
- tag `v0.43.0` → production deploy run `24908303837` 觸發中，未追完
- 版本：`0.42.2` → `0.43.0`（minor，含 `web-chat-ui` 新 `Conversation History Refresh Reconciliation` requirement）

### `wire-do-tool-dispatch`

- 使用者要求立刻完成 staging MCP protocol 驗證與修復；production 24h / 7d observation window 仍未開始。
- ownKeys root cause 已修並 tag v0.42.2（`ef6d59c`）：`build/nitro/rollup.ts` 把 `reflect-metadata/Reflect.js` polyfill 包進外層 IIFE，避免 `var Reflect;` 洩到 Nitro server bundle module scope。
- Staging v0.42.2 protocol-layer 驗證已 ✅（initialize / notifications/initialized / tools/list / askKnowledge x2 / searchKnowledge x2 皆 HTTP 200；無 ownKeys / 501 / TD-041 / Server already initialized）。詳見 `openspec/changes/wire-do-tool-dispatch/tasks.md` §7.1。
- **但**：4 個 tool call 的 body 都是 `{"result":{"content":[{"type":"text","text":"Tool execution failed. Please retry later."}],"isError":true}}` — 即 `normalizeErrorToResult` fallback message。tool handler 內部仍 throw（不是 SDK parse 層）；DO `createDoNoopLogger` 把 stack 吞掉，wrangler tail 看不到根因。Task §7.1 checkbox 因此尚未勾選。
- Production flag：仍 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=false`（v0.42.2 production build 已 tag / deploy，但 flag off 對 production 流量無影響）。
- 下一步：
  1. 推一版 debug patch — 在 tool handler 內 `normalizeErrorToResult` 之前 wrap try/catch，把 `error.stack` + `message` + `status` 用 `console.error` 打到 wrangler tail；或把 `createDoNoopLogger` 換成 minimal `console.*` logger。
  2. 抓 staging handler error stack，定位是 Workers AI binding / AutoRAG index / D1 / staging seed data / auth scope / 其他。
  3. 修根因 → 跑 immediate validation（4 個 tool call 回真實 answer、`isError: false`）。
  4. 勾選 §7.1，Notion Secret 頁補 sanitized evidence。
  5. immediate validation 通過後評估 flip production flag 並 24h 密集 tail。

### `upgrade-mcp-to-durable-objects`

- Progress: 17/27 tasks（63%）；session lifecycle scope 仍 active，與 `wire-do-tool-dispatch` 同碰 `mcp-knowledge-tools`，ROADMAP 標為 mutex。
- 後續應確認是否由 `wire-do-tool-dispatch` 完成 rollout 後一起 archive / 收斂。

## Blocked

- 截圖審查時 local dev `/api/auth/me/credentials` 曾間歇性回 `500`：`[nuxt-hub] DB binding not found`。詳見 TD-045。
- ⚠️ **deploy-docs-staging UTF-8 commit message issue**（v0.43.0 兩次 rerun 皆失敗）：Cloudflare Pages API 回 `Invalid commit message, it must be a valid UTF-8 string [code: 8000111]`。staging app deploy + smoke 全綠；不阻擋 `verify-staging-gate` 也不阻擋 production tag。但 docs 站 v0.43.0 未更新。需要查 wrangler 4.84.1 對 git commit message 的編碼處理（疑為 multi-commit batch / 特定 CJK 字元組合 / wrangler 與 CF API contract 漂移），或在 workflow 顯式傳 `--commit-message` 用 ASCII fallback。

## Next Steps

1. 追 v0.43.0 production deploy run `24908303837` 結果。
2. 查並修 `deploy-docs-staging` UTF-8 issue；考慮升 TD entry 並在 deploy.yml 顯式傳 sanitized `--commit-message`。
3. `wire-do-tool-dispatch`：tool handler 內部 throw debug patch → 抓 stack → 修根因 → immediate validation → 勾選 §7.1 → Notion Secret 頁補 sanitized evidence。
4. 修好後評估 flip production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`，24 小時密集 tail。
5. 7 天 production 穩定後，TD-030 / TD-041 標 done，archive `wire-do-tool-dispatch`，收斂 `upgrade-mcp-to-durable-objects`。
6. 追 local dev binding 問題（TD-045）：影響 screenshot review 穩定性。
