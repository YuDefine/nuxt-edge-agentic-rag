## 1. Tool metadata 宣告（支援 Tool Discovery Metadata — 4 檔並行）

- [x] 1.1 [P] `server/mcp/tools/ask.ts`：為 askKnowledge 宣告 Tool Discovery Metadata — `query` 欄位補 `.describe()`（說明自然語言 retrieval 語意、建議表達方式、限制 4000 字）；tool 補 `annotations`（`readOnlyHint: true`、`destructiveHint: false`、`openWorldHint: false`、`idempotentHint: true`）；補 `inputExamples` 至少兩筆（具體主題 query + 含類別關鍵字 query）
- [x] 1.2 [P] `server/mcp/tools/search.ts`：`query` 欄位補 `.describe()`（說明回傳 ranked passages、限制 2000 字、與 askKnowledge 差異）；tool 補 `annotations`（同上語意）；補 `inputExamples` 至少兩筆（含 specific-topic 與 category-flavored 樣態）
- [x] 1.3 [P] `server/mcp/tools/get-document-chunk.ts`：`citationId` 欄位補 `.describe()`（說明只接受由 askKnowledge / searchKnowledge 回傳的 citation id、restricted 權限規則、錯誤碼行為）；tool 補 `annotations`；補 `inputExamples` 至少一筆（以 placeholder citation id 格式示範）
- [x] 1.4 [P] `server/mcp/tools/categories.ts`：既有 `includeCounts` `.describe()` 文案補強；tool 補 `annotations`；因輸入過於 trivial，`inputExamples` 可略（spec 不要求）

## 2. Integration 測試擴充（Tool Discovery Metadata 驗證）

- [x] 2.1 於 `test/integration/mcp-routes.test.ts`（或新增 `test/integration/mcp-tool-metadata.spec.ts`）新增 `tools/list` assertion：每個 tool 的 `inputSchema.properties.<field>.description` 皆為 non-empty string，且不得為 `"TBD"` / `"TODO"` / 空 placeholder
- [x] 2.2 同檔擴充 annotation assertion：`askKnowledge` / `searchKnowledge` / `getDocumentChunk` / `listCategories` 之 `annotations.readOnlyHint === true` 且 `annotations.destructiveHint === false`，並驗證 `openWorldHint` 與 `idempotentHint` 符合 proposal 表格
- [x] 2.3 同檔擴充 `inputExamples` assertion：`askKnowledge` / `searchKnowledge` / `getDocumentChunk` 各至少一筆 example；對每筆 example 以對應 tool 的 Zod `inputSchema` 執行 parse，必須全部通過
- [x] 2.4 跑 `pnpm test:integration`（MCP 相關 test）確認既有 handler 成功 / 錯誤 / scope-violation / 404 path 行為完全不變（對應 scenario「Metadata enrichment preserves handler behavior」）

## 3. 驗證與品質閘門

- [x] 3.1 `pnpm check` 全綠（format + lint + typecheck + test）
- [x] 3.2 `pnpm spectra:followups` 無新 drift、`pnpm audit:ux-drift` 無新 enum drift（本 change 不動 enum，應自然通過）
- [ ] 3.3 以 MCP Inspector 或 Claude Desktop 連線，handshake 後檢查 `tools/list` 回傳含新 `description` / `annotations` / `inputExamples`，並確認 tool `name` 仍為 `askKnowledge` / `searchKnowledge` / `getDocumentChunk` / `listCategories`

## 4. 人工檢查

- [ ] 4.1 使用者逐段 review 4 個 tool 的 field-level `.describe()` 文案，確認能幫助 LLM 理解 retrieval 語意與輸入限制
- [ ] 4.2 使用者確認 `inputExamples` 樣本覆蓋典型使用情境（至少 specific-topic 與 category-flavored 兩種；不出現 PII 或敏感內容）
- [ ] 4.3 使用者確認 `annotations` 值對齊 handler 實際行為（特別是 `openWorldHint` 是否反映「只查 governed knowledge corpus，不訪外網」）
