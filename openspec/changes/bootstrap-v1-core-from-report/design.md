## Context

這個 repo 目前只有 Nuxt 與登入相關骨架，尚未進入報告定義的核心實作階段。`main-v0.0.36.md` 已經把 `v1.0.0` 的正式邊界定得很清楚：Cloudflare AI Search 只負責檢索，回答生成與治理由應用層掌控；正式回答要以 D1 `active/indexed/current` 加上預先建立的 `source_chunks` 驗證；Web 與 MCP 要共用同一套檢索／引用／治理核心，但仍維持不同契約與授權面。

本 change 的目的不是直接交付功能，而是把這些邊界整理成可持續演進的 Spectra artifacts，讓後續每一個實作 change 都有穩定的規格基線。

## Goals / Non-Goals

**Goals:**

- 把報告收斂為五個可獨立實作的能力切片。
- 固定資料真相來源、權限矩陣、發布流程與治理原則，避免之後在 design 或 code review 階段反覆重談基線。
- 讓 tasks 直接對應 M1-M8 的落地順序，同時優先完成六步最小閉環。
- 補齊 repo 內建 Spectra workflow 需要的人工檢查基礎檔案。

**Non-Goals:**

- 不把尚未實作的需求直接同步成 `openspec/specs/` 主規格真相來源。
- 不在這個 change 內綁定實際模型名稱、完整 UI 畫面稿或最終部署參數值。
- 不把同版後置項反客為主，搶先於核心閉環之前落地。

## Decisions

### System Truth Sources

正式知識真相以 D1、`normalized_text_r2_key` 與預先建立的 `source_chunks` 為核心。`documents`、`document_versions`、`source_chunks`、`citation_records`、`messages`、`query_logs`、`mcp_tokens` 與 `user_profiles` 是第一批關鍵資料表。Cloudflare AI Search 提供 query rewrite、rerank 與 retrieval，但不作為發布真相來源；任何遠端 metadata 都只能幫忙快篩，正式回答前仍要回到 D1 驗證 `active/indexed/current`。

這個決定直接對應報告中對 current-version-only、引用回放與供應商中繼資料上限的限制。好處是治理邊界清楚，可回放與可稽核；代價是前處理與同步流程較重，需要在文件建立時一次把版本快照與 `source_chunks` 準備好。

### Access Control & Actor Boundaries

身分驗證採 better-auth + Google OAuth，管理員權限真相來源固定為 runtime `ADMIN_EMAIL_ALLOWLIST`。每一次 Admin 專屬操作都要以當前 Session email 重新比對 allowlist，而不是只看 `user_profiles` 既有角色快照。`allowed_access_levels` 必須在第一次檢索前推導完成，Web 與 MCP 都共用同一套推導邏輯，但授權表面不同：Web 用 Session，MCP 用 Bearer token + scope。

這個決定的重點是避免部署初期的角色漂移與權限歧義。若之後需要額外角色層級，可以在同一矩陣上擴充，而不是再做第二套權限邏輯。

### Document Lifecycle & Publish Pipeline

文件匯入採 staged upload：先 `/api/uploads/presign`，直傳 R2，再 `/api/uploads/finalize` 驗證 checksum、size 與 MIME type，通過後才建立文件或版本紀錄。版本建立後即產出 `normalized_text_r2_key`、`metadata_json`、`smoke_test_queries_json` 與 `source_chunks`，同步 AI Search 後進入 smoke 驗證，最後才由 publish 流程用單一 transaction 切換 `is_current`。

這樣設計是為了把「內容變更」、「索引重建」與「正式發布」拆成不同狀態，避免使用者把 reindex 當成內容編輯，也避免未完成前處理的版本進到正式回答路徑。代價是狀態機較多，但這正是 Spectra specs 最需要先定清楚的部分。

### Web Answering Orchestrator

Web 問答主線固定為：規則式 Query Normalization → 權限／敏感資料檢查 → AI Search 檢索 → D1 current 驗證 → `retrieval_score` → answerability judge（僅邊界區間）→ 單次 Query Reformulation 重試 → 回答或拒答 → 引用組裝與串流輸出。模型保持角色抽象：`models.defaultAnswer` 處理單文件明確題，`models.agentJudge` 處理 judge、reformulation 與跨文件整合。

這個決定讓 Spectra tasks 可以先實作最小閉環，再逐步補齊後續優化。它也保證 `searchKnowledge` / `askKnowledge` 之後可以共用相同的核心，而不是再造一套只為 MCP 存在的回答流程。

### MCP Contract Surface

`v1.0.0` MCP 固定為無狀態契約，只接受 `Authorization: Bearer <token>`，並以 scope 區分 `knowledge.search`、`knowledge.ask`、`knowledge.citation.read`、`knowledge.category.list` 與 `knowledge.restricted.read`。`askKnowledge` 與 `getDocumentChunk` 屬核心閉環的一部分；`searchKnowledge` 與 `listCategories` 屬同版後置，但仍需在規格中先定義對外契約，避免後續擴充時暴露內部診斷欄位或破壞 existence-hiding。

此處刻意把「工具契約」與「內部診斷資料」分開。外部工具不能直接看到 `retrievalScore`、`confidenceScore`、`documentVersionId` 等欄位；若需要除錯，由 Web Admin 從 `query_logs` 取得。

### Governance & Environment Controls

治理規則包含三件事：先做敏感資料檢查，再決定是否允許進模型；所有持久化資料只保存遮罩後內容或事件標記；`/api/chat` 與 MCP tools 以 KV 做 fixed-window rate limit。環境面則強制 Local / Dev、Staging / Preview、Production 各自使用不同的 D1、R2、KV 與 AI Search instance，並由 runtime config / Wrangler 環境設定注入 secrets、OAuth 憑證、binding 名稱與 feature flags。Production `v1.0.0` 預設把 `features.passkey`、`features.mcpSession`、`features.cloudFallback`、`features.adminDashboard` 全部關閉。

這樣可以讓答辯與正式環境使用同一套治理規則，又不會因測試資料污染 Production 真相來源。風險是需要更完整的環境設定管理，但這比在系統成熟後再回頭拆環境要安全。

### AutoRAG Indexing & R2 Custom Metadata（2026-04-18 補充）

2026-04-18 驗收 #2 後半發現 `/api/chat` 對已 publish 的 Doc A 與 seed 文件皆回 `refused: true, citations: []`。code 查證後確認兩層根因：

**根因 1（#B2 — state machine 未推進）**：`syncDocumentVersionSnapshot`（`server/utils/document-sync.ts:102`）只把版本設為 `index_status='preprocessing'` / `sync_status='pending'`，整個 repo 沒有任何 code path 會把版本推進到 `smoke_pending` 或 `indexed`。但 publish 檢查（`server/utils/document-publish.ts:73`）要求 `indexStatus === 'indexed'`，造成任何新上傳都卡在 publish 409。

**根因 2（#B3 — R2 物件缺 customMetadata）**：`server/utils/ai-search.ts:47-51` 的 search 結果預期 `entry.attributes.file.citation_locator` / `document_version_id` / `access_level` 等欄位，這些都對應到 AutoRAG indexed file 的 customMetadata。但 `r2-object-access.ts:82` 的 `put` 只傳 `httpMetadata: { contentType }`，**從未傳過 customMetadata**，AutoRAG crawl 時看不到任何 filter / citation 所需 attributes。

**架構決策：R2 Per-Chunk Objects with customMetadata**：

- AutoRAG 的 file-level metadata 對整個 R2 object 只有一組值，但 `citation_locator` 是 **chunk 級別**（「lines 9-12」）。兩者結構不相容 ⇒ **spec 設計上 R2 必須放 per-chunk files（1 chunk = 1 R2 object + chunk-level metadata），不是 per-document 整份**。
- 目前實作（`writeNormalizedText` 寫整份 normalized text 成一個 object）與此決策衝突，必須改寫。
- 新 R2 key layout：`normalized-text/<document_version_id>/<chunk_sequence>.txt`，每個 object 帶 customMetadata：
  - Filter 用：`status`、`version_state`、`access_level`、`category_slug`
  - Replay / citation 用：`citation_locator`、`document_version_id`、`title`
- 既有 `normalized_text_r2_key` 欄位仍保留作為 per-version 的 base key（prefix），`source_chunks.content_text` 仍是 D1 層的真相來源；R2 per-chunk objects 只是供 AutoRAG crawl / search 與可選回放使用。
- 這項決策**不改動 `specs/document-ingestion-and-publishing/spec.md` 的 SHALL 語句**，只是把實作面 R2 物件佈局與 indexing pipeline 對齊原本已 SHALL 的 `preprocessing → smoke_pending → indexed` 狀態機。

**Trade-offs**：per-chunk R2 物件數量 ≈ per-version chunk 數（預估 10-50）。R2 Class A operations 成本增加但仍在 free tier / 個位數成本區間。收穫是 AutoRAG filter 能正確工作、citation replay 不再依賴 fragile locator-in-text 解析。

**R2 Prefix 分工與 AutoRAG crawl scope**：

| Prefix                                             | 內容                      | Writer                      | customMetadata | AutoRAG crawl |
| -------------------------------------------------- | ------------------------- | --------------------------- | -------------- | ------------- |
| `staged/<env>/<adminUserId>/<uploadId>/<filename>` | 原始 source 檔（md/txt）  | Client via S3 presigned URL | ❌ 無          | ❌ 必須排除   |
| `normalized-text/<versionId>/<NNNN>.txt`           | per-chunk normalized text | `document-sync.ts` 統一負責 | ✅ 完整        | ✅ 必須包含   |

- `presign.post.ts` / `finalize.post.ts` 走 S3 presigned URL 路徑，不經 `R2ObjectAccess.put`，因此不涉及 customMetadata；檔案本身也不被 AutoRAG 使用，只作為 sync 時 `loadSourceText` 的暫存讀取來源。
- 部署時（8.6 task）必須在 AutoRAG data source 設定限定 crawl prefix 為 `normalized-text/`，避免 staged source 被當成 knowledge candidates（雖然因無 `status`/`version_state` customMetadata 而會被 filter 排除，但仍產生多餘 embedding 成本）。

### Verification & Rollout

實作順序依報告里程碑切成 M1-M8，但真正的 gating 條件只有一個：先完成六步最小閉環，再處理同版後置項。驗證方式要同時包含自動化測試、staging smoke probes 與人工檢查。人工檢查項目會從共用 checklist 挑選，附加在 tasks artifact 尾端，讓之後的 `/review-screenshot` 與 `/review-archive` 流程有固定起點。

## Risks / Trade-offs

- [範圍過大] → 以 capability 切片和里程碑順序降低一次性實作壓力，必要時再從這個 bootstrap change 拆出後續 changes。
- [供應商能力波動] → 維持模型角色抽象與 AI Search 介面抽象，待 Preview 通過後才鎖定實際名稱與 binding 方式。
- [資料治理成本較高] → 以 `source_chunks` 預建與紅線式 current 驗證換取可回放、可稽核與不依賴供應商內部欄位的穩定性。
- [MCP 與 Web 邏輯分叉] → 先用共用 retrieval / citation / governance core，再讓不同入口只保留各自的授權與回應格式差異。

## Migration Plan

1. 先落地核心 schema、runtime config 與 shared service 邊界，確保資料真相來源與權限矩陣穩定。
2. 依 tasks 先做文件發布與 Web 問答最小閉環，包含 citation replay 與 restricted 隔離。
3. 再補 `askKnowledge`、`getDocumentChunk`，最後補 `searchKnowledge`、`listCategories` 與其他同版後置項。
4. 在 Staging 以縮短 TTL 或 backdated records 驗證 retention / cleanup，並用 smoke retrieval 驗證 `source_chunks` 對應率與 current-version-only。

## Execution Strategy

> 時程壓力：7 天內完成 v1.0.0 核心閉環（截止 2026-04-22）

### Task 依賴圖

```
1.1 Schema ─┬─► 1.2 Auth ────────────────┐
            │                            │
            ├─► 2.1 Upload ─► 2.2 Version ┼─► 2.3 Publish ─► 3.1 Retrieval ─► 3.2 Citation
            │                            │
            └─► 5.1 Rate Limits ─────────┼─► 5.2 Redaction
                                         │
                                         └─► 4.1 MCP Auth ─► 4.2 Ask Tool
```

### 並行窗口

| 窗口 | 可並行 Tasks  | 前置條件       |
| ---- | ------------- | -------------- |
| W1   | 1.2, 2.1, 5.1 | 1.1 完成       |
| W2   | 2.2, 2.3      | 2.1 完成       |
| W3   | 3.1, 4.1, 5.2 | 2.3 + 1.2 完成 |
| W4   | 3.2, 4.2      | 3.1 + 4.1 完成 |

### 分派策略

- **主線**（不可分派）：1.1 → 2.3 → 3.x — 核心問答流程需串行確保一致性
- **可分派 Track A**：1.2 Auth & Allowlist — 依賴 1.1 schema，可用 `/assign` 獨立進行
- **可分派 Track B**：2.1, 2.2 Upload/Version — 依賴 1.1 schema，可用 `/assign` 獨立進行
- **可分派 Track C**：5.1, 5.2 Governance — 只依賴 KV binding，可用 `/assign` 獨立進行

### Design Review 整合

涉及 UI 的 tasks 完成後，需觸發 Design Review（Section 7）：

| Task                       | UI 涉及                                | Design Review 觸發點 |
| -------------------------- | -------------------------------------- | -------------------- |
| 1.2 Auth & Allowlist       | `app/pages/auth/**`, login/callback UI | 完成後觸發           |
| 2.1-2.3 Document Lifecycle | `app/pages/admin/**`, 文件管理 UI      | 2.3 完成後觸發       |
| 3.1-3.2 Web Answering      | `app/pages/chat/**`, 問答 UI           | 3.2 完成後觸發       |
| 4.x MCP                    | 無 UI                                  | 不觸發               |
| 5.x Governance             | 無 UI（後台 config）                   | 不觸發               |

**Design Review 流程**：

1. 檢查 `.impeccable.md` 存在
2. `/design improve` 取得診斷 + Fidelity Report
3. 修復 DRIFT 項目（max 2 輪）
4. 按 canonical order 執行 design skills
5. `/audit` 確認 Critical = 0
6. `/review-screenshot` 視覺 QA

### 關鍵路徑

```
1.1 → 2.1 → 2.2 → 2.3 → 3.1 → 3.2 → 6.1 → 6.2
```

關鍵路徑上的 tasks 不可延遲，其他 tasks 有 1-2 天 slack。

## Open Questions

- 目標部署環境最穩定的 AI Search 介面應採 REST API 還是 Workers binding 封裝，需在實作前做 smoke probe。
- `models.defaultAnswer` 與 `models.agentJudge` 的實際模型名稱需等 Preview 驗證通過後鎖定，並同步回填部署設定與報告。
