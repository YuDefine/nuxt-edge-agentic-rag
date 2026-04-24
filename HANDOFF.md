# Handoff

## In Progress

### `wire-do-tool-dispatch`（debug patch 已部署到 production）

- 使用者要求立刻完成 staging MCP protocol 驗證與修復；production 24h / 7d observation window 仍未開始。
- ownKeys root cause 已修並 tag v0.42.2（`ef6d59c`）：`build/nitro/rollup.ts` 把 `reflect-metadata/Reflect.js` polyfill 包進外層 IIFE，避免 `var Reflect;` 洩到 Nitro server bundle module scope。
- Staging v0.42.2 protocol-layer 驗證已 ✅（initialize / notifications/initialized / tools/list / askKnowledge x2 / searchKnowledge x2 皆 HTTP 200；無 ownKeys / 501 / TD-041 / Server already initialized）。詳見 `openspec/changes/wire-do-tool-dispatch/tasks.md` §7.1。
- **但**：4 個 tool call 的 body 都是 `{"result":{"content":[{"type":"text","text":"Tool execution failed. Please retry later."}],"isError":true}}` — tool handler 內部仍 throw，DO `createDoNoopLogger` 把 stack 吞掉，wrangler tail 看不到根因。Task §7.1 checkbox 因此尚未勾選。
- **v0.43.1 debug instrumentation 已上 staging + production**（`c20971e`）：`createDoNoopLogger` 暫改 `console.*`、`normalizeErrorToResult` 前加 `console.error` dump stack。兩處有 `TODO(remove-debug-do-*)` marker 綁 `@followup[TD-041]`。
- Production flag：仍 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=false`（flag off 對 production 流量無影響，tail 看到的會是 staging traffic）。
- 下一步：
  1. ~~推 debug patch~~ → **已完成（v0.43.1 staging + production 已部署）**
  2. 抓 staging handler error stack（wrangler tail + trigger 4 個 tool call），定位是 Workers AI binding / AutoRAG index / D1 / staging seed data / auth scope / 其他。
  3. 修根因 → 跑 immediate validation（4 個 tool call 回真實 answer、`isError: false`）。
  4. 勾選 §7.1，Notion Secret 頁補 sanitized evidence。
  5. immediate validation 通過後評估 flip production flag 並 24h 密集 tail。
  6. 根因修好後**回滾 debug patch**（移除 `mcp-event-shim.ts` / `mcp-session.ts` 兩處 `TODO(remove-debug-do-*)` 區段，restore noop logger）。

### `upgrade-mcp-to-durable-objects`

- Progress: 17/27 tasks（63%）；session lifecycle scope 仍 active，與 `wire-do-tool-dispatch` 同碰 `mcp-knowledge-tools`，ROADMAP 標為 mutex。
- 後續應確認是否由 `wire-do-tool-dispatch` 完成 rollout 後一起 archive / 收斂。

## Blocked

- 截圖審查時 local dev `/api/auth/me/credentials` 曾間歇性回 `500`：`[nuxt-hub] DB binding not found`。詳見 TD-045。

## Next Steps

1. **抓 wire-do-tool-dispatch handler throw stack**（v0.43.1 debug instrumentation 已在 production）：`wrangler tail` → trigger 4 個 tool call（initialize → tools/call askKnowledge / searchKnowledge）→ 觀察 `[mcp-do tool-handler throw]` + `[mcp-do error]` 兩條 log 取得 `error.name / message / stack`。
2. 定位根因並修復 → immediate validation 4 個 tool call 回 `isError: false`。
3. `openspec/changes/wire-do-tool-dispatch/tasks.md` §7.1 勾選，Notion Secret 頁補 sanitized evidence。
4. 評估 flip production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`，24 小時密集 tail。
5. 根因修好後回滾 debug patch（`c20971e` 兩處 `TODO(remove-debug-do-*)` 段落）→ tag 下一版。
6. 7 天 production 穩定後，TD-030 / TD-041 標 done，archive `wire-do-tool-dispatch`，收斂 `upgrade-mcp-to-durable-objects`。
7. TD-049 Acceptance 收尾：觀察後續 3 次 main push / tag 的 `deploy-docs-*` 皆綠，更新 Acceptance 勾選。
8. 追 local dev binding 問題（TD-045）：影響 screenshot review 穩定性。

## Recently Completed（2026-04-25）

- **v0.43.1 release**：
  - 👷 ci `5ce334c`：deploy.yml 兩個 `deploy-docs-*` step 加 `--commit-hash` + `--commit-message "Deploy <sha>"`，規避 Cloudflare Pages API 8000111 bug（TD-049 Fix approach short-term）
  - 🐛 fix `c20971e`：DO debug instrumentation for wire-do-tool-dispatch handler throw 定位
  - 🐛 fix `2def87f`：docs 內 yaml block 用 `v-pre` 禁 vitepress Vue 解析，解鎖 docs build
- **v0.43.1 deploy runs**：staging `24911683359` + production `24911891236` 全綠，`deploy-docs-*` 分別 49s / 55s 通過 → **TD-049 workaround 實證有效**。`agentic-docs.yudefine.com.tw` 已更新到 v0.43.1（覆蓋 v0.43.0 docs 空窗）。
