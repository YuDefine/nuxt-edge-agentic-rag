# Retention Cleanup Verification

> 驗證 `retention-cleanup-governance` spec 的 180 天 retention 清理行為。涵蓋 `query_logs`、`citation_records`、`source_chunks.chunk_text` 與 MCP token metadata 四條資料鏈（governance 2.1-2.5）。
>
> **前提**：
>
> - 已依 `production-deploy-checklist.md` 部署完成（或具備 local 開發環境）
> - D1 `agentic-rag-db` 可透過 `wrangler d1 execute ... --remote` 操作
> - Admin Web token 可呼叫 `/api/admin/retention/prune`（或等價 endpoint）
> - 具備可用的 MCP token（non-restricted），用於 `getDocumentChunk` replay
>
> **規則**：人工檢查項目由使用者走完後回報 OK / 問題 / skip，Claude 才能代勾。
>
> **重要**：驗證不得污染 production。Backdated 測試**只在 local** 執行。

## 1. 情境總覽

| 驗證主題                    | Task     | 對應 Scenario                                              |
| --------------------------- | -------- | ---------------------------------------------------------- |
| 保留窗內 replay 仍可用      | 2.1, 2.3 | Cleanup preserves replayable evidence before expiry        |
| 過期後整條 audit chain 消失 | 2.1, 2.2 | Cleanup expires a complete audit chain after retention     |
| Backdated 加速驗證可行      | 2.4      | Local verifies expiry with backdated records               |
| Production 配置檢查無需造假 | 2.5      | Production verifies configuration without fake expiry runs |
| 共享 retention constants    | 2.1      | 清理 TTL / 閾值都來自單一 source of truth                  |

## 2. Retention Policy Constants 檢查（governance 2.1）

### 2.1 前置

檢查 retention 常數是否集中在共享模組。當前實作點：

- `server/utils/knowledge-retention.ts` — `retentionDays` 預設 180
- `server/utils/citation-store.ts` — `retentionDays` 預設 180
- `server/api/admin/retention/prune.post.ts` — response 回傳 `retentionDays: 180`

### 2.2 操作

1. 開 `shared/schemas/knowledge-runtime.ts`（或 governance 2.1 新建的 shared module），確認 retention 常數只在一處定義。
2. 在 `server/utils/**` 全庫搜尋 `180`：

   ```bash
   pnpm test test/unit/knowledge-governance-drift.test.ts
   ```

### 2.3 PASS 條件

- Drift guard test 全綠（沒有 server route / test / debug surface 自己硬寫 180）
- `retentionDays` 預設值來自 shared constant，不是散落在 handler

### 2.4 失敗排除

- 新檔案硬寫 `180` 或 `180 * 24 * 60 * 60 * 1000` → 回報 governance 2.1，補到 shared constant
- Drift guard 允許例外清單過長 → 檢查 `test/unit/knowledge-governance-drift.test.ts` 是否誤加白名單

## 3. Retention Window 內 Replay 驗證（governance 2.3）

### 3.1 前置

1. 確認環境（local 或 production）有一篇可問答的 internal 文件（可重用 `ACCEPTANCE_RUNBOOK.md` Doc A）。
2. 以 Web 提問，取得引用 `[1]` 並記錄：

   ```bash
   wrangler d1 execute agentic-rag-db --remote --command \
     "SELECT id, query_log_id, document_version_id, source_chunk_id, citation_locator, \
            created_at, expires_at \
      FROM citation_records \
      ORDER BY created_at DESC LIMIT 3;"
   ```

   記錄最新一筆的 `id` 作為 `<citation_id>`，`source_chunk_id` 作為 `<chunk_id>`，`document_version_id` 作為 `<version_id>`。

### 3.2 Replay 在 retention 內仍成功

**操作**：

1. 以 MCP token 呼叫 `getDocumentChunk({ documentId: ..., chunkId: <chunk_id> })`。
2. 同時（或立即）觸發一次 retention prune：

   ```bash
   curl -X POST https://agentic.yudefine.com.tw/api/admin/retention/prune \
     -H "Cookie: <admin session cookie>"
   ```

3. 再次呼叫 `getDocumentChunk`。

**PASS 條件**：

- 兩次呼叫都回傳原文 chunk（HTTP 200）
- D1 `citation_records` 對應 `<citation_id>` **仍存在**
- D1 `query_logs` 對應 `query_log_id` **仍存在**（< 180 天 cutoff）
- `source_chunks.chunk_text` 仍可讀

**驗證 D1**：

```bash
wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, created_at, expires_at FROM citation_records WHERE id = '<citation_id>';"

wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, channel, created_at FROM query_logs WHERE id = '<query_log_id>';"

wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, LENGTH(chunk_text) AS text_len FROM source_chunks WHERE id = '<chunk_id>';"
```

### 3.3 失敗排除

- Prune 後 replay 404 / citation 消失 → cleanup 太積極，governance 2.3 FAIL；檢查 `pruneKnowledgeRetentionWindow` 是否真的只刪 `expires_at <= now`
- `source_chunks.chunk_text` 被清空 → cleanup 未區分 retention 內外，governance 2.1/2.3 FAIL
- `query_logs` 整筆被刪 → cutoff 計算錯誤，governance 2.2 FAIL

## 4. Backdated 過期驗證（governance 2.4）

### 4.1 前置

**必須在 local 執行**（絕不可 production）。

目的：模擬超過 180 天的記錄，讓 cleanup 真的刪除，以驗證過期行為。

### 4.2 種入 backdated 資料

**方式 A — SQL 種資料**：以 local D1 直接寫入一筆過期 `citation_records` + 對應 `query_logs`：

```bash
# 以 200 天前的時間戳為例
OLD_TS="$(date -u -v-200d +"%Y-%m-%dT%H:%M:%SZ")"
OLD_EXPIRY="$(date -u -v-20d +"%Y-%m-%dT%H:%M:%SZ")"

wrangler d1 execute agentic-rag-db --remote --command \
  "INSERT INTO query_logs (id, channel, environment, query_redacted_text, \
     config_snapshot_version, status, created_at) \
   VALUES ('backdated-ql-$(date +%s)', 'web', 'local', '[backdated test]', \
     'kgov-backdated', 'accepted', '${OLD_TS}');"

# 以最新的 document_version_id 與 source_chunk_id 連接
wrangler d1 execute agentic-rag-db --remote --command \
  "INSERT INTO citation_records (id, query_log_id, document_version_id, source_chunk_id, \
     citation_locator, chunk_text_snapshot, created_at, expires_at) \
   VALUES ('backdated-cr-$(date +%s)', 'backdated-ql-<timestamp>', '<version_id>', '<chunk_id>', \
     'loc:0', '[backdated snapshot]', '${OLD_TS}', '${OLD_EXPIRY}');"
```

**方式 B — shortened TTL（governance 2.4 正式支援）**：

`POST /api/admin/retention/prune` 接受 optional body `{ "retentionDays": <1..180> }`。local 可傳入短值（例如 `retentionDays=1`）跑一次 prune，伺服器會把覆寫值穿透給 `runRetentionCleanup` 並在 response `data.retentionDays` 回傳實際使用的值。production 會 **400 拒絕** 任何 `retentionDays` 覆寫。

Helper script：

```bash
# local：用 1 天 TTL 做一次驗證 prune
npx tsx scripts/retention-prune.ts \
  --base-url http://localhost:3010 \
  --cookie "$ADMIN_SESSION_COOKIE" \
  --retention-days 1
```

Response 範例：

```json
{
  "data": {
    "pruned": true,
    "retentionDays": 1,
    "cutoff": "2026-04-17T12:00:00.000Z",
    "deleted": {
      "queryLogs": 3,
      "citationRecords": 5,
      "sourceChunkText": 0,
      "mcpTokenMetadata": 0
    },
    "errors": []
  }
}
```

**方式 C — 程式化種資料（governance 2.4 正式支援）**：

`server/utils/retention-seed.ts::seedBackdatedRetentionRecord` 是 typed helper，local 內可在 admin / setup endpoint 內呼叫（或寫一次性 tsx script）寫入 backdated `query_logs` + `citation_records`。Helper 會在 `environment === 'production'` 時 throw，避免誤用。

```ts
import { seedBackdatedRetentionRecord } from '#server/utils/retention-seed'

const seeded = await seedBackdatedRetentionRecord({
  database: await getD1Database(),
  environment: 'local',
  ageDays: 200,
  documentVersionId: '<existing dv id>',
  sourceChunkId: '<existing sc id>',
})
// seeded.queryLogId / seeded.citationRecordId / seeded.createdAt / seeded.expiresAt
```

### 4.3 觸發 prune 並驗證

```bash
# 預設 180 天 retention
curl -X POST http://localhost:3010/api/admin/retention/prune \
  -H "Cookie: <admin session cookie>"

# 或用 shortened-TTL helper
npx tsx scripts/retention-prune.ts \
  --base-url http://localhost:3010 \
  --cookie "$ADMIN_SESSION_COOKIE" \
  --retention-days 1

wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT COUNT(*) AS remaining FROM citation_records WHERE id LIKE 'backdated-cr-%';"

wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT COUNT(*) AS remaining FROM query_logs WHERE id LIKE 'backdated-ql-%';"

wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT COUNT(*) AS remaining FROM messages \
   WHERE query_log_id LIKE 'backdated-ql-%';"
```

### 4.4 PASS 條件

- Backdated `citation_records` 已刪（`remaining = 0`）— `expires_at <= now`
- Backdated `query_logs` 已刪（`remaining = 0`）— `created_at <= cutoff`
- 對應 `messages` 已刪或 `query_log_id` 被 `SET NULL`
- 其他 retention 內的記錄**未被誤刪**（抽查 §3.1 的 `<citation_id>` 仍存在）

### 4.5 失敗排除

- Backdated 仍存在 → cleanup 邏輯沒跑到對應表；檢查 `pruneKnowledgeRetentionWindow` 的 SQL
- Retention 內記錄也被刪 → cutoff 錯誤（例如用了 `<` 而非 `<=`，或時區錯算）
- MCP token metadata 未被清 → 檢查 `mcp_tokens` 更新 SQL 的 `revoked_at` / `expires_at` / `created_at` COALESCE 順序

### 4.6 Replay 過期契約

> 完整契約文件：`docs/verify/RETENTION_REPLAY_CONTRACT.md`。此處只列 local 操作步驟。

**操作**：

1. 對已被 cleanup 刪除的 backdated citation 呼叫 `getDocumentChunk`：

   ```bash
   curl -i -H "Authorization: Bearer $MCP_TOKEN" \
     http://localhost:3010/api/mcp/chunks/<deleted_citation_id>
   ```

2. 對一筆**仍在 retention 內但 `chunk_text_snapshot` 手動清空**的 citation 呼叫（模擬未來可能的 snapshot scrub policy）：

   ```bash
   wrangler d1 execute agentic-rag-db --remote --command \
     "UPDATE citation_records SET chunk_text_snapshot = '' WHERE id = '<retained_citation_id>';"

   curl -i -H "Authorization: Bearer $MCP_TOKEN" \
     http://localhost:3010/api/mcp/chunks/<retained_citation_id>
   ```

**PASS 條件**：

- 兩種情境都回 `HTTP/1.1 404`
- 兩種情境的 response body `message` 完全相同（`"The requested citation was not found"`）— **不洩漏**「此 citation 曾存在」訊息
- `x-replay-reason` header 可區分：
  - 情境 1：`x-replay-reason: chunk_not_found`
  - 情境 2：`x-replay-reason: chunk_retention_expired`
- 回應內不含 stack trace、DB error、或 `data.reason` body 欄位

**驗證完成後**：`DELETE FROM citation_records WHERE id = '<retained_citation_id>'` 清理 local 資料。

## 4A. Retention Boundary 驗證（governance 2.5）

> 驗證「retention window 邊界」的精確行為：剛好在 cutoff 前一秒的記錄應保留；剛好在 cutoff 當下或之後的記錄應被清除。

### 4A.1 操作（local only）

1. 使用 `retentionDays: 5` 短 TTL（避免等真的 180 天）：

   ```bash
   # 一筆在 5 天前 + 1 秒（保留 boundary 內）
   JUST_INSIDE="$(date -u -v-5d -v+1S +"%Y-%m-%dT%H:%M:%SZ")"
   # 一筆在 5 天前整（落在 cutoff 上，<=）
   RIGHT_ON="$(date -u -v-5d +"%Y-%m-%dT%H:%M:%SZ")"

   wrangler d1 execute agentic-rag-db --remote --command \
     "INSERT INTO query_logs (id, channel, environment, query_redacted_text, \
        config_snapshot_version, status, created_at) \
      VALUES ('boundary-inside-$(date +%s)', 'web', 'local', '[boundary inside]', \
        'kgov-boundary', 'accepted', '${JUST_INSIDE}'),\
             ('boundary-on-$(date +%s)', 'web', 'local', '[boundary on]', \
        'kgov-boundary', 'accepted', '${RIGHT_ON}');"
   ```

2. 對 `/api/admin/retention/prune` 傳 `retentionDays=5`（若 endpoint 支援 body 覆寫；否則用 wrangler cron 觸發 local 獨立 runner）：

   ```bash
   curl -X POST http://localhost:3010/api/admin/retention/prune \
     -H "Content-Type: application/json" \
     -H "Cookie: $ADMIN_COOKIE" \
     -d '{"retentionDays": 5}'
   ```

3. 驗證結果：

   ```bash
   wrangler d1 execute agentic-rag-db --remote --command \
     "SELECT id, created_at FROM query_logs WHERE id LIKE 'boundary-%';"
   ```

### 4A.2 PASS 條件

- `boundary-inside-*` **仍存在**（cutoff 是 `<=`，早 1 秒的 row 不算過期）
- `boundary-on-*` **已刪除**（精確落在 cutoff 上，被 `<=` 抓到）
- Response body 含 `deleted.queryLogs >= 1`

### 4A.3 Replay 邊界

同步對 retention-boundary 內的 citation 呼叫 `getDocumentChunk`：

**PASS**：仍 200 回傳完整 chunk（§3.2 保證）。若在 boundary 內卻 404，則 cleanup 邏輯誤 cascading。

## 5. MCP Token Metadata Cleanup（governance 2.1, 2.2）

### 5.1 前置

1. 在 local 建一個 MCP token（Admin UI 或 `/api/admin/mcp-tokens`）。
2. 在 D1 把它手動改為 200 天前 revoked：

   ```bash
   wrangler d1 execute agentic-rag-db --remote --command \
     "UPDATE mcp_tokens SET status = 'revoked', \
        revoked_at = datetime('now', '-200 days'), \
        revoked_reason = 'retention test' \
      WHERE id = '<token_id>';"
   ```

### 5.2 觸發 prune 並驗證

```bash
curl -X POST https://agentic.yudefine.com.tw/api/admin/retention/prune \
  -H "Cookie: <admin session cookie>"

wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, name, token_hash, scopes_json, revoked_reason \
   FROM mcp_tokens WHERE id = '<token_id>';"
```

### 5.3 PASS 條件

- `token_hash` 變為 `redacted:<id>`
- `name` 變為 `[redacted]`
- `scopes_json` 變為 `[]`
- `revoked_reason` 被保留（若原為空則填入 `retention-expired`）
- 該 token 的原始 hash / name **無法**由任何 API 還原

### 5.4 失敗排除

- token metadata 不動 → 檢查 cleanup SQL `WHERE` 條件（`status = 'revoked' OR status = 'expired' OR expires_at IS NOT NULL`）
- token_hash 清除但 name 留著 → SQL 漏改欄位
- 其他活躍 token 誤被清 → `revoked_at / expires_at / created_at` 的 COALESCE 邏輯錯誤

## 6. Production 配置檢查（governance 2.5）

**不得**在 production 執行 backdated 測試或實際觸發 prune。改採**配置可見性**驗證。

### 6.1 操作

1. 讀取 production 部署環境中 `retentionDays` 設定（透過 deploy artifact / secrets 或部署人員確認）。
2. 查詢 production `query_logs` 的時間分佈：

   ```bash
   wrangler d1 execute agentic-rag-db --remote --env production --command \
     "SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest, COUNT(*) AS total \
      FROM query_logs;"
   ```

3. 查詢 production `citation_records` 的 `expires_at` 分佈：

   ```bash
   wrangler d1 execute agentic-rag-db --remote --env production --command \
     "SELECT MIN(expires_at) AS earliest_expiry, MAX(expires_at) AS latest_expiry, \
            COUNT(*) AS total \
      FROM citation_records;"
   ```

### 6.2 PASS 條件

- `retentionDays` 設定與 local 相同（均為 180，或視部署而定）
- `query_logs.oldest` 不超過「今日 - retentionDays」太多（若超過，表示 prune 沒排程或排程失效）
- `citation_records.earliest_expiry` 不早於「今日」太多（若早於今日大量 → 同上）
- Cleanup schedule 本身可見（`wrangler.toml` `[triggers] crons`、NuxtHub scheduled task 設定或同等）

### 6.3 失敗排除

- `query_logs.oldest` 遠超 retention → cleanup 沒執行；檢查排程註冊、last run 時間
- retention 設定與 local 不同 → 環境差異；governance 2.5 FAIL
- Cleanup schedule 找不到 → governance 2.2 FAIL（未實作 scheduled cleanup job）

## 7. 回報格式

```
Retention §3 OK
Retention §4 OK
Retention §5 問題: token_hash 沒被 redact
Retention §6 skip（production 未開放查詢）
```

## 8. 常見陷阱

- 忘記 `--remote` → 改了 local sqlite，production 並未受影響
- Backdated 種資料後忘了清理 → 下次驗證混淆；建議驗證完成後刪除所有 `backdated-*` id
- `expires_at` 用錯單位（秒 vs. ms） → 過期判定全錯
- `source_chunks.chunk_text` 被誤刪 → 該欄位是 retention 內 replay 依據，不能因 cleanup 被碰
- 在 production 觸發 prune → **絕對禁止**，production 只走 §6 配置可見性
