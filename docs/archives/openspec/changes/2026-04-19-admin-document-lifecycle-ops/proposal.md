## Why

`bootstrap-v1-core-from-report` 人工驗收揭露：staged upload wizard 中斷後，文件可能停留於 `documents.status = draft`、`current_version_id = NULL`、`document_versions.sync_status = pending`，但 `/admin/documents` 列表僅有「檢視」按鈕、詳情頁僅有「上傳新版」按鈕，Admin 只能直接進 D1 清理。核心閉環實作已完成，此 gap 屬營運操作層，切為獨立 change 處理，避免污染既定 scope。詳見 `main-v0.0.40.md` §2.2.4.2。

## What Changes

- 新增 admin-only mutation API：
  - `POST /api/admin/documents/[id]/versions/[versionId]/retry-sync`：將 `sync_status` 由 `pending` / `failed` 重新推進為 `running`
  - `DELETE /api/admin/documents/[id]`：僅允許 `draft-never-published`（所有 `document_versions.published_at IS NULL`），透過 `onDelete: cascade` 清除版本與 `source_chunks`
  - `POST /api/admin/documents/[id]/archive`：將 `documents.status` 設為 `archived`、寫入 `archivedAt`
  - `POST /api/admin/documents/[id]/unarchive`：將 `status` 還原為 `active`、清除 `archivedAt`
- 擴充 admin UI：`DocumentListTable.vue` actions 欄加入下拉選單；`app/pages/admin/documents/[id].vue` toolbar 加入 archive / delete 動作；版本歷史每一列，`sync_status IN (pending,failed)` 時顯示 retry-sync 按鈕
- 破壞性操作（delete、archive）UI 使用確認對話框，清楚說明影響範圍與授權狀態
- 權限沿用 runtime admin middleware，不新增角色層或二階段確認

## Non-Goals

- 不實作已發布文件之 hard delete；交由 `governance-refinements/retention-cleanup-governance` 在 retention window 期滿後處理
- 不重做 `DocumentListTable.vue` 的列表欄位、`UploadWizard.vue` 的上傳流程或 `[id].vue` 的版本歷史視覺
- 不新增 role 層、不加二階段確認（例如 email 驗證、re-auth）
- 不引入新的 feature flag 或 config threshold
- 不處理 AI Search 端的反向清除；由既有 sync 管道在下一次 reindex 時自然收斂
- 不擴充 `add-v1-core-ui` / `bootstrap-v1-core-from-report` 的 scope
- 不改動 `document-ingestion-and-publishing` 核心契約（staged upload、versioned replay truth、current version publishing）

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `admin-document-management-ui`：加入 Document Lifecycle Operations 需求（retry sync、delete draft、archive / unarchive），涵蓋 UI 觸點與對應 admin-only mutation API 的授權與狀態轉移規則

## Impact

- Affected specs: `admin-document-management-ui`
- Affected code:
  - `server/api/admin/documents/[id]/versions/[versionId]/retry-sync.post.ts`（新）
  - `server/api/admin/documents/[id].delete.ts`（新）
  - `server/api/admin/documents/[id]/archive.post.ts`（新）
  - `server/api/admin/documents/[id]/unarchive.post.ts`（新）
  - `app/components/documents/DocumentListTable.vue`（修：actions menu）
  - `app/pages/admin/documents/[id].vue`（修：toolbar + 版本列 retry 按鈕）
  - `shared/schemas/admin-documents.ts` 或等價處（新增 request/response schema）
  - `test/**`（integration tests for 4 mutation endpoints + UI smoke）
- Affected systems: D1（文件與版本狀態轉移）、runtime admin middleware、AI Search（間接，retry 觸發同步）
- Affected runtime bindings：沿用既有 D1 / R2 / KV bindings，無新增

## Affected Entity Matrix

### Entity: documents

| Dimension       | Values                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------- |
| Columns touched | `status`（值域不變：`draft` / `active` / `archived`）、`archivedAt`                      |
| Roles           | admin                                                                                    |
| Actions         | delete（draft-never-published 限定）、archive、unarchive                                 |
| States          | empty、loading、error、unauthorized、success、conflict（伺服器拒絕刪除）                 |
| Surfaces        | `/admin/documents`（列表 actions menu）、`/admin/documents/[id]`（toolbar + 確認對話框） |

### Entity: document_versions

| Dimension       | Values                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Columns touched | `sync_status`（`pending` / `failed` → `running`）                                               |
| Roles           | admin                                                                                           |
| Actions         | retry-sync                                                                                      |
| States          | empty、loading、error、unauthorized、success、conflict（已 running / completed / 缺前處理資料） |
| Surfaces        | `/admin/documents/[id]` 版本歷史每一列                                                          |

## User Journeys

### 殘留 draft 復原流程

- **Admin** 在 `/admin/documents` 看到一筆卡住的 draft（`status = draft`、`current_version = 0`、某 version `sync_status = pending`）
- 點列表 actions menu → 選擇「重試同步」：版本歷史該列 retry 按鈕觸發，`sync_status` 推進為 `running`，等待同步完成
- 若同步無法救回（檔案壞 / 前處理缺件）：伺服器回 `409 Conflict` 附原因；admin 改從 actions menu 選擇「刪除」→ 確認對話框顯示將刪除 `N` 個版本與 `source_chunks` → 確認 → draft 從列表消失

### 已發布文件下架流程

- **Admin** 在 `/admin/documents` 列表或 `/admin/documents/[id]` 詳情頁選擇某個 `status = active` 文件
- 點「封存」動作 → 確認對話框說明「此文件將不再出現於對外檢索，但引用仍保留至 retention 期滿」 → 確認
- 列表該文件狀態轉為 `archived`，actions menu 變更為顯示「解除封存」
- 後續若需恢復：選「解除封存」→ 確認 → `status` 還原為 `active`

### 失敗版本重試流程

- **Admin** 在 `/admin/documents/[id]` 版本歷史看到某版本 `sync_status = failed`
- 該列顯示 retry 按鈕；點擊 → 無確認對話框，直接發送請求 → 按鈕 disable 並顯示「同步中」
- 同步完成 → 狀態自動更新為 `completed` 並 `index_status = indexed`；若再次失敗 → 按鈕恢復可點，錯誤訊息顯示
