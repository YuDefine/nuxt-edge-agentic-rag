# Retention Cleanup Runbook

> Operator-facing 日常作業手冊。涵蓋 scheduled job 觸發、手動觸發、執行結果查詢、錯誤排除與 rollback。對齊 `governance-refinements` §2.2 / §2.5，搭配 `RETENTION_CLEANUP_VERIFICATION.md`（local 完整驗證）與 `RETENTION_REPLAY_CONTRACT.md`（replay 契約）。

> **目標切換**：production 預設使用 `BASE_URL=https://agentic.yudefine.com.tw`、`DB_NAME=agentic-rag-db`、`WRANGLER_CONFIG=wrangler.jsonc`。若要對 staging 執行同型檢查，改設 `BASE_URL=https://agentic-staging.yudefine.com.tw`、`DB_NAME=agentic-rag-db-staging`、`WRANGLER_CONFIG=wrangler.staging.jsonc`。

## 1. 何時跑 cleanup

Cleanup 由以下兩條路徑觸發：

1. **自動排程（primary）**：Cloudflare Workers cron trigger。設定於對應 wrangler 設定檔（production 預設 `wrangler.jsonc`，staging 則看 `wrangler.staging.jsonc`）：

   ```jsonc
   "triggers": { "crons": ["0 3 * * *"] }
   ```

   每日 UTC 03:00（台灣時間 11:00）執行。Nitro 對應任務註冊於 `nuxt.config.ts` 的 `nitro.scheduledTasks`：

   ```ts
   scheduledTasks: {
      '0 3 * * *': ['retention-cleanup'],
   }
   ```

   實際任務程式碼：`server/tasks/retention-cleanup.ts` → 呼叫 `runRetentionCleanup`。

2. **手動觸發（admin-only）**：`POST /api/admin/retention/prune`，需要 admin session cookie。僅用於：
   - 新部署後補跑驗證
   - 發現排程失效時的一次性恢復
   - Local 進行 backdated 驗證

## 2. 四階段清理順序（audit chain）

單次 `runRetentionCleanup` 會依序執行：

1. `citation_records`：`DELETE WHERE expires_at <= now()`（注意是 row-level 的 `expires_at`，不是全域 cutoff）
2. `query_logs`：`DELETE WHERE created_at <= cutoff`（cutoff = `now - retentionDays days`）
3. `source_chunks.chunk_text`：`UPDATE SET chunk_text = '' WHERE created_at <= cutoff AND chunk_text <> ''`
4. `mcp_tokens`（非 live）：`UPDATE SET token_hash = 'redacted:' || id, name = '[redacted]', scopes_json = '[]', revoked_reason = COALESCE(revoked_reason, 'retention-expired') WHERE COALESCE(revoked_at, expires_at, created_at) <= cutoff AND (status='revoked' OR status='expired' OR expires_at IS NOT NULL) AND token_hash NOT LIKE 'redacted:%'`

每 step 獨立 try/catch — 一個 step 失敗不會阻塞後續 step。失敗資訊累積到 `result.errors[]`。

## 3. Retention 參數

| 常數                       | 值     | 來源                                          |
| -------------------------- | ------ | --------------------------------------------- |
| `DEFAULT_RETENTION_DAYS`   | 180    | `shared/schemas/retention-policy.ts`          |
| `query_logs` retention     | 180 天 | 同上                                          |
| `citation_records` expires | 180 天 | 在 `citation-store.ts::persistCitations` 寫入 |
| `source_chunks.chunk_text` | 180 天 | 同 `DEFAULT_RETENTION_DAYS`                   |
| `mcp_tokens` metadata      | 180 天 | 同 `DEFAULT_RETENTION_DAYS`                   |

任何更動 retention 天數 **必須** 改 `shared/schemas/retention-policy.ts`；禁止在 handler 或 test 內 hardcode（由 `knowledge-governance-drift` test 檢查）。

## 4. 正常路徑：確認 cleanup 執行成功

### 4.1 檢查 Wrangler triggers 有註冊

```bash
pnpm exec wrangler triggers list --config "${WRANGLER_CONFIG:-wrangler.jsonc}"
```

PASS：輸出包含 `0 3 * * *` 的 cron trigger，且指向目前檢查的 target worker。

### 4.2 檢查上次執行結構化 log

Cloudflare Workers tail：

```bash
pnpm exec wrangler tail --format=pretty --config "${WRANGLER_CONFIG:-wrangler.jsonc}"
```

觀察每日 03:00 UTC 的 entry，應看到：

```
[info] retention cleanup completed {
  retentionDays: 180,
  cutoff: '<ISO>',
  deleted: { queryLogs: X, citationRecords: Y, sourceChunkText: Z, mcpTokenMetadata: W },
  errors: 0
}
```

`errors: 0` 代表四 step 皆成功。

### 4.3 檢查 D1 狀態（sanity check）

```bash
wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest FROM query_logs;"

wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT MIN(expires_at) AS earliest_expiry FROM citation_records;"
```

PASS：

- `query_logs.oldest` 不超過 `now - 180 days` 太多（在正常 schedule 下 <= 24 小時誤差）
- `citation_records.earliest_expiry` 不早於 `now`（已過期的應被清除）

## 5. 手動觸發（local / 部署後補跑）

### 5.1 透過 HTTP endpoint

```bash
# Local
curl -X POST http://localhost:3010/api/admin/retention/prune \
  -H "Cookie: $ADMIN_SESSION_COOKIE"

# Remote（預設 production；若要驗 staging，先改 BASE_URL）
curl -X POST "${BASE_URL:-https://agentic.yudefine.com.tw}/api/admin/retention/prune" \
  -H "Cookie: $ADMIN_SESSION_COOKIE"
```

Response（`POST /api/admin/retention/prune`）：

```json
{
  "data": {
    "retentionDays": 180,
    "cutoff": "2025-10-20T00:00:00.000Z",
    "deleted": {
      "queryLogs": 0,
      "citationRecords": 0,
      "sourceChunkText": 0,
      "mcpTokenMetadata": 0
    },
    "errors": []
  }
}
```

### 5.2 透過 wrangler 直接觸發 cron handler

（Local 快速迭代用，不走認證門）

```bash
pnpm exec wrangler deploy --dry-run
pnpm exec wrangler trigger --cron "0 3 * * *"
```

## 6. 錯誤排除

### 6.1 `errors[].step = 'citationRecords'`

**症狀**：`result.errors` 含 `{ step: 'citationRecords', message: <...> }`

**檢查**：

1. D1 binding 是否仍在（`wrangler d1 list`）
2. `citation_records` table 結構是否完整（`wrangler d1 execute ... --command "PRAGMA table_info(citation_records);"`）
3. 是否有並發長交易鎖住 table

**Rollback**：step 失敗會中止該 step 但不影響後續 step。不會讓資料庫進入 partial state（SQL DELETE 是 atomic）。不需要 rollback。

### 6.2 `errors[].step = 'sourceChunkText'`

**症狀**：chunk_text scrub 失敗。

**檢查**：

1. `source_chunks.chunk_text` 是否有 NOT NULL constraint（應該有 — SQL 用 `''` 不是 `NULL`）
2. 是否有 INDEX 觸發 WAL 過大

**影響**：scrub 沒發生 → 原文仍在 DB。暫時不影響 compliance（仍在 180 天 window 外但未 scrub），但需儘快重跑。

**Rollback**：不需要，因為 UPDATE 只是把 text 設為空字串；失敗 = 沒事發生。下次 cron 會自動重試剩餘 expired rows（guard `chunk_text <> ''` 確保冪等）。

### 6.3 `errors[].step = 'mcpTokenMetadata'`

**症狀**：token metadata redact 失敗。

**影響**：舊 token 仍有原始 `token_hash` / `name` / `scopes_json`。雖然 token 已 revoked 不能用，但 metadata 仍可能洩漏 tenant 資訊。

**Rollback / Remediation**：

1. 單獨手動跑 UPDATE（以 `runRetentionCleanup` 的 SQL 為準）
2. 確認 `token_hash NOT LIKE 'redacted:%'` guard 仍讓下次 cron 重試

### 6.4 全部 step 完成但 `deleted.* = 0`

**可能原因**：

- 沒有過期資料（正常，特別是新部署）
- cutoff 計算錯誤（極少，因為 `computeRetentionCutoff` 有 test 覆蓋）
- 時區錯亂（所有 timestamp 都應為 UTC ISO 格式）

**檢查**：對比 `result.cutoff` 與手動計算 `now - 180 days`。

## 7. 不可做的事

- **NEVER** 在 production 塞 backdated 資料測 cleanup — 會讓 production audit chain 汙染。Backdated 測試**只**在 local。
- **NEVER** 手動 `DELETE FROM source_chunks` — cleanup 只 scrub text，row 保留給 `chunk_hash` / `citation_locator` 審計。直接 DELETE 會打斷 FK 關聯與 audit chain。
- **NEVER** 跳過 `chunk_text <> ''` guard — 失去冪等，cron 會每天 rewrite 相同 rows，膨脹 WAL。
- **NEVER** 在 `createError` 內傳 `data` 欄位回傳 cleanup 結果（洩漏內部細節）。Operator 資訊走 `result.errors[]` 與 structured log。
- **NEVER** 動 `wrangler.jsonc` 的 triggers — 變更 schedule 必須同步 `nuxt.config.ts` 的 `scheduledTasks`，兩邊不同步會讓 cron 失效。

## 8. 觀測

結構化 log 欄位：

| 欄位                       | 說明                                  |
| -------------------------- | ------------------------------------- |
| `retentionDays`            | 本次使用的 retention 天數（正常 180） |
| `cutoff`                   | 本次 cutoff 的 ISO 時間               |
| `deleted.queryLogs`        | step 2 刪除的 rows 數                 |
| `deleted.citationRecords`  | step 1 刪除的 rows 數                 |
| `deleted.sourceChunkText`  | step 3 scrub 的 rows 數               |
| `deleted.mcpTokenMetadata` | step 4 redact 的 rows 數              |
| `errors`                   | 失敗 step 數（期望 0）                |

若 `deleted.*` 數值突然暴漲或暴跌，表示上游寫入量有異常，需同步檢查 `query_logs` / `citation_records` 新增速率。

## 9. 相關文件

- `RETENTION_CLEANUP_VERIFICATION.md` — local 完整驗證流程（含 backdated）
- `RETENTION_REPLAY_CONTRACT.md` — `getDocumentChunk` 過期回應契約
- `rollout-checklist.md` — 部署前確認項
- `openspec/changes/governance-refinements/specs/retention-cleanup-governance/spec.md` — spec requirement 本體
- `shared/schemas/retention-policy.ts` — retention 常數 single source of truth
