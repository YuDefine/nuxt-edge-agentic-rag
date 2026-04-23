# Acceptance Runbook — bootstrap + add-v1-core-ui + governance-refinements

> 單一腳本，把 `bootstrap-v1-core-from-report` 6.2 的 #1–#5、`add-v1-core-ui` 的 #1, #3–#8，以及 `governance-refinements` 的 conversation lifecycle 與 retention cleanup 整合成可依序執行的人工驗收。
>
> **前提**：已依 `production-deploy-checklist.md` / `DEPLOYMENT_RUNBOOK.md` 完成目標環境部署（或具備 local 開發環境）。
> **預設目標**：production。若改在 staging 執行，先設 `BASE_URL=https://agentic-staging.yudefine.com.tw` 與 `DB_NAME=agentic-rag-db-staging`；production 預設為 `BASE_URL=https://agentic.yudefine.com.tw`、`DB_NAME=agentic-rag-db`。
>
> **規則**：人工檢查不由 Claude 自行勾選。使用者走完每一項後回報「OK / 問題 / skip」，Claude 才能標 `[x]`。
>
> **Governance 分文件**：詳細 step-by-step 分別在：
>
> - `CONVERSATION_LIFECYCLE_VERIFICATION.md` — Stale resolver + delete purge
> - `RETENTION_CLEANUP_VERIFICATION.md` — 180 天 retention cleanup
> - `CONFIG_SNAPSHOT_VERIFICATION.md` — Config snapshot version 一致性
>
> 本 runbook 的 Phase 8 / 9 為 gate checkpoint，實際細節跳到上述文件執行。

## 0. 前置準備

### 0.1 帳號

準備以下四組身分：

| 身分                          | 用途                                             | 來源                                           |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| **Web Admin**（Google）       | bootstrap #1, #2, #3; ui #2, #5, #6              | 在 `ADMIN_EMAIL_ALLOWLIST` 內的 Gmail          |
| **Web User**（Google）        | bootstrap #1; ui #1, #7                          | 不在 allowlist 內的 Gmail                      |
| **MCP token: non-restricted** | bootstrap #4（對照組，應可看到 internal）        | 透過 admin web 建立，scope 含 `knowledge.read` |
| **MCP token: restricted**     | bootstrap #4（主角組，不應看到 restricted 資料） | 同上但 **不含** `knowledge.restricted.read`    |

### 0.2 測試文件

準備兩個 `.md` 或 `.txt` 小文件（< 100KB）：

- **Doc A（internal）**：access_level=`internal`，內容可用來提問（例：SOP/定義題）
- **Doc A'（Doc A 的新版）**：內容明顯不同，用於 #3 切版驗證
- **Doc B（restricted）**：access_level=`restricted`，用於 #4 越權測試
- **Doc C（no-hit）**：內容不涵蓋某個特定問題，用於 #3 zero-hit 拒答

### 0.3 工具

- 瀏覽器（兩個 session：正常 + 無痕，用來同時掛兩個身分）
- MCP Inspector 或能打 MCP SSE 的 CLI（驗 #4）
- `wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command "..."`（查 D1）

## 1. 驗收矩陣

| #    | 來源      | 項目                                                  | Phase |
| ---- | --------- | ----------------------------------------------------- | ----- |
| B#1  | bootstrap | Web User / Admin 登入 + allowlist 可見範圍            | 1     |
| UI#1 | ui        | User 進 `/chat`、Navigation 無 Admin 入口             | 1     |
| UI#7 | ui        | 非 Admin 訪問 `/admin/documents` 被阻擋               | 1     |
| UI#5 | ui        | Admin 看 `/admin/documents` 列表與 Badge              | 2     |
| UI#6 | ui        | 完整上傳流程（5 步驟狀態正確）                        | 2     |
| B#2  | bootstrap | presign → finalize → sync → publish → 問答 → 引用回放 | 2+3   |
| UI#3 | ui        | Chat streaming 逐字 + refusal 樣式                    | 3     |
| UI#4 | ui        | 點擊引用 → Citation Replay Modal                      | 3     |
| B#3  | bootstrap | 切版後正式回答不用舊版，舊 citation 可回放            | 4     |
| B#4  | bootstrap | restricted existence-hiding + 403                     | 5     |
| B#5  | bootstrap | query_logs / messages 無敏感、超限 429                | 6     |
| UI#8 | ui        | empty / loading / error state 正確顯示                | 7     |
| G#1  | gov 1.1-2 | Stale follow-up 切版後走 fresh retrieval              | 8     |
| G#2  | gov 1.3-5 | Conversation delete 後 `title` / content 不可回復     | 8     |
| G#3  | gov 2.3   | Retention 內 `getDocumentChunk` replay 仍成功         | 9     |
| G#4  | gov 2.1-4 | Backdated 過期後整條 audit chain 被清理               | 9     |
| G#5  | gov 2.1-2 | MCP token metadata retention 清理                     | 9     |
| G#6  | gov 3.x   | Config snapshot version 跨 governance 行為一致        | 9     |

**建議執行順序**：Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9（後面依賴前面的資料）

---

## Phase 1 — Auth & Navigation（B#1 + UI#1 + UI#7）

### Step 1.1 — Google OAuth 登入（B#1, UI#1）

1. 無痕視窗開 `${BASE_URL:-https://agentic.yudefine.com.tw}`
2. 以 **Web User**（非 allowlist）Google 登入
3. 導頁後觀察 Navigation

**PASS 條件**：

- 登入成功，導回首頁或 `/chat`
- Navigation **只有** Chat，**沒有** Documents / Admin 入口 → **UI#1 PASS**
- 若嘗試訪問 `/admin/documents` 應被阻擋（403 或 redirect）→ **UI#7 PASS**
- B#1 user side PASS

### Step 1.2 — Admin 登入（B#1）

1. 另一正常視窗開同網址
2. 以 **Web Admin**（allowlist 內）Google 登入
3. 觀察 Navigation

**PASS 條件**：

- 登入成功
- Navigation 顯示 Chat + Documents 入口（UI#2 已勾，本步只是確認）
- 可進入 `/admin/documents`
- **B#1 PASS**

### Step 1.3 — UI#7 手動測試

在 Step 1.1 的 User session：

1. 直接輸入 `${BASE_URL:-https://agentic.yudefine.com.tw}/admin/documents`

**PASS 條件**：HTTP 403 或 redirect 到 `/chat` / `/login`（不得看到列表）

---

## Phase 2 — Document Upload & Publish（UI#5 + UI#6 + B#2 前半）

### Step 2.1 — Admin 文件列表（UI#5）

在 Admin session：

1. 點 Documents → 進入 `/admin/documents`
2. 觀察列表

**PASS 條件**：

- 若已有文件：列表顯示 title / category / access_level / status / updated_at 等欄位
- Status Badge 正確顯示（例：`active` 綠、`queued` 灰、`syncing` 藍、`failed` 紅）
- 若空：顯示 empty state 與「上傳新文件」CTA

### Step 2.2 — 完整上傳流程（UI#6 + B#2 前半）

1. 點「上傳新文件」→ 選 **Doc A**（.md, internal）
2. 觀察 5 個步驟狀態逐一變化：
   - `select` → 檔案已選擇
   - `upload` → R2 上傳進度條
   - `finalize` → 伺服器記錄 blob
   - `sync` → AI Search 索引建立中
   - `publish` → current version 切換完成

**PASS 條件**：

- 每步驟狀態可見且正確切換
- 最後文件出現在列表，status = `active`，index_status = `indexed`
- D1 驗證：

  ```bash
  wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
    "SELECT id, title, status, (SELECT COUNT(*) FROM document_versions WHERE document_id=documents.id AND is_current=1) AS current_versions FROM documents ORDER BY updated_at DESC LIMIT 3;"
  ```

  Doc A 應有 1 個 current version → **UI#6 PASS**、**B#2 上半段 PASS**

### Step 2.3 — 上傳 Doc B（restricted）

重複 Step 2.2，但選 **Doc B**，設 access_level = `restricted`。
（後續 Phase 5 使用）

---

## Phase 3 — Chat Streaming & Citation Replay（UI#3 + UI#4 + B#2 後半）

### Step 3.1 — Streaming 問答（UI#3）

切到 Admin 或 User session（都可），進入 `/chat`：

1. 新建對話
2. 提問「Doc A 中的 X 是什麼」（X 為 Doc A 實際可答內容）

**PASS 條件**：

- 回答以 streaming 方式**逐字**出現（不是一次跳出整塊）
- 回答含引用標記（如 `[1]`）
- 回答結束後有引用列表

### Step 3.2 — 引用回放（UI#4 + B#2 後半）

承上：

1. 點擊引用標記 `[1]`
2. 觀察 Citation Replay Modal

**PASS 條件**：

- Modal 開啟
- 顯示原文段落（chunk text）
- 顯示來源文件標題與版本
- 關閉 Modal 不影響對話
- **UI#4 PASS**、**B#2 下半段 PASS**

### Step 3.3 — Refusal 樣式（UI#3）

1. 提問不在知識庫的問題（Doc C 不涵蓋的題目，例如「今天台北天氣如何」）

**PASS 條件**：

- 回答是拒答（「超出知識庫範圍」等語意）
- **視覺上與正常回答不同**（不同 badge / icon / 底色）
- 無引用
- **UI#3 PASS**

---

## Phase 4 — Current-Version-Only（B#3）

### Step 4.1 — 切版前提問

1. Admin 進 `/admin/documents`，對 **Doc A** 上傳**新版**（Doc A'，內容不同）
2. 確認新版 publish 完成，舊版 `is_current=0`，新版 `is_current=1`

   ```bash
   wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
     "SELECT id, document_id, version_number, is_current, created_at FROM document_versions WHERE document_id='<Doc A id>' ORDER BY version_number;"
   ```

### Step 4.2 — 提問驗證正式回答

在 `/chat` 新建對話：

1. 提問只有 Doc A' 能答、Doc A 舊版不能答的問題
2. 觀察回答與引用

**PASS 條件**：

- 回答正確（來自新版）
- 引用**全部**指向新版（version_number 是新的）
- 舊版內容**不在**回答中

### Step 4.3 — 舊 citation replay 可用

1. 回到 Phase 3.2 那個舊對話
2. 重新點舊的引用標記

**PASS 條件**：

- Modal 仍可顯示舊版原文（retention 期限內）
- 不會 404
- **B#3 PASS**

---

## Phase 5 — Restricted Scope & MCP（B#4）

### Step 5.1 — non-restricted token（對照組）

用 non-restricted MCP token 對 MCP endpoint 呼叫：

1. `searchKnowledge({ query: "<Doc B 內容關鍵詞>" })` → 應該**看不到** Doc B（因 token 無 restricted scope）
2. `askKnowledge({ query: "<Doc B 內容問題>" })` → 應回答不知道或查無相關（不提 Doc B 存在）

**PASS 條件**：

- 都**不暴露** Doc B 存在（existence-hiding）
- `searchKnowledge` 回 `{ results: [] }` 或不含 Doc B
- `askKnowledge` 無 Doc B 引用

### Step 5.2 — getDocumentChunk 越權

用 non-restricted token 嘗試：

1. `getDocumentChunk({ documentId: "<Doc B id>", chunkId: "<任何 id>" })`

**PASS 條件**：

- HTTP `403`
- Response body **不含** Doc B 任何內容或 metadata
- **B#4 PASS**

### Step 5.3 — restricted token（正向組）

用 restricted MCP token：

1. `searchKnowledge({ query: "..." })` → 應能看到 Doc B
2. `askKnowledge({ query: "..." })` → 應能引用 Doc B
3. `getDocumentChunk(...)` → `200` + 原文

**PASS 條件**：restricted token 可正常使用 Doc B

---

## Phase 6 — Logging & Rate Limit（B#5）

### Step 6.1 — Query Logs 無敏感資料

回到 Phase 3 那題，用含敏感字樣的測試問題（例：「我的信用卡 4111-1111-1111-1111 被盜用怎辦」）：

1. 提問後等回應（應被拒 / 遮罩）
2. 查 D1：

   ```bash
   wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
     "SELECT id, channel, query_redacted_text, risk_flags_json, redaction_applied, status FROM query_logs ORDER BY created_at DESC LIMIT 5;"
   ```

**PASS 條件**：

- `query_redacted_text` 不含原始卡號
- `redaction_applied = 1`
- `risk_flags_json` 含對應 flag
- `status` 為 `blocked` 或 `rejected`

### Step 6.2 — Messages 無原文

```bash
wrangler d1 execute "${DB_NAME:-agentic-rag-db}" --remote --command \
  "SELECT id, role, content_redacted, risk_flags_json FROM messages ORDER BY created_at DESC LIMIT 10;"
```

**PASS 條件**：`content_redacted` 不含卡號；risk flags 保留

### Step 6.3 — Rate Limit 429

連續快速觸發 `/api/chat` 或 MCP `askKnowledge`（需超過 per-channel KV 限制）：

**PASS 條件**：

- 超限後收到 HTTP `429`
- D1 `query_logs.status = 'limited'`（該筆 request 被記錄但未消耗 orchestration）
- **B#5 PASS**

### Step 6.4 — Config Snapshot 一致性

依 `CONFIG_SNAPSHOT_VERIFICATION.md` §2.1 驗證 web / mcp / query_logs 三處的 `configSnapshotVersion` 相同。

---

## Phase 7 — UI States（UI#8）

在 User session（或 Admin），逐頁檢查四種 state：

### 7.1 Empty

- `/chat`：新帳號首次進入 → 有 empty state + CTA
- `/admin/documents`：無文件時 → 有 empty state + 「上傳」CTA

### 7.2 Loading

- `/chat/<id>`：切換對話時 → 短暫 loading skeleton
- `/admin/documents`：刷新時 → 短暫 loading skeleton

### 7.3 Error

- 斷網後操作 → 顯示錯誤提示與重試按鈕
- 或觸發 API 錯誤（例如連 D1 不通）→ 友善錯誤訊息，不顯示原始 stack

### 7.4 Unauthorized

- Phase 1 Step 1.3 已涵蓋

**PASS 條件**：四種 state 都有對應視覺與文案，無白屏、無 raw error

**UI#8 PASS**

---

## Phase 8 — Conversation Lifecycle（G#1 + G#2）

> 完整步驟詳見 [`CONVERSATION_LIFECYCLE_VERIFICATION.md`](./CONVERSATION_LIFECYCLE_VERIFICATION.md)。本 Phase 僅作 gate checkpoint，實際步驟跳到該文件執行。

### Step 8.1 — Stale follow-up 切版後走 fresh retrieval（G#1）

**依賴**：已完成 Phase 2（Doc A 上傳）、Phase 4（Doc A' 切版）。

執行 `CONVERSATION_LIFECYCLE_VERIFICATION.md` §2.2 與 §2.3：

1. 在切版前的對話 C1 對 Doc A 作 same-document follow-up → 快路徑命中、引用版本不變
2. 對 Doc A 切版到 Doc A' 後，**同一個 C1** 追問只有新版能答的題目
3. 驗證：回答使用新版、引用 `document_version_id` 為新版、舊 assistant message 的 `citations_json` 不被回寫

**PASS 條件**：

- §2.2 same-document 快路徑命中
- §2.3 切版後 fresh retrieval 生效，引用全部為新版
- §2.4（optional）回切後引用跟隨最新 current
- **G#1 PASS**

### Step 8.2 — Conversation delete 後原文不可回復（G#2）

執行 `CONVERSATION_LIFECYCLE_VERIFICATION.md` §3.1-§3.4：

1. 以 `PURGE-CANARY-<timestamp>` 為可辨識關鍵字建立對話 C_DEL
2. 刪除 C_DEL，確認列表 / detail API / `/chat/<id>` 路徑全部不可達
3. D1 查 `conversations.title` 被清成 placeholder / NULL、`messages.content_redacted` 全庫 grep `PURGE-CANARY-` 為 0 hit
4. 新對話嘗試誘導 model 重現 `PURGE-CANARY-` 字樣 → 必須失敗

**PASS 條件**：

- §3.2 user surfaces 全部消失
- §3.3 原文欄位不可回復
- §3.4 audit residue 不洩漏到一般路徑
- **G#2 PASS**

---

## Phase 9 — Retention Cleanup（G#3 + G#4 + G#5 + G#6）

> 完整步驟詳見 [`RETENTION_CLEANUP_VERIFICATION.md`](./RETENTION_CLEANUP_VERIFICATION.md) 與 [`CONFIG_SNAPSHOT_VERIFICATION.md`](./CONFIG_SNAPSHOT_VERIFICATION.md) §6。本 Phase 僅作 gate checkpoint。

### Step 9.1 — Retention 內 replay 仍成功（G#3）

執行 `RETENTION_CLEANUP_VERIFICATION.md` §3：

1. 取最新 citation 的 `<citation_id>` / `<chunk_id>` / `<query_log_id>`
2. 觸發 `POST /api/admin/retention/prune`
3. 再次以 MCP `getDocumentChunk` replay → 應仍 200 + 原文
4. D1 確認 citation / query_log / source_chunk 全部保留

**PASS 條件**：

- Prune 後 retention 內 citation / query_log / source_chunks.chunk_text 無一被刪
- Replay 前後結果一致
- **G#3 PASS**

### Step 9.2 — Backdated 過期後整條 audit chain 被清理（G#4）

**只在 local 執行**。執行 `RETENTION_CLEANUP_VERIFICATION.md` §4：

1. 以 `backdated-ql-*` / `backdated-cr-*` id 前綴種入 200 天前 SQL 記錄
2. 觸發 prune
3. D1 `COUNT(*) WHERE id LIKE 'backdated-%'` 應全為 0
4. 對已清除的 citation 呼叫 `getDocumentChunk` → 與一般過期回應一致（404 / 410）

**PASS 條件**：

- Backdated 記錄全部刪除，retention 內記錄不受影響
- 過期 replay 回應不洩漏「曾存在」訊息
- **G#4 PASS**

### Step 9.3 — MCP token metadata 清理（G#5）

執行 `RETENTION_CLEANUP_VERIFICATION.md` §5：

1. 建 local MCP token，手動改為 200 天前 revoked
2. 觸發 prune
3. D1 查 token：`token_hash` = `redacted:<id>`、`name` = `[redacted]`、`scopes_json` = `[]`

**PASS 條件**：

- Token 三欄位皆被 redact，`revoked_reason` 保留或填 `retention-expired`
- 其他活躍 token 未受影響
- **G#5 PASS**

### Step 9.4 — Config snapshot 在 governance 行為下穩定（G#6）

執行 `CONFIG_SNAPSHOT_VERIFICATION.md` §6：

1. §6.1 — Document 切版前後 `config_snapshot_version` 相同（依賴 Step 8.1 的 Q1/Q3 log）
2. §6.2 — Conversation delete 不改既有 log 的 version 欄位（依賴 Step 8.2 的 C_DEL log）
3. §6.3 — Prune 不改 retention 內 log 的 version 字串（依賴 Step 9.1 / 9.2）
4. §6.4 — Backdated 記錄的 version 字串不被用於 prune 判定

**PASS 條件**：

- 四個情境下 `config_snapshot_version` 行為符合預期
- 無 governance 行為誤寫 / 誤清 version 欄位
- **G#6 PASS**

### Step 9.5 — Production 配置可見性檢查

**不得**在 production 種 backdated 資料或觸發 prune。執行 `RETENTION_CLEANUP_VERIFICATION.md` §6：

1. 讀取 production `retentionDays` 設定
2. 查 `query_logs.MIN(created_at)`、`citation_records.MIN(expires_at)`
3. 確認 cleanup schedule（Cron Trigger / scheduled task）存在且可見

**PASS 條件**：

- Production 與 local 的 retention 設定一致
- `query_logs.oldest` 未超過 retention 過多（代表 cleanup 有在跑）
- Cleanup schedule 已註冊且可查證

---

## 回報格式

每項完成後，以下列格式回報 Claude（Claude 會代勾 tasks.md）：

```
B#1 OK
UI#1 OK
UI#7 OK
B#2 問題: <描述>
G#1 OK
G#2 問題: title 被清但 content 仍含原文
G#3 OK
G#4 skip（local 不允許種 backdated）
...
```

或簡寫：

```
全部 PASS，除了 B#5 rate limit 沒試到 429、G#4 local 不允許種 backdated
```

**常見陷阱**：

- Google OAuth redirect URI 未在 Google Cloud Console 設對 → 登入失敗
- `ADMIN_EMAIL_ALLOWLIST` 格式錯誤（逗號分隔、小寫） → Admin 被當 User
- R2 upload signing secrets 缺 → `/api/uploads/presign` 回 503
- 上 D1 `wrangler d1 execute` 忘加 `--remote` → 查到空的 local sqlite
- MCP token 建完沒帶 scope → restricted 測試變「都看不到」無法對照
- Phase 8 / 9 跑完後忘記清理 `backdated-*` id → 汙染下次驗證
- Phase 9 直接在 production 觸發 prune → **絕對禁止**，production 只驗配置可見性
- Phase 8 delete purge 以 same session 測試 → 可能受瀏覽器 cache 影響，建議新 session / 無痕視窗
