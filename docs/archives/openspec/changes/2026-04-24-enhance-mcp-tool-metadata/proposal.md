## Why

本專案是 Agentic RAG，MCP client（Claude、Cursor、ChatGPT connectors）的 tool-selection 精準度直接決定回答品質；現況 4 個 tool（`askKnowledge` / `searchKnowledge` / `getDocumentChunk` / `listCategories`）只有 tool-level `name` / `title` / `description`，Zod 輸入欄位僅 `includeCounts` 有 `.describe()`，關鍵欄位 `query` / `citationId` 連 field-level 說明都沒有，也完全沒用到 MCP SDK 提供的 `annotations`（`readOnlyHint` / `destructiveHint` / `openWorldHint` / `idempotentHint`）與 `inputExamples`。對 LLM 而言，這三類 metadata 是決定「該叫誰 / 怎麼叫 / 能不能安全叫」的主要線索。本 change 是 `upgrade-mcp-to-durable-objects` 之外、獨立且低風險的 MCP 改善第一步。

## What Changes

- 4 個 tool 的 Zod input schema 補齊 field-level `.describe()`（`query` / `citationId` / `includeCounts` 均給明確語意、範例範圍、與 retrieval 行為線索）
- 4 個 tool 補 `annotations`（`readOnlyHint` / `destructiveHint` / `openWorldHint` / `idempotentHint`），對應 tool 語意（皆為 read-only、non-destructive、knowledge-bound）
- `askKnowledge` / `searchKnowledge` / `getDocumentChunk` 補 `inputExamples`，覆蓋「明確具體問題」「含類別關鍵字」「citation id 格式」等典型樣態
- `mcp-knowledge-tools` spec 新增 Requirement：tool SHALL expose LLM-consumable metadata（field description + annotations + input examples）以利 client tool-selection
- Integration test 新增 assertion：tool list 結果中每個 tool 有對應 metadata 欄位

## Non-Goals

- **NEVER** 動 `server/mcp/index.ts` 或 tool registration wiring — 與 `upgrade-mcp-to-durable-objects`（Phase 4）同檔並行會衝突
- **NEVER** 改 4 個 tool 的 handler 邏輯、retrieval path、scope 檢查或 response shape
- **NEVER** 引入 MCP prompts / resources / elicitation / sampling 能力（另有 discuss 候選 `discuss-mcp-resource-layer` 與 `discuss-mcp-elicitation-for-ask` 在 DO change archive 後才能 propose）
- **NEVER** 改動 tool `name`（會破壞既有 client 綁定）
- 不包含 eval harness — `add-mcp-tool-selection-evals` 為獨立 change

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mcp-knowledge-tools`: 新增 LLM-facing tool metadata 要求（field-level description、tool-level annotations、input examples）作為 tool discovery contract 的一部分

## Affected Entity Matrix

本 change 不觸動 DB schema、enum、shared types、或 migration。不需要 Entity Matrix。

## User Journeys

**No user-facing journey (backend-only, LLM-facing metadata enhancement)**

理由：本 change 純粹調整 MCP tool 的 discovery metadata（對 MCP SDK `tools/list` / `tools/call` 的 response payload），不新增 / 不修改 / 不移除任何 Web UI 頁面、管理介面、或 user-triggered 行為。MCP client（Claude / Cursor / ChatGPT connectors）會於 handshake 時取回新 metadata 並納入 LLM tool-selection，但本 change 不定義 client 端 UX。End user 可感知的唯一差異是「LLM 更常選對工具」的間接品質提升。

## Implementation Risk Plan

- Truth layer / invariants: MCP tool 契約由 `server/mcp/tools/*.ts` 的 `defineMcpTool({ ... })` 聲明定義；metadata shape 必須符合 `@nuxtjs/mcp-toolkit` 的 `McpToolDefinition` 型別（`annotations: ToolAnnotations` from MCP SDK、`inputExamples: Partial<ShapeOutput<InputSchema>>[]`）；不得偏離 `@modelcontextprotocol/sdk` 的 `ToolAnnotations` 欄位集合；**NEVER** 修改 `server/mcp/index.ts` 以避免與 `upgrade-mcp-to-durable-objects` Phase 4 衝突
- Review tier: **Tier 1** — 純 metadata enrichment、無 behavior change、無 DB / auth / permission 改動；self-review + 單一 code review 足夠
- Contract / failure paths: 無新 failure path；`annotations` / `inputExamples` 格式錯誤由 TypeScript compile-time 擋下；既有 handler 成功 / 錯誤 / scope-violation / 404 path 行為完全不變；MCP client 不支援 metadata 的降級路徑由 SDK 自行處理（metadata 為 optional）
- Test plan: Unit — 無（純 declaration，無邏輯可單獨測）；Integration — 擴充 `test/integration/mcp-routes.test.ts`（或新增 `test/integration/mcp-tool-metadata.spec.ts`）於 `tools/list` response 驗證 4 個 tool 皆含 expected annotations / inputExamples / field descriptions；Screenshot / Playwright — 無 UI change 不需要；Manual evidence — 以 MCP Inspector 或 Claude Desktop 驗證 handshake 後 tool metadata 正確顯示
- Artifact sync: `openspec/specs/mcp-knowledge-tools/spec.md`（透過 spec delta）；`HANDOFF.md`（archive 時移除 MCP Toolkit Review follow-ups 對應項）；`openspec/ROADMAP.md` Next Moves（archive 後自動反映）；無 migration、無 env var、無 runtime config、無 CHANGELOG（Tier 1 metadata-only）

## Impact

- Affected specs: `mcp-knowledge-tools`（Modified — 新增 tool metadata Requirement delta）
- Affected code:
  - Modified: `server/mcp/tools/ask.ts`, `server/mcp/tools/search.ts`, `server/mcp/tools/get-document-chunk.ts`, `server/mcp/tools/categories.ts`, `test/integration/mcp-routes.test.ts`（或新增獨立 metadata 測試檔）
  - New: 測試檔 path 由 tasks 階段決定（擴充既有 `mcp-routes.test.ts` 或新增 `test/integration/mcp-tool-metadata.spec.ts`）
  - Removed: (none)
- Dependencies / bindings: 無新套件、無 env var、無 runtime config、無 wrangler binding 變更
- Parallel change coordination: 與 `upgrade-mcp-to-durable-objects` 完全獨立（後者動 `server/mcp/index.ts` + 新增 DO transport；本 change 只動 4 個 tool 檔），可並行推進
