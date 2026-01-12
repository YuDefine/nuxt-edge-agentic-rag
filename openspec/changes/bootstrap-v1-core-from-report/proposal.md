## Why

`../../workspace/report/versions/main-v0.0.36.md` 已經定義 `v1.0.0` 的系統邊界、驗收閉環與治理原則，但目前 repo 只有 Spectra 骨架與 Nuxt 初始頁面，還沒有可直接拿來規劃與實作的 change artifacts。若不先把報告整理成 proposal、design、specs 與 tasks，後續開發很容易在資料真相來源、權限規則與核心範圍上各自解讀。

## What Changes

- 建立第一個以報告為基準的 Spectra change，將 `v1.0.0` 核心閉環整理成可實作的能力切片與規格檔。
- 定義五個新能力：存取控制、文件匯入與發布、Web Agentic 問答、MCP 知識工具，以及治理與可觀測性。
- 記錄跨能力設計決策，包括 D1 + `normalized_text_r2_key` + `source_chunks` 的正式真相來源、staged upload / publish 流程、模型角色抽象、環境隔離與 Production feature flag 預設值。
- 產出依里程碑排序的 tasks，優先完成「文件發布 → Web 問答 → 引用回放 → current-version-only 驗證 → restricted 隔離 → redaction」六步最小閉環，再處理同版後置項。

## Non-Goals

- 本 change 不直接實作應用程式功能，只建立之後要用 `/spectra-apply` 落地的 artifacts。
- 本 change 不在此時鎖定實際 Workers AI 模型名稱，只保留 `models.defaultAnswer` 與 `models.agentJudge` 角色抽象。
- Passkey、`MCP-Session-Id`、Cloud fallback、管理儀表板、rich format 優先驗收與其他 `v1.0.0` 以外擴充項不納入核心閉環。

## Capabilities

### New Capabilities

- `knowledge-access-control`: Web Session、runtime allowlist、`allowed_access_levels` 與 Web/MCP 權限矩陣。
- `document-ingestion-and-publishing`: staged upload、版本快照、`source_chunks` 預建、同步 smoke 驗證與 atomic current publish。
- `web-agentic-answering`: 規則式 Query Normalization、驗證後檢索、信心分流、拒答與引用回放對應。
- `mcp-knowledge-tools`: 無狀態 Bearer token 工具面、scope 驗證、existence-hiding 與引用回放。
- `governance-and-observability`: 遮罩後日誌、`citation_records`、rate limit、保留期限與環境隔離。

### Modified Capabilities

(none)

## Impact

- Affected specs: `knowledge-access-control`, `document-ingestion-and-publishing`, `web-agentic-answering`, `mcp-knowledge-tools`, `governance-and-observability`
- Affected code: `openspec/config.yaml`, `nuxt.config.ts`, `.env.example`, `app/pages/**`, `app/middleware/**`, `server/**`, future `server/api/**`, `test/**`, `docs/manual-review-checklist.md`, `docs/manual-review-archive.md`
- Affected systems: Google OAuth, D1, R2, KV, Cloudflare AI Search, Workers AI, Nuxt MCP Toolkit, runtime config / Wrangler environment bindings

## Affected Entity Matrix

### Entity: user_profiles

| Dimension       | Values                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| Columns touched | `id`, `email`, `name`, `avatar_url`, `role`, `admin_source`, `created_at`, `updated_at` |
| Roles           | Web User, Web Admin                                                                     |
| Actions         | create (auto on first login), read (profile), update (avatar/name)                      |
| States          | empty (first visit), loading, error, success, unauthorized                              |
| Surfaces        | `/auth/login`, `/auth/callback` (建立), profile dropdown (讀取)                         |

### Entity: documents

| Dimension       | Values                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Columns touched | `id`, `title`, `slug`, `category`, `access_level`, `status`, `owner_id`, `created_at`, `updated_at` |
| Roles           | Web Admin                                                                                           |
| Actions         | create, read, update, delete (soft), filter (by category/status/access_level), archive              |
| States          | empty (無文件), loading, error, success, unauthorized                                               |
| Surfaces        | `/admin/documents` (列表), `/admin/documents/[id]` (詳情), `/admin/documents/new` (建立)            |

### Entity: document_versions

| Dimension       | Values                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Columns touched | `id`, `document_id`, `version_number`, `normalized_text_r2_key`, `metadata_json`, `smoke_test_queries_json`, `index_status`, `is_current`, `created_at` |
| Roles           | Web Admin                                                                                                                                               |
| Actions         | create (upload), read, sync (AI Search), publish, filter (by index_status)                                                                              |
| States          | draft, preprocessing, smoke_pending, indexed, published, failed                                                                                         |
| Surfaces        | `/admin/documents/[id]` (版本列表), `/admin/documents/[id]/versions/[versionId]` (版本詳情)                                                             |

### Entity: source_chunks

| Dimension       | Values                                                                                 |
| --------------- | -------------------------------------------------------------------------------------- |
| Columns touched | `id`, `document_version_id`, `chunk_index`, `chunk_text`, `start_offset`, `end_offset` |
| Roles           | Web Admin (管理), Web User / MCP Token (間接讀取 via citation)                         |
| Actions         | create (preprocessing), read (citation replay), delete (version cleanup)               |
| States          | N/A (內部資料，無直接 UI)                                                              |
| Surfaces        | 無直接 surface — 透過 `/api/citations/[citationId]` 間接存取                           |

### Entity: citation_records

| Dimension       | Values                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Columns touched | `id`, `query_log_id`, `source_chunk_id`, `document_version_id`, `relevance_score`, `created_at` |
| Roles           | Web User, Web Admin, MCP Token                                                                  |
| Actions         | create (answer generation), read (replay)                                                       |
| States          | N/A (自動建立)                                                                                  |
| Surfaces        | `/chat` (inline citation), `/api/mcp/getDocumentChunk` (MCP replay)                             |

### Entity: messages

| Dimension       | Values                                                                                |
| --------------- | ------------------------------------------------------------------------------------- |
| Columns touched | `id`, `conversation_id`, `role`, `content` (redacted), `citations_json`, `created_at` |
| Roles           | Web User, Web Admin                                                                   |
| Actions         | create (ask question / receive answer), read (conversation history)                   |
| States          | empty (新對話), loading (streaming), error, success                                   |
| Surfaces        | `/chat` (對話介面), `/chat/[conversationId]` (歷史對話)                               |

### Entity: query_logs

| Dimension       | Values                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Columns touched | `id`, `user_id`, `channel`, `query_hash`, `risk_flags_json`, `redaction_applied`, `retrieval_score`, `decision_path`, `config_version`, `created_at` |
| Roles           | Web Admin (audit)                                                                                                                                    |
| Actions         | create (auto), read (audit dashboard — 同版後置)                                                                                                     |
| States          | N/A (自動建立)                                                                                                                                       |
| Surfaces        | v1.0.0 無直接 surface — 同版後置 admin dashboard                                                                                                     |

### Entity: mcp_tokens

| Dimension       | Values                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| Columns touched | `id`, `name`, `token_hash`, `scopes`, `expires_at`, `revoked_at`, `created_by`, `created_at` |
| Roles           | Web Admin                                                                                    |
| Actions         | create, read, revoke, filter (by status)                                                     |
| States          | empty (無 token), loading, error, success, unauthorized                                      |
| Surfaces        | `/admin/tokens` (列表), `/admin/tokens/new` (建立)                                           |

## User Journeys

### 認證流程

- **Unauthenticated** 訪問 `/chat` → 被 middleware 導向 `/auth/login` → 點擊「Google 登入」→ OAuth callback → 建立 `user_profiles` → 導回 `/chat`
- **Web User** 訪問 `/admin/**` → middleware 檢查 `ADMIN_EMAIL_ALLOWLIST` → 不在名單 → 導向 `/unauthorized`
- **Web Admin** 訪問 `/admin/documents` → middleware 驗證 allowlist → 進入文件管理頁

### 文件上傳與發布流程

- **Web Admin** 在 `/admin/documents/new` 填寫文件資訊 → 選擇檔案 → presign 取得 R2 URL → 直傳 R2 → finalize 驗證 → 建立 `documents` + `document_versions` → 自動進入 preprocessing → 產生 `source_chunks` → 進入 `smoke_pending` → sync AI Search → 變成 `indexed` → 點擊「發布」→ `is_current = true`
- **Web Admin** 在 `/admin/documents/[id]` 上傳新版本 → 同上流程 → 發布時 atomically 切換 `is_current`
- **Web Admin** 在 `/admin/documents` 以「已歸檔」篩選 → 看到所有已歸檔文件 → 可選擇復原或永久刪除

### Web 問答流程

- **Web User** 在 `/chat` 輸入問題 → 規則式 Query Normalization → AI Search 檢索 → D1 current 驗證 → retrieval_score 計算 → 若 ≥0.70 直接回答 / 若 0.45-0.70 judge + reformulation → 回答或拒答 → 引用組裝 → streaming 輸出 → 點擊引用 → 展開 `source_chunks` 內容
- **Web User** 在 `/chat` 查詢只存在於 `restricted` 文件的內容 → 檢索結果為空 → 系統拒答「找不到相關資訊」（不透露 restricted 存在）
- **Web Admin** 在 `/chat` 相同查詢 → `allowed_access_levels = ['internal', 'restricted']` → 檢索到 restricted 內容 → 正常回答

### MCP 工具流程

- **MCP Client** 呼叫 `askKnowledge` 無 Bearer token → 回傳 `401`
- **MCP Client** 呼叫 `askKnowledge` 有效 token + 足夠 scope → 走 Web 相同的檢索/回答核心 → 回傳結構化回答 + citations
- **MCP Client** 呼叫 `getDocumentChunk` 有效 citationId → 回傳 chunk text（re-check access level）
- **MCP Client** 呼叫 `getDocumentChunk` 指向 restricted chunk 但 token 無 `knowledge.restricted.read` → 回傳 `403`
- **MCP Client** 呼叫 `searchKnowledge` 只有 restricted 結果 → 回傳 `{ results: [] }`（existence-hiding）

### MCP Token 管理流程

- **Web Admin** 在 `/admin/tokens` 看到現有 token 列表（只顯示名稱、scopes、到期日，不顯示 token 值）→ 點擊「建立新 Token」→ 填寫名稱、選擇 scopes、設定到期日 → 確認 → 顯示一次性 token 值（之後不再顯示）→ 複製保存
- **Web Admin** 在 `/admin/tokens` 點擊某 token 的「撤銷」→ 確認 → `revoked_at` 設為現在 → 該 token 立即失效

### 治理與限流

- **Web User** 在 5 分鐘內發送超過 30 則訊息 → 第 31 則回傳 `429` → 顯示「請稍後再試」
- **MCP Client** 超過 `askKnowledge` 限額 → 回傳 `429`
- **Web User** 輸入包含敏感資訊（如 API key pattern）→ 系統偵測高風險 → 拒絕請求 → 不持久化原始內容
