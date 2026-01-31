# Conversation Lifecycle Verification

> 驗證 `conversation-lifecycle-governance` spec 在 staging / production 的真實行為。涵蓋 stale conversation resolver（governance 1.1-1.2）與 conversation delete purge（governance 1.3-1.5）兩條主線。
>
> **前提**：
>
> - staging 已依 `staging-deploy-checklist.md` 部署完成
> - D1 `agentic-rag-db` 可以 `wrangler d1 execute ... --remote` 查詢
> - Web Admin 帳號可登入且具備上傳、切版、刪除對話權限
> - 至少有一份 `access_level=internal` 文件可問答（對應 `ACCEPTANCE_RUNBOOK.md` 的 Doc A / Doc A'）
>
> **規則**：人工檢查項目由使用者走完後回報 OK / 問題 / skip，Claude 才能代勾。

## 1. 情境總覽

| 驗證主題                          | Task     | 對應 Scenario                                         |
| --------------------------------- | -------- | ----------------------------------------------------- |
| Stale follow-up 偵測              | 1.1, 1.2 | Current version change marks a conversation stale     |
| Same-document 快路徑              | 1.1, 1.2 | Same-document follow-up survives while current valid  |
| 刪除立即消失                      | 1.3      | Deleted conversation disappears from user surfaces    |
| `title` / `content_text` 不可回復 | 1.4      | Audit residue never restores original content         |
| Audit residue 不外洩              | 1.5      | 只能走稽核路徑，禁止回到一般 UI / API / model context |

## 2. Stale Conversation Resolver 驗證（governance 1.1-1.2）

### 2.1 前置

1. Admin 登入 Web，以 `ACCEPTANCE_RUNBOOK.md` Phase 2 上傳 **Doc A**（internal）。
2. 確認 Doc A 目前只有 1 個 current version：

   ```bash
   wrangler d1 execute agentic-rag-db --remote --command \
     "SELECT id, document_id, version_number, is_current \
      FROM document_versions \
      WHERE document_id = '<Doc A id>' \
      ORDER BY version_number;"
   ```

   僅有一筆 `is_current = 1`。

3. 進入 `/chat` 新建對話 C1，提問 Doc A 可答的問題 Q1，取得引用 `[1]`（記錄 `documentVersionId`）。
4. 記錄 C1 的 `conversation_id`（瀏覽器 URL 或 devtools / D1）。

### 2.2 Same-document follow-up 快路徑（版本未切換）

**操作**：

1. 在 C1 中對同一文件追問 Q2（Q2 仍可由 Doc A current version 回答）。
2. 觀察回答的引用版本。

**PASS 條件**：

- Q2 回答中的引用 `document_version_id` 與 Q1 相同
- D1 `query_logs` 對 Q1、Q2 兩筆可查到並列（同 conversation，快路徑命中）

  ```bash
  wrangler d1 execute agentic-rag-db --remote --command \
    "SELECT id, channel, status, created_at \
     FROM query_logs \
     WHERE channel = 'web' \
     ORDER BY created_at DESC LIMIT 4;"
  ```

- 沒有出現 stale 標記（參考 server log 的 `stale=false` 或對應欄位）

**失敗排除**：

- 若 Q2 重新做 fresh retrieval 但版本未切換 → 代表 resolver 過度保守；檢查 `stale resolver` 是否誤判
- 若 Q2 沿用舊 citation 但 citation 版本並非 current → Resolver 未觸發，檢查 `is_current` query 與 `citations_json.document_version_id` 的比對邏輯

### 2.3 版本切換後 follow-up 必走 fresh retrieval

**操作**：

1. Admin 對 Doc A 上傳新版 Doc A'（內容明顯不同、可回答 Q3）。
2. 確認切版完成：

   ```bash
   wrangler d1 execute agentic-rag-db --remote --command \
     "SELECT version_number, is_current, published_at \
      FROM document_versions \
      WHERE document_id = '<Doc A id>' \
      ORDER BY version_number;"
   ```

   舊版 `is_current = 0`，新版 `is_current = 1`。

3. 回到**同一個** C1 對話（不建立新對話），追問 Q3（只有 Doc A' 才能答）。
4. 觀察回答與引用。

**PASS 條件**：

- Q3 的回答來自 Doc A' 新版（內容對得上）
- Q3 的引用 `document_version_id` **等於新版**，**不是** Q1 / Q2 的舊版
- `query_logs` 最新一筆紀錄到 `channel='web'`、`conversation_id=C1`、且可由 server log（如 evlog）看到 stale 決策訊號（例如 `stale=true` 或等價欄位）
- 舊 assistant message 的 `citations_json` **不被回寫**（audit-safe，不得倒刪）

  ```bash
  wrangler d1 execute agentic-rag-db --remote --command \
    "SELECT id, role, LENGTH(content_redacted) AS content_len \
     FROM messages \
     WHERE query_log_id IN ( \
       SELECT id FROM query_logs ORDER BY created_at DESC LIMIT 6) \
     ORDER BY created_at;"
  ```

**失敗排除**：

- Q3 仍沿用舊版 → Resolver 沒重算；檢查 `shared resolver` 是否真的以 D1 `is_current` 為真相
- Q3 回答來自舊版內容（幻覺 + 舊 snapshot） → Fresh retrieval 沒跑；檢查 chat follow-up 分支
- Q3 引用混雜新舊版 → 排序/過濾錯誤，檢查 retrieval filter 是否排除 `is_current = 0`

### 2.4 回歸：再切回或雙版本

**操作**（optional，只在懷疑 resolver 時跑）：

1. 若平台允許回復舊版，把 Doc A 回切到 Doc A，再次在 C1 追問。
2. 觀察引用是否跟隨目前 current。

**PASS 條件**：引用 `document_version_id` 始終只會是 D1 當下 `is_current=1` 的那一版，不受對話歷史影響。

## 3. Conversation Delete Purge 驗證（governance 1.3-1.5）

### 3.1 前置

1. Admin 或 User 登入，進入 `/chat` 新建對話 C_DEL。
2. 以**可辨識關鍵字** `PURGE-CANARY-<timestamp>` 作為使用者問題，確保之後可在 D1 搜尋到該字樣是否真被清除。
3. 對話結束後，在 D1 確認該對話存在：

   ```bash
   wrangler d1 execute agentic-rag-db --remote --command \
     "SELECT id, title, deleted_at \
      FROM conversations \
      ORDER BY created_at DESC LIMIT 5;"
   ```

   該筆 `deleted_at` 應為 NULL。

### 3.2 刪除後立即從 user surfaces 消失

**操作**：

1. 從 `/chat` 左側對話列表點「刪除」C_DEL。
2. 重新整理頁面 / 等待 client 同步。
3. 檢查：
   - 左側對話列表**不再**出現 C_DEL
   - 直接在瀏覽器打 `/chat/<C_DEL id>` 應該 404 / redirect / 空狀態
   - 呼叫 `GET /api/conversations`（如適用）回傳不含 C_DEL
   - 呼叫 `GET /api/conversations/<id>`（如適用）回傳 404 或等價拒絕

**PASS 條件**：上述四項全部成立。若 `deleted_at` 已被寫入但 API 仍回傳 → filter 未加，governance 1.3 FAIL。

**D1 驗證**：

```bash
wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, title, deleted_at \
   FROM conversations \
   WHERE id = '<C_DEL id>';"
```

- `deleted_at` 應為非 NULL ISO 時間字串

### 3.3 `title` / `messages.content_text` 不可回復

**操作**：

刪除後 30 秒內（同一 cleanup 週期內或觸發 purge 後），執行：

```bash
wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, title, deleted_at \
   FROM conversations WHERE id = '<C_DEL id>';"

wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, role, content_redacted, LENGTH(content_redacted) AS content_len, risk_flags_json \
   FROM messages \
   WHERE query_log_id IN ( \
     SELECT id FROM query_logs WHERE created_at >= datetime('now', '-10 minutes')) \
   ORDER BY created_at;"
```

> **欄位對照**：governance spec 使用 `messages.content_text` 作為「原文」的語意名稱，當前 schema 將其存於 `messages.content_redacted`（已進行 redaction 的留存欄位）。此處驗證的是「刪除後該欄位是否被清空或以不可回復形式處理」。

**PASS 條件**：

- `conversations.title` **不得**是原本的自動標題或使用者第一則訊息片段；應為空字串、`[deleted]` 之類 placeholder、或欄位直接變 NULL
- `messages.content_redacted` **不得**包含 `PURGE-CANARY-<timestamp>` 或任何可還原原文的片段
- 全庫 grep 亦不可還原：

  ```bash
  wrangler d1 execute agentic-rag-db --remote --command \
    "SELECT COUNT(*) AS hits FROM messages WHERE content_redacted LIKE '%PURGE-CANARY-%';"
  ```

  `hits` 必須為 0

**失敗排除**：

- 只有 `deleted_at` 寫入但 title / content 不動 → purge policy 沒跑；governance 1.4 FAIL
- Title 被改為 placeholder 但 content 原文留著 → 不完整 purge；governance 1.4 FAIL
- Content 被清但仍可由 `citations_json` / `query_logs.query_redacted_text` 重組原文 → residue 設計有洞，governance 1.5 FAIL

### 3.4 Audit residue 不外洩到一般路徑

**操作**：

1. 以**相同使用者**身份登入，嘗試任何 UI / API path：
   - `/chat` 列表
   - `/chat/<C_DEL id>`
   - `/api/conversations`、`/api/conversations/<id>/messages`（如適用）
2. 模擬 follow-up：在**新對話**提問「我之前問過 PURGE-CANARY-... 的內容是什麼」，觀察 model response 是否洩漏原文。

**PASS 條件**：

- 一般使用者路徑全部**無法還原**原文
- Model 回答**不得**包含 `PURGE-CANARY-<timestamp>` 字樣（若包含 → context assembly 仍抓得到已刪對話，governance 1.5 FAIL）
- 僅稽核用 D1 表（如 `query_logs` 的 redacted 欄位、經 redaction 的 audit residue）可能保留，但內容應為 redacted 形式

**失敗排除**：

- 新對話 model 回覆含原文 → 檢查 chat context assembly 是否過濾 `conversations.deleted_at IS NOT NULL`
- 稽核表查得到明文 → 檢查 purge policy 是否對 `messages.content_redacted` 真的執行 clear / hard delete

## 4. Integration Test 對應

本文件為人工驗證；對應的自動化測試應落在：

- `test/integration/chat/stale-follow-up.test.ts`（或同等命名）— 驗證 §2
- `test/integration/conversations/delete-purge.test.ts`（或同等命名）— 驗證 §3

若自動化測試缺漏 → 回到 governance 1.6 任務補測。

## 5. 回報格式

每項檢查完成後，以下列格式回報：

```
Stale §2.2 OK
Stale §2.3 OK
Delete §3.2 OK
Delete §3.3 問題: title 被清但 content 仍含原文
Delete §3.4 skip（無法重現 follow-up 幻覺）
```

## 6. 常見陷阱

- `wrangler d1 execute` 忘加 `--remote` → 查到 local sqlite，看不到 staging 真實狀態
- 未等 purge 延遲完成（若為 async job）就查 D1 → 誤判為 FAIL；應在刪除後確認「delete policy 觸發形式」（sync on delete vs. scheduled sweep）
- `PURGE-CANARY-<timestamp>` 留在 browser localStorage / IndexedDB → 不是 server 殘留，應在**新 session / 無痕視窗**測試
- 測試期間其他使用者同時在用 staging → 可能污染最新 `query_logs`，應以 `conversation_id` 或 timestamp 限縮查詢
