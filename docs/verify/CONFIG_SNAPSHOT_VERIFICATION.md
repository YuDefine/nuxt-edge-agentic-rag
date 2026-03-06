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

## 2. 驗證清單（Local 或 Production）

**前置**：確認已依 `production-deploy-checklist.md` 部署完成（或具備 local 開發環境），且 D1 有實際 query_logs。

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

1. 比對 local（`env=local`）與 production（`env=production`）的 version 字串。
2. **PASS 條件**：除了 `env=` 欄位不同，其他欄位可能因預設 override 而不同，但**不得出現** `env=local` 的 log 被寫到 production D1。

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
   wrangler d1 execute agentic-rag-db --remote --command \
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
   wrangler d1 execute agentic-rag-db --remote --command \
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
   wrangler d1 execute agentic-rag-db --remote --command \
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
