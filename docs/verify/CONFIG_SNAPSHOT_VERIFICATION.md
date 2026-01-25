# Config Snapshot Verification

> 驗證 `configSnapshotVersion` 在 Web、MCP、query logs 三個表面的一致性，以及 drift guard 能否阻擋硬編的 decision threshold。
>
> **Scope**：governance 3.x 產物。governance 1.x（conversation lifecycle）、2.x（retention cleanup）的驗證步驟待其實作完成後補入本文件。

## 1. Config Snapshot Version 是什麼

`configSnapshotVersion` 是一串由 `buildKnowledgeConfigSnapshotVersion`（`shared/schemas/knowledge-runtime.ts`）組合而成的字串，序列化當下影響 agent orchestration 的所有 governed 參數：

```text
kgov-v1;env=staging;retrieval.maxResults=8;retrieval.minScore=0.20;thresholds.directAnswerMin=0.68;thresholds.judgeMin=0.55;thresholds.answerMin=0.40;execution.maxSelfCorrectionRetry=1;models.defaultAnswer=@cf/meta/llama-3.1-8b-instruct;models.agentJudge=@cf/meta/llama-3.3-70b-instruct-fp8-fast;features.adminDashboard=on;features.cloudFallback=off;features.mcpSession=on;features.passkey=off
```

**Write points**：

| 位置                                 | 欄位 / 來源                       | 目的                               |
| ------------------------------------ | --------------------------------- | ---------------------------------- |
| `query_logs.config_snapshot_version` | `server/utils/knowledge-audit.ts` | 審計每次查詢跑在哪個治理配置之下   |
| Web chat response（governance 物件） | `server/utils/web-chat.ts`        | 前端可對照當前 runtime 與 log 一致 |
| MCP `askKnowledge` response          | `server/utils/mcp-ask.ts`         | MCP 客戶端可讀取版本比對           |

## 2. 驗證清單（Staging）

**前置**：確認已依 `staging-deploy-checklist.md` 部署完成，且 D1 有實際 query_logs。

### 2.1 Runtime 一致性（Web × MCP × D1）

1. 以 Web User 登入 staging，在 `/chat` 問一題可直接命中的問題（如 `A01` fixture）。
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

1. 在 staging 變更任一 governed 參數（例如將 `NUXT_KNOWLEDGE_THRESHOLD_JUDGE_MIN` 從 `0.55` 改為 `0.56`）並重新部署。
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

1. 比對 local（`env=local`）與 staging（`env=staging`）的 version 字串。
2. **PASS 條件**：除了 `env=` 欄位不同，其他欄位可能因預設 override 而不同，但**不得出現** `env=local` 的 log 被寫到 staging D1。

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

- `createKnowledgeRuntimeConfig({ env: 'staging' })` 產出的 snapshot 與 MCP / Web 兩路寫入邏輯使用同一個 builder
- Version bump 只需調整 input 參數，字串格式不會漂移（`kgov-v1` prefix、分隔符、欄位順序）

## 4. Bump Protocol

當改動 governed 參數時：

1. **開 `shared/schemas/knowledge-runtime.ts`** — 只能透過修改 `DEFAULT_KNOWLEDGE_*` 或 env 覆寫改值，**不得**在 handler / component 直接寫數字
2. 跑 `pnpm test test/unit/knowledge-governance-drift.test.ts` 確認沒有新 drift
3. 在 staging 部署後跑本文件 §2 的驗證
4. **保留舊 log 的 old version**（審計用），**不要** backfill

## 5. 人工驗收對應

本文件的驗證直接支援 `bootstrap-v1-core-from-report` 的人工檢查：

- **#5 `query_logs` 檢查**：§2.1 的第 4 步涵蓋（確認 web/mcp 兩路 log 的 config snapshot 一致、未出現明文敏感資料）

## 6. 尚未涵蓋項目（governance 1.x / 2.x 依賴）

以下驗證步驟需等對應 governance task 實作完成後補入：

- **Stale conversation resolver**（governance 1.1-1.2）— follow-up 切到 fresh retrieval 的驗證
- **Conversation delete purge**（governance 1.3-1.5）— `title` / `content_text` 不可回復的驗證
- **Retention cleanup**（governance 2.1-2.5）— 180 天閾值、backdated 測試、過期 replay 邊界
