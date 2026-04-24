# Handoff

## In Progress

### v0.43.0 已發布（2026-04-25）

- main push `5a47a63` → staging deploy run `24908001430`：`deploy-staging` + `smoke-test-staging` ✅；`deploy-docs-staging` ❌（UTF-8 issue，見下）
- tag `v0.43.0` → production deploy run `24908303837`：`deploy-production` ✅（2m1s）、`smoke-test` ✅；**但 `deploy-docs-production` 也中招 UTF-8 issue ❌**（40s 後 exit 1，Cloudflare API 同一錯誤碼 8000111）
- 影響：**app production v0.43.0 已實際上線**（Workers / smoke 都綠）；**docs production 仍停在前一版**（`agentic-docs.yudefine.com.tw` 未更新到 v0.43.0）
- 版本：`0.42.2` → `0.43.0`（minor，含 `web-chat-ui` 新 `Conversation History Refresh Reconciliation` requirement）
- 後續 main push `a0e2426`（更新 HANDOFF）→ run `24908394088`：`deploy-docs-staging` **反而成功**（49s） — 觸發條件與 commit message 內容相關，非 wrangler/CF API 全面漂移

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
- ⚠️ **docs deploy UTF-8 commit message issue**（TD-049）：Cloudflare Pages API 拒絕合法 UTF-8 commit message，`5a47a63` v0.43.0 tag 中招、後續 `a0e2426` 不中招 → 非 wrangler 全面漂移。app production 不受影響，但 `agentic-docs.yudefine.com.tw` 停在舊版。已登記 TD-049 + `docs/solutions/tooling/2026-04-25-cloudflare-pages-utf8-commit-message.md`，workaround patch 待人工套到 `.github/workflows/deploy.yml`（Claude guard 保護 workflow，無法代改）。

## Next Steps

1. ~~追 v0.43.0 production deploy run `24908303837` 結果~~ → **已追完**：app ✅ / docs ❌。
2. TD-049 docs UTF-8 workaround（in-progress）：
   - **人工套 workflow patch**（見對話中 diff / TD-049 Fix approach）到 `.github/workflows/deploy.yml` 兩個 `deploy-docs-*` step
   - 套完回主線跑 `/commit` 封版（TD entry + solutions doc + HANDOFF 更新已完成，workflow 由人工 edit 後自然被 `git status` 撈入同一 commit flow）
   - merge 後 `gh workflow run deploy.yml --ref v0.43.0 -f target=production`（或在 v0.43.0 tag 上 workflow_dispatch）補 docs production v0.43.0
   - 觀察後續 3 次發版 `deploy-docs-*` 是否持續綠，更新 TD-049 Acceptance
3. `wire-do-tool-dispatch`：tool handler 內部 throw debug patch → 抓 stack → 修根因 → immediate validation → 勾選 §7.1 → Notion Secret 頁補 sanitized evidence。
4. 修好後評估 flip production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`，24 小時密集 tail。
5. 7 天 production 穩定後，TD-030 / TD-041 標 done，archive `wire-do-tool-dispatch`，收斂 `upgrade-mcp-to-durable-objects`。
6. 追 local dev binding 問題（TD-045）：影響 screenshot review 穩定性。
