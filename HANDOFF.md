# Handoff

## In Progress

### `upgrade-mcp-to-durable-objects`（Pivot C 選定，進 Phase 4）

- Claim: `charles@charlesdeMac-mini.local`
- Progress: 6/25 tasks（24%）
  - ✅ 1.2 runtime config `mcp.sessionTtlMs`（`39ebcb3`）
  - ✅ 2.1 diag patch Round 1 + Round 2 entry log
  - ✅ 2.2 tail 抓到 `[MCP-DIAG-ENTRY]` + `[MCP-DIAG]`（Round 2 實證）
  - ✅ 2.3 revert diag patch（`4448cd3`）+ solution doc + ingest（`b1966ba`）
  - ✅ 3.3 Pivot C 評估：SDK Transport interface 極簡，自寫 shim ~30 行
  - ✅ 3.4 Pivot decision log：**選 Pivot C**
  - ⊘ 3.1 / 3.2 skipped（選 C 後不需要）
  - ↳ 1.1 合併到 4.5（wrangler binding 要 DO class 存在才能 dry-run）
- **Pivot C 關鍵洞察**：SDK `Transport` interface（`start / send / close + onmessage`）極簡，自寫 `DoJsonRpcTransport` 只做 HTTP ↔ JSONRPCMessage 橋接、**從未碰 env proxy**，根除 `Reflect.ownKeys` bug；SDK `McpServer` + `Protocol` 處理所有 request 派遣 / response 組裝
- 詳細記錄：[`docs/solutions/mcp-streamable-http-session-durable-objects.md`](docs/solutions/mcp-streamable-http-session-durable-objects.md) § Pivot Decision — C

## Next Steps

1. **Phase 4 Core Implementation**（依 Pivot C 路線）
   - 4.1 新增 `server/mcp/do-transport.ts`：`DoJsonRpcTransport` class（~30 行）
   - 4.2 新增 `server/mcp/durable-object.ts`：`MCPSessionDurableObject` class + state schema + alarm GC
   - 4.3 DO `fetch()` 實作：HTTP ↔ JSON-RPC 橋接、lazy init McpServer、簽發 Mcp-Session-Id header
   - 4.4 改 `server/mcp/index.ts` 依 `features.mcpSession` 路由
   - 4.5 `wrangler.jsonc` 加 `durable_objects.bindings` MCP_SESSION v1 + dry-run 驗證
   - 4.6 middleware 加過期 session 404 + token revoke 連動清 DO
2. **`assert-never` 重複 util 收斂** — `app/utils/assert-never.ts` 與 `shared/utils/assert-never.ts` 重複（Nuxt auto-import 以 shared 為主），nuxt typecheck 仍噴 WARN；非本 change scope
3. **長期 TD**（見 `docs/tech-debt.md`）
   - TD-027 MCP connector first-time auth — 等 upgrade-mcp-to-durable-objects 完成後一併實測
   - TD-028 DeleteAccountDialog Google reauth callbackURL — 獨立 change 候選
   - TD-009 `user_profiles.email_normalized` nullable migration
   - TD-015 + TD-019 + TD-016 SSE 合併處理
   - TD-026 conversation owner-fallback 重複 config
4. **日期格式 smoke（遺留）** — `/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認

## MCP Toolkit Review Follow-ups（2026-04-24 待建檔）

來源：`npx skills add https://mcp-toolkit.nuxt.dev`（`.claude/skills/manage-mcp/`）安裝後對照 `server/mcp/` 現況 review 找出的落差。全部選 D 範圍展開；拆多個 discuss/propose 以降低單一 change 風險。

依建議推進順序列出（括號內標示與 `upgrade-mcp-to-durable-objects` 的依賴 / 互斥關係）：

### Propose 候選（可獨立推進、不撞 DO change）

1. **`enhance-mcp-tool-metadata`**（P0，低風險，獨立）
   - Scope：4 個 tool（`ask.ts` / `search.ts` / `get-document-chunk.ts` / `categories.ts`）補 `.describe()` on Zod fields、`annotations`（`readOnlyHint` / `destructiveHint` / `openWorldHint`）、`inputExamples`
   - Why：本專案是 Agentic RAG，MCP client（Claude / Cursor / ChatGPT）tool-selection 精準度直接決定回答品質；現況 `query` / `citationId` 連 `.describe()` 都沒有
   - 檔案：`server/mcp/tools/*.ts`（4 檔，不動 `index.ts` 避免撞 DO change）
   - Tier：1；無 behavior change，純 metadata

2. **`add-mcp-tool-selection-evals`**（P1，中成本，獨立）
   - Scope：引入 `evalite` + `@ai-sdk/mcp`，建 `test/evals/mcp-tool-selection.eval.ts`，覆蓋自然語言 → 正確 tool + 正確參數的對照表
   - Why：Agentic RAG 的品質回歸測試目前是零；當前 11 個 `test/integration/mcp-*.test.ts` 只測 protocol / auth / DO lifecycle，不測 LLM 選 tool 行為
   - 檔案：`package.json`（eval scripts + devDeps）、`test/evals/**`、可能 `.env.example`
   - Tier：2；不擋 CI（獨立 cmd）
   - 備註：評估是否要升級 `@nuxtjs/mcp-toolkit` 與 `@ai-sdk/mcp` 版本匹配

3. **`integrate-mcp-logger-notifications`**（P1，中成本，獨立）
   - Scope：4 個 tool 的 retrieval 進度用 `useMcpLogger().notify.*` 推 client channel；server wide event 仍保留現有 evlog query log / audit log
   - Why：`askKnowledge` / `searchKnowledge` retrieval 時間數秒；client-side 有 live progress UX 會大幅改善；toolkit 自帶 `mcp.tool` / `mcp.session_id` tag 省自訂
   - 檔案：`server/mcp/tools/*.ts`（4 檔）
   - Tier：1；純 observability 層新增，不動業務邏輯
   - 依賴：要先確認 `@nuxtjs/mcp-toolkit@0.14.0` 是否已暴露 `useMcpLogger`（discuss 階段驗證）

### Discuss 候選（scope 不明、需產品 / 架構判斷）

4. **`discuss-mcp-resource-layer`**（P2-5，feature 擴張）
   - 題目：是否新增 `server/mcp/resources/`，暴露 `resource://governance-snapshot` / `resource://category-taxonomy` 等 read-only 快照？
   - 益處：client 一次 fetch 政策 / 分類樹，不用每請求經 tool；降低 LLM context token
   - 風險：governance policy 變動時的 cache invalidation 策略要想清楚
   - 依賴：無技術依賴，但建議等 DO change archive 後再 propose，避免 `server/mcp/` 結構兩邊動

5. **`discuss-mcp-elicitation-for-ask`**（P2-6，**被 parallel change Non-Goals 排除**）
   - 題目：`askKnowledge` 在 query 過於模糊時，用 `useMcpElicitation` 追問「哪個類別 / 哪個課程 / 哪個學期」？
   - **Blocker**：`upgrade-mcp-to-durable-objects` Non-Goals 明確寫「不引入 MCP prompt / elicitation / sampling 能力」
   - **Gate**：**MUST** 等 DO change archive 後才能 propose，否則違反 parallel change 的 Non-Goals

6. **`discuss-mcp-async-context-refactor`**（P2-7，Tier 3，高風險）
   - 題目：是否在 `nuxt.config.ts` 加 `nitro.experimental.asyncContext: true`，並把 4 個 tool 從自訂 `getCurrentMcpEvent()` 切換到官方 `useEvent()` / `useMcpSession()`？
   - 益處：省掉 `server/utils/current-mcp-event.ts` 自訂 util；對齊 toolkit 官方 API
   - 風險：與 `rehydrateMcpRequestBody` / DO transport 的互動未知；DO change 仍在 rollout 階段，不宜同時動 event helper 層
   - **Gate**：**MUST** 等 DO change archive + production flag 全開至少一個 sprint 後再 propose；discuss 階段先驗證 asyncContext 是否與 Cloudflare Workers runtime 相容（過去踩過 `Reflect.ownKeys` bug，async context 走同一層 proxy）

### 推薦推進順序

1. 立刻可做：1 → 2 → 3（皆不撞 DO change）
2. DO change archive 後：4 → 5
3. 5 完成 + 觀察一個 sprint：6

### 安裝紀錄

- 2026-04-24：`npx skills add https://mcp-toolkit.nuxt.dev --agent claude-code -y` 安裝 `manage-mcp` skill 到 `.claude/skills/`
- **未**加入 `scripts/install-skills.sh`；下次需要重裝時手動補 `npx skills add https://mcp-toolkit.nuxt.dev --agent claude-code -y`（或加到 install script 的第 7 個章節）
