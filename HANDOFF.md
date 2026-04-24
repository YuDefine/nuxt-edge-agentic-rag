# Handoff

## In Progress

### `wire-do-tool-dispatch`（§7.1 已勾，等待 production flag flip）

- **Staging immediate validation 已通過**（2026-04-25, post-v0.43.1 debug instrumentation 抓到 stack 後）：root cause = TD-046（staging Cloudflare 帳號內未建 `agentic-rag-staging` AutoRAG），透過 CF API 建 AutoRAG + AI Gateway 後重跑 4 個 tool call 全部 `isError: false`（empty / refused 為 staging R2 空所致正常行為，SID `e9dcb3b4-...`）。詳見 `openspec/changes/wire-do-tool-dispatch/tasks.md` §7.1 Resolution 段。
- **debug instrumentation 已回滾**（本次 commit）：`mcp-event-shim.ts` 的 `createDoNoopLogger` 已 restore noop body；`mcp-session.ts` 的 `normalizeErrorToResult` 已移除 `console.error` block；兩處 `TODO(remove-debug-do-*)` marker 全清。
- TD-046 status `done`；staging RAG content 為空的後續工作拆 `@followup[TD-050]`，不阻擋本 change archive。
- Production flag：仍 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=false`，待下一步。
- 下一步：
  1. 評估 flip production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`，24 小時 wrangler tail 密集監控；任一 anomaly 立刻 flag=false（無需 redeploy，§7.2）。
  2. Production 正常運作 7 天後，`docs/tech-debt.md` 把 TD-030 + TD-041 status 標 `done`（§7.3），各附一句 one-liner。
  3. §8 人工檢查（Claude.ai connector 真實 query x3、MCP Inspector tools/list 4 個、wrangler tail 24h 觀察、`NUXT_MCP_AUTH_SIGNING_KEY` staging/prod 不同高熵值確認）。
  4. archive `wire-do-tool-dispatch`，收斂 `upgrade-mcp-to-durable-objects`。

### `upgrade-mcp-to-durable-objects`

- Progress: 17/27 tasks（63%）；session lifecycle scope 仍 active，與 `wire-do-tool-dispatch` 同碰 `mcp-knowledge-tools`，ROADMAP 標為 mutex。
- 後續應確認是否由 `wire-do-tool-dispatch` 完成 rollout 後一起 archive / 收斂。

## Blocked

- 截圖審查時 local dev `/api/auth/me/credentials` 曾間歇性回 `500`：`[nuxt-hub] DB binding not found`。詳見 TD-045。

## Next Steps

1. **flip production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`** — 評估時間後執行，24 小時 wrangler tail 密集監控；任一 anomaly 立刻 flag=false（無需 redeploy，§7.2）。
2. Production flag=true 7 天觀察後，TD-030 / TD-041 標 `done`，archive `wire-do-tool-dispatch`，收斂 `upgrade-mcp-to-durable-objects`（§7.3 + §8）。
3. Notion Secret 頁 staging 區塊補 `agentic-rag-staging` AutoRAG / Gateway 已建（人工，有明文 secret 需要本機 mint token 寫入）。
4. **TD-050**（staging R2 RAG content seed） — 若 staging 真實使用情境出現再做，預計 sample docs 5–10 個或 daily sync from production（拆獨立 spectra change）。
5. **TD-049** Acceptance #3 已達（v0.43.0 失敗、v0.43.1 + v0.43.2 連續 2 次綠 → 第 3 次發版仍須觀察）；可開始評估標 done 的時機。
6. **TD-045** local dev binding 後續：narrow scope 已上 v0.43.2，剩 `/api/auth/me/credentials` 間歇 500 `[nuxt-hub] DB binding not found` 待 trace 定位（詳見 `docs/tech-debt.md` TD-045 active scope）。

## Recently Completed（2026-04-25）

- **v0.43.1 release**：
  - 👷 ci `5ce334c`：deploy.yml 兩個 `deploy-docs-*` step 加 `--commit-hash` + `--commit-message "Deploy <sha>"`，規避 Cloudflare Pages API 8000111 bug（TD-049 Fix approach short-term）
  - 🐛 fix `c20971e`：DO debug instrumentation for wire-do-tool-dispatch handler throw 定位
  - 🐛 fix `2def87f`：docs 內 yaml block 用 `v-pre` 禁 vitepress Vue 解析，解鎖 docs build
- **v0.43.1 deploy runs**：staging `24911683359` + production `24911891236` 全綠，`deploy-docs-*` 分別 49s / 55s 通過 → **TD-049 workaround 實證有效**。`agentic-docs.yudefine.com.tw` 已更新到 v0.43.1（覆蓋 v0.43.0 docs 空窗）。
- **v0.43.2 release**（本次 /commit）：
  - 🐛 fix `a427682`：收 wire-do-tool-dispatch §7.1，回滾 c20971e DO debug instrumentation（root cause = TD-046 staging AutoRAG 缺漏，CF API 建 RAG + Gateway 後 4 tool call 全 isError: false）；TD-046 done + TD-050 新增。
  - 🧹 chore `00e5314`：predev bootstrap health check（TD-045 narrow scope #3）。
  - 📝 docs `cbebf3e`：HANDOFF + ROADMAP 同步主線 / parallel / claim heartbeat。
- **v0.43.2 deploy runs**：staging `24913877052` + production `24914030014` 全綠，`deploy-docs-*` 分別 1m11s / 54s 通過（TD-049 連續第三次 staging+production 都過）。
