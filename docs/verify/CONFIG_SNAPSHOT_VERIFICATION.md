# Config Snapshot Verification

> 驗證 `configSnapshotVersion` 在 Web、MCP、query logs 三個表面的一致性，以及 drift guard 能否阻擋硬編的 decision threshold。
>
> **Scope**：governance 3.x 產物。本文件專注於 config snapshot；governance 1.x（conversation lifecycle）、2.x（retention cleanup）的驗證分別在：
>
> - [`CONVERSATION_LIFECYCLE_VERIFICATION.md`](./CONVERSATION_LIFECYCLE_VERIFICATION.md)
> - [`RETENTION_CLEANUP_VERIFICATION.md`](./RETENTION_CLEANUP_VERIFICATION.md)

## 1. Config Snapshot Version 是什麼

`configSnapshotVersion` 是一串由 `buildKnowledgeConfigSnapshotVersion`（`shared/schemas/knowledge-runtime.ts`）組合而成的字串，序列化當下影響 agent orchestration 的所有 governed 參數：

```text
kgov-v1;env=local;retrieval.maxResults=8;retrieval.minScore=0.20;thresholds.directAnswerMin=0.68;thresholds.judgeMin=0.55;thresholds.answerMin=0.40;execution.maxSelfCorrectionRetry=1;models.defaultAnswer=@cf/meta/llama-3.1-8b-instruct;models.agentJudge=@cf/meta/llama-3.3-70b-instruct-fp8-fast;features.adminDashboard=on;features.cloudFallback=off;features.mcpSession=on;features.passkey=off
```

**Write points**：

| 位置                                 | 欄位 / 來源                       | 目的                               |
| ------------------------------------ | --------------------------------- | ---------------------------------- |
| `query_logs.config_snapshot_version` | `server/utils/knowledge-audit.ts` | 審計每次查詢跑在哪個治理配置之下   |
| Web chat response（governance 物件） | `server/utils/web-chat.ts`        | 前端可對照當前 runtime 與 log 一致 |
| MCP `askKnowledge` response          | `server/utils/mcp-ask.ts`         | MCP 客戶端可讀取版本比對           |

## 2. 驗證清單（Local / Staging / Production）

**前置**：確認已依 `production-deploy-checklist.md` / `DEPLOYMENT_RUNBOOK.md` 部署完成目標環境（或具備 local 開發環境），且 D1 有實際 query_logs。若以 remote staging 驗證，先設 `DB_NAME=agentic-rag-db-staging`。

### 2.1 Runtime 一致性（Web × MCP × D1）

1. 以 Web User 登入該環境，在 `/chat` 問一題可直接命中的問題（如 `A01` fixture）。
2. 用 MCP token 對同樣問題呼叫 `askKnowledge`。
3. 查 D1：

   ```sql
   SELECT id, channel, config_snapshot_version, created_at
   FROM query_logs
   ORDER BY created_at DESC
   LIMIT 5;
   ```

4. **PASS 條件**：
   - 兩筆 log（`channel='web'` 與 `channel='mcp'`）的 `config_snapshot_version` **完全相同**
   - Web chat response 的 `governance.configSnapshotVersion` 與 log 相同
   - MCP `askKnowledge` response 的 `governance.configSnapshotVersion` 與 log 相同

### 2.2 Version Bump 後新 log 使用新版本

1. 在該環境變更任一 governed 參數（例如將 `NUXT_KNOWLEDGE_THRESHOLD_JUDGE_MIN` 從 `0.55` 改為 `0.56`）並重新部署。
2. 再觸發一次問答。
3. 查 D1：

   ```sql
   SELECT config_snapshot_version, COUNT(*) AS count
   FROM query_logs
   WHERE created_at >= datetime('now', '-10 minutes')
   GROUP BY config_snapshot_version;
   ```

4. **PASS 條件**：
   - 出現兩個不同的 `config_snapshot_version`（舊 + 新）
   - 新 version 字串中 `thresholds.judgeMin=0.56`
   - 舊 log 的 version 保留不動（不可回寫）

### 2.3 環境差異

1. 比對至少兩個環境的 version 字串（例如 local `env=local`、staging `env=staging`、production `env=production`）。
2. **PASS 條件**：除了 `env=` 欄位不同，其他欄位可能因預設 override 而不同，但**不得出現** 某環境的 `env=` 被寫到另一個環境的 D1。

## 3. 自動化 Drift Guard

Drift guard 阻擋 routes、tests、debug surfaces 直接硬編 decision threshold 數值，強制從 `shared/schemas/knowledge-runtime.ts` import。

### 3.1 執行

```bash
pnpm test test/unit/knowledge-governance-drift.test.ts
```

### 3.2 掃描範圍

- `server/api/**`
- `server/utils/**`
- `test/**`
- `app/components/**`
- `app/composables/**`
- `app/pages/**`

### 3.3 Allowed exceptions

只有以下檔案允許出現硬編數值（因為它們是 canonical source 或測試 canonical source 本身）：

- `shared/schemas/knowledge-runtime.ts`
- `test/unit/knowledge-governance-drift.test.ts`
- `test/unit/knowledge-governance.test.ts`
- `test/unit/knowledge-runtime-config.test.ts`

### 3.4 PASS 條件

- Test 全綠
- 在非 allowed 檔案加入 `0.2` / `0.68` / `0.55` / `0.4` / `8` 等 governed 數值 → test 應當場 FAIL

### 3.5 Regression test：跨 surface 一致性

```bash
pnpm test test/unit/knowledge-governance.test.ts test/unit/knowledge-runtime-config.test.ts
```

驗證：

- `createKnowledgeRuntimeConfig({ env: 'local' })` 產出的 snapshot 與 MCP / Web 兩路寫入邏輯使用同一個 builder
- Version bump 只需調整 input 參數，字串格式不會漂移（`kgov-v1` prefix、分隔符、欄位順序）

## 4. Bump Protocol

當改動 governed 參數時：

1. **開 `shared/schemas/knowledge-runtime.ts`** — 只能透過修改 `DEFAULT_KNOWLEDGE_*` 或 env 覆寫改值，**不得**在 handler / component 直接寫數字
2. 跑 `pnpm test test/unit/knowledge-governance-drift.test.ts` 確認沒有新 drift
3. 在該環境部署後跑本文件 §2 的驗證
4. **保留舊 log 的 old version**（審計用），**不要** backfill

## 5. 人工驗收對應

本文件的驗證直接支援 `bootstrap-v1-core-from-report` 的人工檢查：

- **#5 `query_logs` 檢查**：§2.1 的第 4 步涵蓋（確認 web/mcp 兩路 log 的 config snapshot 一致、未出現明文敏感資料）

## 6. Governance Surface 交叉驗證

除了 §2-§3 的 web/mcp/D1 三表面一致性，本段驗證 config snapshot 對 governance 1.x、2.x 行為的覆蓋與隔離。

### 6.1 Stale resolver 不影響 snapshot version

**前置**：完成 `CONVERSATION_LIFECYCLE_VERIFICATION.md` §2.3（版本切換後 follow-up 走 fresh retrieval）。

**操作**：

1. 查 Q1（切版前）與 Q3（切版後）兩筆 `query_logs`：

   ```bash
   wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
     "SELECT id, config_snapshot_version, created_at \
      FROM query_logs \
      ORDER BY created_at DESC LIMIT 6;"
   ```

**PASS 條件**：

- Q1、Q3 兩筆的 `config_snapshot_version` 相同（因 governed 參數未變，僅 document 版本變）
- Document 版本切換**不應**觸發 snapshot bump
- 若兩筆 version 不同 → 誤將 document version 寫入 snapshot，governance 3.1 FAIL

### 6.2 Conversation delete 不回寫舊 log 的 snapshot

**前置**：完成 `CONVERSATION_LIFECYCLE_VERIFICATION.md` §3.2-§3.3（刪除 C_DEL 並確認 purge）。

**操作**：

1. 查 C_DEL 相關 `query_logs`（即使被 purge policy 清理過）：

   ```bash
   wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
     "SELECT id, config_snapshot_version, status \
      FROM query_logs \
      WHERE created_at >= datetime('now', '-1 hour') \
      ORDER BY created_at DESC LIMIT 20;"
   ```

**PASS 條件**：

- 就算 `query_redacted_text` 被 redact / clear，`config_snapshot_version` 應保留不動
- 不得因刪除而把版本戳改為 `null` / `[redacted]`
- 若 version 欄位也被清 → cleanup 誤刪 audit metadata，governance 1.5 / 3.1 FAIL

### 6.3 Retention prune 不改 snapshot version 本身

**前置**：完成 `RETENTION_CLEANUP_VERIFICATION.md` §3.2（prune 後 retention 內 replay 仍成功）。

**操作**：

1. Prune 前後查 retention 內的 `query_logs.config_snapshot_version`：

   ```bash
   wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
     "SELECT id, config_snapshot_version, created_at \
      FROM query_logs \
      WHERE created_at >= datetime('now', '-7 days') \
      ORDER BY created_at DESC LIMIT 20;"
   ```

**PASS 條件**：

- Prune 不改 retention 內 `config_snapshot_version` 欄位值
- 只有超過 180 天的整筆 `query_logs` 被刪，未過期者保留原 version 字串
- 若保留筆數中出現 version 被改寫 → prune SQL 誤用 UPDATE 而非 DELETE，governance 2.2 / 3.1 FAIL

### 6.4 Backdated 測試保留舊 version 字串

**前置**：完成 `RETENTION_CLEANUP_VERIFICATION.md` §4.2（種入 backdated 記錄）。

**操作**：在種入時刻意用與當前不同的 snapshot version（例如 `kgov-backdated`）。

**PASS 條件**：

- Prune 只依 `created_at` cutoff 判定，**不讀** `config_snapshot_version`
- 若某 backdated 筆 version 字串較新（artificially），仍應依時間被刪
- 若 prune 行為依 version 判定 → governance 3.1 與 2.1 FAIL（清理策略不得被 version 字串影響）

## 7. 常見陷阱

- Local 與 production 共用同一 `env=` 字串 → 交叉污染；確認 `NUXT_KNOWLEDGE_ENVIRONMENT` 或等價設定
- 手動改 `thresholds.judgeMin` 但忘記升版 → 舊 log 仍顯示舊 version，後續比對才發現；改前先跑 `pnpm test test/unit/knowledge-governance.test.ts`
- 把 `config_snapshot_version` 當 free-form 字串寫進 handler → drift guard test 抓不到（drift guard 檢查的是 decision threshold 硬碼，非 version 字串本身），應在 code review 時特別留意
- Web / MCP response 的 version 與 query_logs 不同 → 多半是 builder 被 clone 而非共用，governance 3.1 FAIL

## 8. Risk Flags Audit Trail

> 由 `tc-acceptance-followups` 新增。`query_logs.risk_flags_json` 現在記錄兩個新 flag：MCP 越權的 `restricted_scope_violation` 與高風險 PII 的 `pii_credit_card`。本節說明觸發條件、wrangler 查法、與誤判評估 SOP。

### 8.1 `restricted_scope_violation` — MCP 越權稽核

**觸發條件**：MCP 客戶端持有未包含 `knowledge.restricted.read` 的 token，呼叫 `getDocumentChunk` 嘗試 replay 一筆 `source_chunks.access_level='restricted'` 的 citation。

**寫入路徑**：

| 位置                                                                 | 行為                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `server/utils/mcp-replay.ts::getDocumentChunk`                       | 在 throw `McpReplayError(403, 'restricted_scope_required')` 前呼叫 hook |
| `server/mcp/tools/get-document-chunk.ts::onRestrictedScopeViolation` | 呼叫 `createBlockedRestrictedScopeQueryLog` INSERT query_logs           |
| `server/utils/mcp-ask.ts::createBlockedRestrictedScopeQueryLog`      | 綁定 `risk_flags_json=["restricted_scope_violation"]`                   |

**Row shape**：

```text
channel                 = 'mcp'
status                  = 'blocked'
risk_flags_json         = '["restricted_scope_violation"]'
mcp_token_id            = <violating token id>
query_redacted_text     = 'getDocumentChunk:<citationId>'
config_snapshot_version = <same chain as accepted rows>
decision_path           = 'restricted_blocked'
refusal_reason          = 'restricted_scope'
```

**Schema drift 說明**：`query_logs` 目前沒有專屬 `attempted_citation_id` 欄位，改將 `getDocumentChunk:<citationId>` 編碼進 `query_redacted_text`。這保留「哪張 citation 被嘗試存取」的稽核軌跡而不需要 migration；`getDocumentChunk:` prefix 讓 auditor 用 `LIKE` 過濾即可還原 attempted citation id。

**Wrangler 查詢**：

```bash
# 最近 10 筆越權記錄（含 token id + attempted citation + timestamp）
wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT id, mcp_token_id, query_redacted_text, config_snapshot_version, created_at \
   FROM query_logs \
   WHERE risk_flags_json LIKE '%restricted_scope_violation%' \
   ORDER BY created_at DESC LIMIT 10;"
```

```bash
# 特定 token 的越權次數
wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT mcp_token_id, COUNT(*) AS violations \
   FROM query_logs \
   WHERE risk_flags_json LIKE '%restricted_scope_violation%' \
     AND created_at >= datetime('now', '-7 days') \
   GROUP BY mcp_token_id ORDER BY violations DESC;"
```

**PASS 條件（spec scenarios）**：

- Scenario 1：越權 call 後至少有 1 筆 row，`status='blocked'`、`risk_flags_json` 含 `restricted_scope_violation`
- Scenario 2：audit INSERT 失敗時，handler 仍回 HTTP 403；Workers logs 可見 `operation: 'mcp-replay-blocked-log'` 的 `log.error`
- Scenario 3：授權 token（含 `knowledge.restricted.read`）成功 replay 不應在此查詢出現——accepted 路徑由 ask handler 寫 `status='accepted'`，replay 層不重複寫

### 8.2 `pii_credit_card` — 高風險 PII 拒答稽核

**觸發條件**：使用者查詢（Web `/api/chat` 或 MCP `askKnowledge`）含以下任一模式：

- Visa / Mastercard / Discover 16-digit（可帶 `-` 或空格 separator）
- Amex 15-digit 4-6-5 grouping
- Generic 13-19 digit run with at least one in-digit `-` 或空格 separator（catch unknown 卡別）

pattern 定義在 `server/utils/knowledge-audit.ts`，走 `auditKnowledgeText` → `shouldBlock=true` 路徑。**未做 Luhn 驗證**（治理目標是「看起來像卡號就拒答」，不是「真的是有效卡號才拒答」）。

**寫入路徑**：`auditKnowledgeText` 回傳 `riskFlags: ['pii_credit_card']` 與 `redactedText: '[BLOCKED:credit_card]'`。web-chat / mcp-ask handler 將 `risk_flags_json` 寫進 `query_logs`，raw query 不落地；`messages.content_redacted` 也只存遮罩版。

**Wrangler 查詢**：

```bash
# 最近 7 天的信用卡 block 記錄
wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT id, channel, user_profile_id, mcp_token_id, query_redacted_text, created_at \
   FROM query_logs \
   WHERE risk_flags_json LIKE '%pii_credit_card%' \
     AND created_at >= datetime('now', '-7 days') \
   ORDER BY created_at DESC LIMIT 50;"
```

```bash
# 觸發頻率每日統計（用於評估誤判率趨勢）
wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT date(created_at) AS day, COUNT(*) AS blocks \
   FROM query_logs \
   WHERE risk_flags_json LIKE '%pii_credit_card%' \
   GROUP BY day ORDER BY day DESC LIMIT 14;"
```

**Admin UI 過濾路徑**：目前無專屬信用卡 admin UI。現有 query logs UI（規劃於 `admin-ui-post-core`，尚未交付）實作時應將 `risk_flags_json LIKE '%pii_credit_card%'` 加入 filter dropdown，與既有的 `credential` / `pii:email` flag 並列。在 admin UI 上線前，以上面的 wrangler 查詢作為唯一稽核介面。

**誤判邊界評估 SOP**：

- **已知可能誤判**：SOP 文件中的訂單編號、序號格式、IP prefix 等 13-19 位數字串
- **已加入 pattern 防護**：必須 separator 出現在 digit 之間（`\d[ -]\d`），plain 長 digit run 不觸發。驗證：`'order id 4111111111111111234 shipped'` 不觸發（見 `test/unit/knowledge-audit.test.ts::does not match 16-digit prefix inside longer digit runs`）
- **上線後 1 週檢視**：
  1. 跑上方每日統計查詢取得觸發頻率
  2. 隨機抽 10 筆 `query_redacted_text='[BLOCKED:credit_card]'` 的 row，詢問使用者實際內容（由使用者回報，非系統）
  3. 若多筆為訂單編號（非真實卡號），回 design 調整 pattern（例如改 require `[- ]` 出現 ≥ 2 次）
  4. 記錄調整決策到 `docs/decisions/YYYY-MM-DD-pii-credit-card-pattern-adjust.md`
- **不擴張 PII pattern**：`tc-acceptance-followups` Non-Goals 明確排除電話、email、身分證號的 block pattern（email/phone 保持 `[REDACTED:*]` 路徑），誤判時不能以「再加一個 pattern」為由擴張

### 8.3 與 `config_snapshot_version` 的關係

兩個新 flag 都走既有 audit chain，`config_snapshot_version` 仍綁原值（從 `runtimeConfig.governance.configSnapshotVersion` 取得）。這代表：

- 同一 governance 配置變更時段內，`risk_flags_json` 觸發規則一致
- 升版後 (`config_snapshot_version` 改變) 的 blocked row 可與舊版分流比對（例如檢測新增 pattern 是否提高拒答頻率）
- 查詢時建議順帶 `GROUP BY config_snapshot_version` 以區分版本：

```bash
wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT config_snapshot_version, COUNT(*) AS blocks \
   FROM query_logs \
   WHERE risk_flags_json LIKE '%pii_credit_card%' \
   GROUP BY config_snapshot_version ORDER BY blocks DESC;"
```
