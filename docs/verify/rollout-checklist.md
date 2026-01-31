# Rollout Checklist — Governance & Retention

> 部署 staging / production 前的逐項確認，避免 cleanup schedule、retention threshold、purge policy 與 config snapshot 配置漂移。
>
> **適用範圍**：`governance-refinements` 產物（conversation lifecycle、retention cleanup、config snapshot governance）。
>
> **搭配文件**：
>
> - `docs/verify/staging-deploy-checklist.md` — 部署前 secrets / bindings 準備
> - `docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md` — config snapshot 版本比對細節
> - `docs/verify/ACCEPTANCE_RUNBOOK.md` — Phase 6 rate limit / config snapshot 驗證
>
> **規則**：此文件中的 checkbox 只能由執行人在驗證通過後勾選。若任一項不通過，**不得**繼續下一階段。

---

## 0. 前置準備

### 0.1 環境識別

- [ ] 0.1.1 確認目前部署目標（staging vs production）並記錄於 commit message / PR：
  - **staging**：`NUXT_KNOWLEDGE_ENVIRONMENT=staging`，允許較短 retention、backdated 資料測試
  - **production**：`NUXT_KNOWLEDGE_ENVIRONMENT=production`，僅允許配置檢視、禁止 backdated 資料
- [ ] 0.1.2 確認 `wrangler.jsonc` 的 `vars.NUXT_KNOWLEDGE_ENVIRONMENT` 與部署目標一致

驗證指令：

```bash
# 查看目前 wrangler.jsonc 中的環境變數
grep -A 6 '"vars"' wrangler.jsonc

# Staging 部署後查驗 runtime
curl -s "$BASE_URL/api/chat" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"message":"ping"}' | jq '.governance.environment'
# 預期：與 wrangler.jsonc 宣告一致（staging / production）
```

### 0.2 執行權限

- [ ] 0.2.1 確認執行人具備 `wrangler` D1 `--remote` 權限（需要 Cloudflare API Token）
- [ ] 0.2.2 確認執行人帳號在 `ADMIN_EMAIL_ALLOWLIST` 中（執行 `/api/admin/retention/prune` 需要 admin session）

驗證指令：

```bash
# 確認 wrangler 已登入並能讀取目標 D1
wrangler d1 execute agentic-rag-db --remote --command "SELECT 1 AS ok;"
# 預期：回傳 {"results":[{"ok":1}]}
```

---

## 1. 部署前 — Cleanup Schedule 設定

### 1.1 選定排程機制

依專案部署形態擇一，**不得同時啟用兩種**（避免重複清理、衝突鎖定）：

- [ ] 1.1.1 **方案 A**：Cloudflare Workers Cron Trigger（建議；原生支援 `cloudflare_module` preset）
- [ ] 1.1.2 **方案 B**：NuxtHub Scheduled Tasks
- [ ] 1.1.3 **方案 C**：外部排程器（cron / GitHub Actions / 其他）定時呼叫 `/api/admin/retention/prune`

### 1.2 方案 A — Cloudflare Workers Cron Trigger

若採用方案 A：

- [ ] 1.2.1 `wrangler.jsonc` 已加入 `triggers.crons` 設定，並指定與 `pruneKnowledgeRetentionWindow` 對應的 scheduled handler
- [ ] 1.2.2 Cron 表達式**使用 UTC**，若預期台灣時間凌晨執行，需換算（台灣 02:00 = UTC 18:00 前一天）
- [ ] 1.2.3 排程頻率符合 spec 需求：每日至少 1 次（建議每日 1 次，避免過度清理負擔）
- [ ] 1.2.4 已提交 change 並 review 過 `wrangler.jsonc` diff，不得在 production 部署前未經 review

驗證指令：

```bash
# 確認 wrangler.jsonc 含 triggers.crons
jq '.triggers' wrangler.jsonc 2>/dev/null

# 查看 Cloudflare Dashboard > Workers > 目標 Worker > Triggers，確認 cron 顯示
# 或使用 wrangler
wrangler deployments list --name nuxt-edge-agentic-rag
```

### 1.3 方案 B — NuxtHub Scheduled Tasks

若採用方案 B：

- [ ] 1.3.1 `server/tasks/` 下已建立對應 task 檔案並在 `nuxt.config.ts` 的 `hub.scheduled` 或等價配置中註冊
- [ ] 1.3.2 NuxtHub Admin 介面已能看到該 scheduled task

### 1.4 方案 C — 外部定時呼叫

若採用方案 C：

- [ ] 1.4.1 外部排程器已設定定時 POST `/api/admin/retention/prune`
- [ ] 1.4.2 呼叫使用的 session / token 具 admin 權限
- [ ] 1.4.3 排程器端已設定失敗告警（連續 2 次失敗通知維運）

驗證指令（所有方案共用）：

```bash
# 手動觸發一次 prune，確認 endpoint 正常
curl -s -X POST "$BASE_URL/api/admin/retention/prune" \
  -H "Cookie: $SESSION_COOKIE" | jq .
# 預期：{ "data": { "pruned": true, "retentionDays": 180 } }
```

### 1.5 Cleanup 日誌可觀察性

- [ ] 1.5.1 evlog / Cloudflare Workers log 能看到 `operation: 'prune-knowledge-retention'` 事件
- [ ] 1.5.2 失敗路徑會 `log.error` 且帶 `retentionDays` / `cutoff` context（不得沉默失敗）

---

## 2. 部署前 — Retention Threshold 設定

### 2.1 核心閾值

- [ ] 2.1.1 `query_logs` 保留 **180 天**（`pruneKnowledgeRetentionWindow` 預設；不得低於 180）
- [ ] 2.1.2 `messages` 保留與 `query_logs` 一致（審計鏈一致性，避免部分斷鏈）
- [ ] 2.1.3 `citation_records` 保留至其 `expires_at`（時間戳 >= 180 天 retention 起算）
- [ ] 2.1.4 `source_chunks.chunk_text` 保留至關聯 `citation_records.expires_at`，確保 replay 可回放
- [ ] 2.1.5 `mcp_tokens` revoked / expired 後 metadata redact（`token_hash` / `name` / `scopes_json` 已清空成 redacted 形式）

### 2.2 環境差異

- [ ] 2.2.1 **staging**：允許使用 shortened TTL / backdated records 做 cleanup 驗證（見 §5.2）
- [ ] 2.2.2 **production**：**不得** 使用 shortened TTL 或 backdated records；僅以配置檢視證明 parity

### 2.3 硬編驗證（避免 surface-specific drift）

- [ ] 2.3.1 確認沒有 route / test / component 硬編 `retentionDays`（唯一允許點：`server/utils/knowledge-retention.ts`）
- [ ] 2.3.2 若未來擴展為 env override，**必須**先在 `shared/schemas/knowledge-runtime.ts` 加入對應 config 欄位再改 handler，不得在 handler 直接讀 `process.env`

驗證指令：

```bash
# 掃描專案是否有硬編 180 或 retention day 數字
grep -rn "retentionDays" server/ shared/ --include="*.ts" \
  | grep -v "knowledge-retention.ts"
# 預期：無輸出，或僅出現測試檔案（test/**）

# 執行 governance drift 測試，確認 threshold 來源唯一
pnpm test test/unit/knowledge-governance-drift.test.ts
# 預期：全綠
```

---

## 3. 部署前 — Purge Policy 設定

### 3.1 Conversation Delete Purge

- [ ] 3.1.1 對話刪除 API 會同時清空 `conversations.title` 與 `messages.content_text`（不僅 soft delete）
- [ ] 3.1.2 刪除後，`/api/conversations` list 與 `/api/conversations/:id` detail 不再回傳該對話
- [ ] 3.1.3 刪除後，follow-up chat 不得再以被刪對話的 messages 組裝 model context
- [ ] 3.1.4 保留的 audit residue 僅含 redacted / marker 資料（`query_logs.query_redacted_text`、`risk_flags_json`），**不得** 含原始 `title` / `content_text`

驗證指令：

```bash
# 建立對話 → 刪除 → 確認 D1 已 purge
CONVERSATION_ID="..."

curl -s -X DELETE "$BASE_URL/api/conversations/$CONVERSATION_ID" \
  -H "Cookie: $SESSION_COOKIE"

wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, title, deleted_at FROM conversations WHERE id='$CONVERSATION_ID';"
# 預期：title 為 NULL 或 '[redacted]'，deleted_at 有值

wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, role, content_text, content_redacted FROM messages \
   WHERE conversation_id='$CONVERSATION_ID' LIMIT 5;"
# 預期：content_text 為 NULL 或 '[redacted]'，content_redacted 保留
```

### 3.2 Stale Follow-Up Revalidation

- [ ] 3.2.1 Follow-up 路徑會查詢最新 assistant message 的 `citations_json.document_version_id`
- [ ] 3.2.2 若該 version 已非 `is_current=1`，follow-up 會改走 fresh retrieval
- [ ] 3.2.3 僅在 version 仍 current 且對話未刪除時，才允許 same-document fast path

### 3.3 MCP Token Revoke

- [ ] 3.3.1 Token revoke 後立即拒絕後續呼叫（503 或 401，看 spec 定義）
- [ ] 3.3.2 Revoked token metadata 進入 retention window 後由 cleanup job redact
- [ ] 3.3.3 Audit log（`query_logs.status='limited' / 'rejected'`）保留足以追溯 revoke 事件

### 3.4 敏感資料遮罩

- [ ] 3.4.1 `query_logs.query_redacted_text` 不得含 credential / PII 原文
- [ ] 3.4.2 `messages.content_redacted` 不得含 credential / PII 原文
- [ ] 3.4.3 `risk_flags_json` 能正確反映觸發的規則類型

驗證指令：

```bash
# 查詢最近 query_logs 是否有未遮罩敏感字串（手動抽樣 5 筆檢查）
wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, channel, query_redacted_text, risk_flags_json, \
          redaction_applied, status \
   FROM query_logs ORDER BY created_at DESC LIMIT 5;"
```

---

## 4. 部署當下 — Config Snapshot Version 比對

### 4.1 部署後首次寫入版本

- [ ] 4.1.1 部署完成後，在 staging 觸發一次 Web chat + MCP ask，各取得一筆 query_logs
- [ ] 4.1.2 該筆 log 的 `config_snapshot_version` 與 Web / MCP response 中 `governance.configSnapshotVersion` **完全相同**
- [ ] 4.1.3 新版本字串中每個 governed 欄位（retrieval、thresholds、execution、models、features）都符合部署時的期望值

驗證指令：

```bash
# 依 CONFIG_SNAPSHOT_VERIFICATION.md §2.1 步驟執行
wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT id, channel, config_snapshot_version, created_at \
   FROM query_logs ORDER BY created_at DESC LIMIT 5;"

# 取得 Web response 的 governance 物件
curl -s -X POST "$BASE_URL/api/chat" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"message":"snapshot ping"}' | jq '.governance'
```

### 4.2 版本比對

- [ ] 4.2.1 比對上次部署時記錄的 snapshot version 與本次：
  - 若 governed 參數未變 → 版本應一致
  - 若有變更（threshold / model / flag）→ 版本應遞增，且差異項目可在 version 字串中清楚看出
- [ ] 4.2.2 舊版 query_logs 的 `config_snapshot_version` **未被回寫**（不可 backfill）

驗證指令：

```bash
# 比對舊版 vs 新版 log 的分布
wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT config_snapshot_version, COUNT(*) AS count \
   FROM query_logs \
   WHERE created_at >= datetime('now', '-1 hours') \
   GROUP BY config_snapshot_version;"
# 預期（如果剛改版）：應看到兩個版本，count 顯示新版只有新請求數量
```

### 4.3 Drift Guard 最終驗證

- [ ] 4.3.1 部署管線中已跑過 `pnpm test test/unit/knowledge-governance-drift.test.ts` 且全綠
- [ ] 4.3.2 部署管線中已跑過 `pnpm test test/unit/knowledge-governance.test.ts test/unit/knowledge-runtime-config.test.ts` 且全綠
- [ ] 4.3.3 若失敗，**不得**強制部署；需先修復 hardcoded value 或 config source

---

## 5. 部署後 24h 內 — 觀察與驗證

### 5.1 Cleanup Job 首次執行觀察

- [ ] 5.1.1 排程 cleanup job 首次執行後，evlog / Cloudflare Workers log 有對應 `operation: 'prune-knowledge-retention'` 事件
- [ ] 5.1.2 執行成功（無 `log.error`），耗時合理（staging < 30 秒、production < 60 秒）
- [ ] 5.1.3 執行後，D1 中 `created_at <= now - 180 days` 的 `query_logs` / `messages` 已清除
- [ ] 5.1.4 保留期內的 `citation_records` 仍可透過 `getDocumentChunk` 回放（replay 未被誤刪）

驗證指令：

```bash
# 檢查 cleanup 執行後 D1 狀態
wrangler d1 execute agentic-rag-db --remote --command \
  "SELECT \
     (SELECT COUNT(*) FROM query_logs WHERE created_at <= datetime('now','-180 days')) AS expired_logs, \
     (SELECT COUNT(*) FROM messages WHERE created_at <= datetime('now','-180 days')) AS expired_msgs, \
     (SELECT COUNT(*) FROM citation_records WHERE expires_at <= datetime('now')) AS expired_citations;"
# 預期：三個 count 皆為 0（cleanup 已清光過期資料）

# 抽樣確認 retention window 內的 citation 仍可回放（任挑一筆）
CITATION_ID="..."
curl -s "$BASE_URL/api/mcp/chunks/$CITATION_ID" \
  -H "Authorization: Bearer $MCP_TOKEN_FULL" | jq .
# 預期：200 + chunk content
```

### 5.2 Staging-only：Backdated Verification

**僅限 staging**（production 禁止）：

- [ ] 5.2.1 已執行 backdated record seed script（見 governance 2.4 實作）
- [ ] 5.2.2 seed 完成後 replay 仍成功（retention window 內）
- [ ] 5.2.3 下一次 cleanup run 後，該筆 backdated record 已被清除（replay 回傳 unavailable / 410）
- [ ] 5.2.4 verification 輸出（log / test artifact）記錄了 cleanup run timestamp 與使用的 threshold

### 5.3 Rate Limit 與敏感資料觀察

- [ ] 5.3.1 部署後 24h 內，`query_logs` 中 `status='limited'` 的筆數在預期範圍（無異常爆量代表 KV 設定正常）
- [ ] 5.3.2 抽樣 5 筆 `redaction_applied=1` 的記錄，確認 `query_redacted_text` 無原文敏感字串

### 5.4 Config Snapshot 穩定性

- [ ] 5.4.1 部署後 1 小時內，所有新 query_logs 的 `config_snapshot_version` 皆為**同一新版本**（代表無 runtime drift）
- [ ] 5.4.2 Web / MCP response 的 `governance.configSnapshotVersion` 仍與 log 一致（抽樣 3 次）

---

## 6. Rollback 條件

符合以下任一條件 → **立即 rollback** 到前一版部署：

- [ ] 6.1 Cleanup job 首次執行後，retention window 內的 `citation_records` 被誤刪（`getDocumentChunk` 大量 404）
- [ ] 6.2 Deleted conversation 的 `title` / `content_text` 仍在 D1 中以明文形式留存（purge policy 失效）
- [ ] 6.3 `config_snapshot_version` 在同一部署內出現超過一個版本（代表有 surface 未走 shared builder）
- [ ] 6.4 Drift guard 測試在部署後的 production log 中被觸發（有路徑硬編繞過）
- [ ] 6.5 Cleanup job 連續 3 次執行失敗（排程器告警觸發）
- [ ] 6.6 `/api/admin/retention/prune` 在 production 回傳 500 且 log 無法還原執行上下文

### Rollback 後必做事項

- [ ] 6.7 保留失敗當時的 D1 快照（匯出最近 24h log）供事後分析
- [ ] 6.8 建立對應 spectra change（`/spectra-propose`）或 `docs/solutions/` 紀錄，避免下次重蹈覆轍
- [ ] 6.9 在 rollout checklist 對應章節新增「特別注意事項」條目

---

## 7. 已知缺口（尚未覆蓋，需追蹤）

以下項目在 `governance-refinements` change 的 task 4.2 時點尚未完整可驗證，列於此供後續補齊：

- [ ] 7.1 `wrangler.jsonc` 目前**尚未**加入 `triggers.crons` — 等 task 2.2 完成後回填 §1.2 實際 cron 表達式
- [ ] 7.2 `NUXT_KNOWLEDGE_RETENTION_DAYS` env override 目前**不存在**（`knowledge-retention.ts` 內硬編 180）— 等 task 2.1 shared retention policy constants 完成後更新 §2.1 驗證指令
- [ ] 7.3 Conversation delete purge 的 API 實作（task 1.3-1.5）未完成 — §3.1 驗證指令需在 task 1.4 實作完成後補充實際欄位名稱
- [ ] 7.4 Stale resolver（task 1.1-1.2）未完成 — §3.2 的具體判定路徑需實作後補上 trace 指令
- [ ] 7.5 Backdated verification harness（task 2.4）未完成 — §5.2 的 seed script 路徑需等實作後填入

> **維護原則**：上述每項在對應 task 完成時，必須同步在本 checklist 補上具體驗證指令與檔案路徑，並將該項從「已知缺口」移至對應主章節。

---

## 8. 操作紀錄

每次部署後，執行人於下方新增一列（格式：`YYYY-MM-DD | 環境 | 執行人 | config snapshot version | 備註`）：

```text
| Date       | Env        | Operator | Config Snapshot Version | Notes |
| ---------- | ---------- | -------- | ----------------------- | ----- |
| YYYY-MM-DD | staging    | xxx      | kgov-v1;env=staging;... |       |
| YYYY-MM-DD | production | xxx      | kgov-v1;env=production; |       |
```
