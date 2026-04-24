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

## Parallel Work Completed（未 commit，留給 /commit 分組）

- **TD-045 narrow scope**（Claude sub-session，avoid 主線檔案，code 已實作完畢）：
  - ✅ 新增 `scripts/check-dev-bootstrap-health.mjs`（untracked）— 非阻斷 predev 體檢；目前命中 `NUXT_KNOWLEDGE_AI_SEARCH_INDEX` 空值 warning，並預留 stale `*_new(…)` FK refs 偵測（sqlite3 CLI 查 sqlite_master，未安裝即靜默 skip）。exit code always 0，不擋 dev。
  - ✅ `package.json` `predev` 前綴加上 health check。`pnpm predev` 已驗證跑得通（三個 script 依序 exit 0、警告正確顯示）。
  - ✅ 本次對 `.env.example` 的註解修改被 `guard-check` 阻擋（檔案 permanent-protected），改由 script 輸出訊息本身指引到 Notion Secret 頁，不動 `.env.example`。
  - ✅ `pnpm format:check` 綠（scripts/ 被 lint ignore，無 lint 可跑）。
- **建議 commit 分組**（主線 commit 結束後）：
  - Group: 「chore: add local dev bootstrap health check (TD-045 #3)」
    - `scripts/check-dev-bootstrap-health.mjs`（new）
    - `package.json`（predev 加 prefix，無版號變動）
- **仍待動（後續）**：
  - 等主線 commit `docs/tech-debt.md`（TD-046 done + TD-050 新增）完成後，再更新 TD-045 register 把 Problem #1/#2 標為 NuxtHub v0.10.7 已處理（驗證：`_hub_migrations` 表有 11 筆應用記錄、`sqlite_master` 無 `*_new` refs），narrow Fix approach 為只剩 Problem #3。
  - `[nuxt-hub] DB binding not found` 間歇 500 不在本輪 scope（需要可重現的 trace 才能定位）。

## Next Steps

1. **flip production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`** — 評估時間後執行，24 小時 wrangler tail 密集監控；任一 anomaly 立刻 flag=false（無需 redeploy，§7.2）。
2. Production flag=true 7 天觀察後，TD-030 / TD-041 標 `done`，archive `wire-do-tool-dispatch`，收斂 `upgrade-mcp-to-durable-objects`（§7.3 + §8）。
3. Notion Secret 頁 staging 區塊補 `agentic-rag-staging` AutoRAG / Gateway 已建（人工，有明文 secret 需要本機 mint token 寫入）。
4. **TD-050**（staging R2 RAG content seed） — 若 staging 真實使用情境出現再做，預計 sample docs 5–10 個或 daily sync from production（拆獨立 spectra change）。
5. **TD-049** Acceptance 收尾：觀察後續 3 次 main push / tag 的 `deploy-docs-*` 皆綠，更新 Acceptance 勾選。
6. **TD-045** local dev binding：影響 screenshot review 穩定性（並行 sub-session 已在做 narrow scope，見 Parallel Work 區塊）。

## Recently Completed（2026-04-25）

- **v0.43.1 release**：
  - 👷 ci `5ce334c`：deploy.yml 兩個 `deploy-docs-*` step 加 `--commit-hash` + `--commit-message "Deploy <sha>"`，規避 Cloudflare Pages API 8000111 bug（TD-049 Fix approach short-term）
  - 🐛 fix `c20971e`：DO debug instrumentation for wire-do-tool-dispatch handler throw 定位
  - 🐛 fix `2def87f`：docs 內 yaml block 用 `v-pre` 禁 vitepress Vue 解析，解鎖 docs build
- **v0.43.1 deploy runs**：staging `24911683359` + production `24911891236` 全綠，`deploy-docs-*` 分別 49s / 55s 通過 → **TD-049 workaround 實證有效**。`agentic-docs.yudefine.com.tw` 已更新到 v0.43.1（覆蓋 v0.43.0 docs 空窗）。
