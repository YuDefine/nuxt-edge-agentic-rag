# Acceptance Runbook — bootstrap + add-v1-core-ui

> 單一腳本，把 `bootstrap-v1-core-from-report` 6.2 的 #1–#5 與 `add-v1-core-ui` 的 #1, #3–#8 整合成可依序執行的 12 項人工驗收。
>
> **前提**：staging 已依 `staging-deploy-checklist.md` 部署完成。
> **環境**：`https://agentic.yudefine.com.tw`（D1 `agentic-rag-db`、KV `661ea98dad0743be86acc9ebeaf464f4`、R2 `agentic-rag-documents`）
>
> **規則**：人工檢查不由 Claude 自行勾選。使用者走完每一項後回報「OK / 問題 / skip」，Claude 才能標 `[x]`。

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
- `wrangler d1 execute agentic-rag-db --remote --command "..."`（查 D1）

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

**建議執行順序**：Phase 1 → 2 → 3 → 4 → 5 → 6 → 7（後面依賴前面的資料）

---

## Phase 1 — Auth & Navigation（B#1 + UI#1 + UI#7）

### Step 1.1 — Google OAuth 登入（B#1, UI#1）

1. 無痕視窗開 `https://agentic.yudefine.com.tw`
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

1. 直接輸入 `https://agentic.yudefine.com.tw/admin/documents`

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
  wrangler d1 execute agentic-rag-db --remote --command \
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
   wrangler d1 execute agentic-rag-db --remote --command \
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
   wrangler d1 execute agentic-rag-db --remote --command \
     "SELECT id, channel, query_redacted_text, risk_flags_json, redaction_applied, status FROM query_logs ORDER BY created_at DESC LIMIT 5;"
   ```

**PASS 條件**：

- `query_redacted_text` 不含原始卡號
- `redaction_applied = 1`
- `risk_flags_json` 含對應 flag
- `status` 為 `blocked` 或 `rejected`

### Step 6.2 — Messages 無原文

```bash
wrangler d1 execute agentic-rag-db --remote --command \
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

## 回報格式

每項完成後，以下列格式回報 Claude（Claude 會代勾 tasks.md）：

```
B#1 OK
UI#1 OK
UI#7 OK
B#2 問題: <描述>
...
```

或簡寫：

```
全部 PASS，除了 B#5 rate limit 沒試到 429
```

**常見陷阱**：

- Google OAuth redirect URI 未在 Google Cloud Console 設對 → 登入失敗
- `ADMIN_EMAIL_ALLOWLIST` 格式錯誤（逗號分隔、小寫） → Admin 被當 User
- R2 upload signing secrets 缺 → `/api/uploads/presign` 回 503
- 上 D1 `wrangler d1 execute` 忘加 `--remote` → 查到空的 local sqlite
- MCP token 建完沒帶 scope → restricted 測試變「都看不到」無法對照
