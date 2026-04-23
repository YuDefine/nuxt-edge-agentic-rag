# Retention Replay Contract

> 定義 `getDocumentChunk`（`GET /api/mcp/chunks/:citationId` 與 `GET /api/citations/:citationId`）在 retention window 過期前後的回應契約。對齊 `governance-refinements` §2.3 與 `mcp-knowledge-tools` spec Requirement: Stateless Ask And Replay。

## 1. 核心原則

1. **HTTP status code 由 spec 固定**：`200` / `403` / `404`。不新增 `410`，因為 `mcp-knowledge-tools` spec 明寫 `getDocumentChunk SHALL return 404 only when the citationId is absent or no longer replayable`。
2. **存在感不洩漏**：客戶端只能從 `statusCode` 判斷「可讀 / 不可讀」，不能靠 status code 差異反推「這個 id 曾經存在過」。
3. **reason 細化交給 audit**：sub-state 透過 `x-replay-reason` response header 與 server-side structured log 暴露，供 audit / operator 區分使用。

## 2. 狀態表

| 情境                                                                       | HTTP | `x-replay-reason`           | Body                                                                       |
| -------------------------------------------------------------------------- | ---- | --------------------------- | -------------------------------------------------------------------------- |
| Retention 內、有權限、snapshot 未空                                        | 200  | 不設定                      | `{ data: { chunkText, citationId, ... } }`                                 |
| `citationId` 不存在（從未 persist、或 cleanup 刪除 citation_records 整筆） | 404  | `chunk_not_found`           | `{ message: "The requested citation was not found" }`                      |
| Citation row 仍在但 `chunk_text_snapshot === ''`（防禦性 guard）           | 404  | `chunk_retention_expired`   | `{ message: "The requested citation was not found" }`                      |
| 權限不足（restricted 但 token 無 `knowledge.restricted.read`）             | 403  | `restricted_scope_required` | `{ message: "The requested citation requires knowledge.restricted.read" }` |
| 未攜帶 / 無效 bearer token                                                 | 401  | 不設定                      | McpAuthError message                                                       |
| 帶 `MCP-Session-Id` header（v1.0.0 禁用）                                  | 400  | 不設定                      | `{ message: "MCP session state is not supported in v1.0.0" }`              |

## 3. Retention 過期的兩種路徑

目前實作中，citation 過期最常見的路徑是**citation row 整筆被刪**：

1. `runRetentionCleanup` step 1 執行 `DELETE FROM citation_records WHERE expires_at <= ?`。
2. `findReplayableCitationById` 的 SQL 再加上 `cr.expires_at > ?` filter，因此查不到 → 回 `null`。
3. `getDocumentChunk` 將 null 結果轉為 `McpReplayError('...not found', 404, 'chunk_not_found')`。

**第二條路徑是防禦性的**（未來 governance policy 可能追加）：

1. 某次 governance sweep 決定保留 `citation_records` row 但 scrub `chunk_text_snapshot`（例如為了保留 FK 與 `citation_locator` 審計鏈）。
2. `findReplayableCitationById` 正常回傳物件，但 `chunkTextSnapshot === ''`。
3. `getDocumentChunk` 必須拒絕回傳 empty 200，改丟 `McpReplayError('...not found', 404, 'chunk_retention_expired')`。

第二條路徑目前**不會被生產環境觸發**（cleanup 只 scrub `source_chunks.chunk_text`，不動 `citation_records.chunk_text_snapshot`），但實作已就位，避免未來 policy 異動造成 empty 200 回傳。

## 4. Audit 區分

| 信號                                    | 暴露對象               | 目的                                                                        |
| --------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| HTTP status (200/403/404)               | 所有 client            | 合約化的成功 / 失敗指示                                                     |
| `x-replay-reason` header                | 所有 client            | 讓對存在感不敏感的 operator 可程式化判別子狀態                              |
| `McpReplayError.reason`                 | server-side code       | 後續 audit store 或 logging 使用                                            |
| `query_logs.status=blocked`（403 path） | admin query log 閱讀者 | restricted scope 被拒絕的稽核紀錄（見 handler 的 `createAcceptedQueryLog`） |

## 5. 實作位置

- `server/utils/mcp-replay.ts` — `getDocumentChunk`、`McpReplayError`、`McpReplayErrorReason`
- `server/api/mcp/chunks/[citationId].get.ts` — MCP route handler，setResponseHeader 的位置
- `server/api/citations/[citationId].get.ts` — Web route handler；目前直接用 `createError` 404/403，未設 reason header（web surface 主要給 admin UI，audit 依 log 即可）
- `test/unit/mcp-replay.test.ts` — pure function 契約驗證（6 cases）
- `test/integration/get-document-chunk-replay.test.ts` — route handler 契約驗證（6 cases）

## 6. 驗證步驟

對應 `docs/verify/RETENTION_CLEANUP_VERIFICATION.md` §3 與 §4.6。

### 6.1 單元契約

```bash
pnpm exec vp test run test/unit/mcp-replay.test.ts
pnpm exec vp test run test/integration/get-document-chunk-replay.test.ts
```

PASS：上述 12 個 case 全綠（含 5 個任務指定情境與 1 個 MCP session state 例外）。

### 6.2 實機驗證（local、staging 或 production）

1. 選一個 retention 窗內有效的 `citationId`，以 MCP token 呼叫：

   ```bash
   curl -i -H "Authorization: Bearer $MCP_TOKEN" \
     "${BASE_URL:-https://agentic.yudefine.com.tw}/api/mcp/chunks/$CITATION_ID"
   ```

   PASS：`HTTP/1.1 200 OK`、body 含 `chunkText`、**無** `x-replay-reason` header。

2. 改請求不存在的 citation id：

   ```bash
   curl -i -H "Authorization: Bearer $MCP_TOKEN" \
     "${BASE_URL:-https://agentic.yudefine.com.tw}/api/mcp/chunks/citation-does-not-exist-xxxxxxxx"
   ```

   PASS：`HTTP/1.1 404`、header 含 `x-replay-reason: chunk_not_found`。

3. 若需驗證 retention-expired scrubbed 情境（§4.6 local 專用）：對一筆 backdated citation，將 `chunk_text_snapshot` 手動 UPDATE 成空字串後重試：

   ```bash
   wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
     "UPDATE citation_records SET chunk_text_snapshot = '' WHERE id = '<citationId>';"

   curl -i -H "Authorization: Bearer $MCP_TOKEN" \
     "${BASE_URL:-https://agentic.yudefine.com.tw}/api/mcp/chunks/<citationId>"
   ```

   PASS：`HTTP/1.1 404`、header 含 `x-replay-reason: chunk_retention_expired`、body message 與 case 2 完全相同（存在感不洩漏）。

   **清理**：驗證完畢請 DELETE 該筆 backdated citation。

4. 以**無 `knowledge.restricted.read` scope** 的 token 對 restricted citation 呼叫：

   PASS：`HTTP/1.1 403`、header 含 `x-replay-reason: restricted_scope_required`、D1 `query_logs` 出現對應的 `status='blocked'` 紀錄。

## 7. 常見陷阱

- **把 reason 放進 `createError` data 欄位** → 違反 `.claude/rules/error-handling.md`「NEVER 在 `createError()` 中傳遞 `data`」。用 `setResponseHeader` 而非 `data`。
- **在 retention-expired 時回 410** → 違反 `mcp-knowledge-tools` spec「SHALL return 404 only when ...absent or no longer replayable」。HTTP status 必須固定 404。
- **在 body message 中加 `(retention-expired)` 字樣** → 洩漏存在感，違反 §4.6 PASS 條件「response 與正常 404 完全一致」。
- **只在 unit test mock pure function、漏補 route-level integration test** → `setResponseHeader` 的 plumbing 不會被 unit test 覆蓋。必須有 route handler integration test。
