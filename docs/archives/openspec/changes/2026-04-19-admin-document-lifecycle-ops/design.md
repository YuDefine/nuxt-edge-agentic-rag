## Context

`bootstrap-v1-core-from-report` 已建立 staged upload → publish 的 happy path，但未提供殘留復原與生命週期切換的操作面。現況以下列形式呈現：

- `app/components/documents/DocumentListTable.vue` actions 欄僅有 `檢視` 按鈕
- `app/pages/admin/documents/[id].vue` 僅有 `上傳新版` 按鈕；版本歷史不可對失敗 / 半途 version 重試同步
- `server/api/admin/documents/` 僅有 `GET`（`index.get.ts`、`[id].get.ts`、`check-slug.get.ts`），無任何 mutating endpoint

Schema 已支援：

- `documents.status` 可為 `draft` / `active` / `archived`
- `documents.archivedAt` 欄位存在
- `document_versions.documentId` 設定 `onDelete: cascade`，`source_chunks.documentVersionId` 同設 cascade
- `document_versions.sync_status` 狀態機含 `pending` / `running` / `completed` / `failed`

此 change 填上 lifecycle mutation 層。授權採用現有 runtime admin middleware，資料真相來源全部在 D1，對 AI Search 的影響由既有 sync 管道吸收。

## Goals / Non-Goals

**Goals:**

- 讓 Admin 在 UI 清除 staged upload wizard 失敗造成的 draft 殘留
- 讓 Admin 重試失敗或卡住的 `document_versions.sync_status`
- 讓已發布文件可被 archive / unarchive 而不破壞 citation 回放鏈
- 所有 mutation 嚴格以伺服器端狀態判斷可行性，不信任 client 傳來的前置條件
- UI 明確暴露每個 lifecycle 動作的授權與影響範圍，避免誤觸

**Non-Goals:**

- 不實作已發布文件的 hard delete（交給 retention）
- 不改動 staged upload / publish 既有流程
- 不引入新 role 層、不做二階段確認
- 不改動 AI Search 的反向清除契約
- 不新增 feature flag

## Decisions

### Decision: 以伺服器端狀態判斷 deletability，不信任 client payload

**採用**：`DELETE /api/admin/documents/[id]` 不接受 client 傳的 force / confirm 參數；伺服器在 transaction 內查詢 `documents.status` 與「是否存在任何 `document_versions.published_at IS NOT NULL` 的版本」，兩條件皆符合 `draft-never-published` 才允許刪除，否則回 `409 Conflict` 附上阻擋原因。

**替代方案**：讓 client 傳 `confirm: true` 繞過。**拒絕理由**：payload-based bypass 容易在測試或 curl 操作時意外觸發；伺服器端硬 gate 是唯一正確的 security boundary。

### Decision: Cascade delete 依賴 FK onDelete

**採用**：`DELETE` 操作直接 `delete from documents where id = ?`，利用既有 `document_versions.documentId → onDelete: cascade` 與 `source_chunks.documentVersionId → onDelete: cascade` 自動清除子表。

**替代方案**：手動在應用層逐表刪除。**拒絕理由**：與 D1 transaction 語意重複，且容易遺漏未來新增的子表；靠 schema FK 是 single source of truth。

**風險**：若未來新增 `citation_records` 或其他表直接 FK 到 `document_versions`，cascade 會連帶清除它們。但我們已禁止刪除有 `citation_records` 的 published document，所以這個風險只在開發中的新表上成立；需在未來新增 FK 時重新評估。

**R2 孤兒物件**：FK cascade 僅清除 D1 rows，`document_versions.source_r2_key` 與 `normalized_text_r2_key` 指向的 R2 物件**不會**被刪除。v1.0.0 階段刻意讓孤兒物件留待 retention job 統一清理（若有），以避免在 handler 內做跨系統 best-effort delete 失敗時狀態漂移。handler 內以註解註明此行為；未來若 retention job 不涵蓋 R2 清理，需補上顯式 bucket.delete 或新增背景 GC。

### Decision: Delete / retry-sync 以 compound WHERE 防 TOCTOU

**採用**：刪除 handler 的 `DELETE` 語句加入 `AND status = 'draft' AND NOT EXISTS (… published_at IS NOT NULL)`，並讀取 `returning()` 的列數判斷是否真的刪到；retry-sync handler 的 `UPDATE` 加入 `AND sync_status IN ('pending','failed')`，同樣以 `returning()` 確認。若 0 列影響 → 回 `409 Conflict` 請 caller 重新整理。

**理由**：D1 無 row-level lock，handler 內「讀後寫」有 TOCTOU window。單靠前置讀取無法保證寫入時狀態仍符合前提；compound WHERE + affected-rows 檢查是唯一能在沒有交易的情況下守住 invariants 的方式。尤其 delete 若 race publish，可能造成已發布文件被靜默刪除；retry-sync 若 race sync 完成，可能讓已完成的同步被回退成 running。

**代價**：兩個 admin 同時操作時第二人會收到 409，需要重新整理頁面再試。這個 UX 代價相較於資料完整性風險是可接受的。

### Decision: Retry sync 只改 `sync_status`，不動 `index_status`

**採用**：`POST …/versions/[versionId]/retry-sync` 僅將 `sync_status` 由 `pending` 或 `failed` 設為 `running`，觸發既有 `/api/documents/sync` 流程內部邏輯（或直接 inline 執行該邏輯）。`index_status` 保持原值。

**前置檢查**：

- 若 `index_status = upload_pending`：拒絕（`409`），要求改重新上傳
- 若 `index_status = preprocessing` 且 `normalized_text_r2_key` 為 NULL 或 `source_chunks` 不存在：拒絕（`409`），要求上傳端重跑前處理
- 若 `sync_status = running`：拒絕（`409 already running`）
- 若 `sync_status = completed`：拒絕（`409 nothing to retry`）

**替代方案**：每次 retry 都重建 version 記錄。**拒絕理由**：破壞 `document_versions` 的不可變快照語意，且 `versionNumber` 會膨脹。

### Decision: Archive 只動 document，不動 version

**採用**：`POST …/[id]/archive` 只將 `documents.status` 設為 `archived`、寫入 `archivedAt`；`current_version_id` 不清除；`document_versions.is_current` 不動。

**理由**：archive 是 reversible 操作，unarchive 時需還原 current version。若 archive 清 `current_version_id`，unarchive 後誰是 current 變成需要另外推算，增加不必要的狀態。

**檢索過濾**：答案流程既有過濾條件 `documents.status = active` 已涵蓋 archive 隔離，無需動其他程式碼。

### Decision: Unarchive 不強制重新驗證索引狀態

**採用**：`POST …/[id]/unarchive` 只將 `status` 還原為 `active`、清除 `archivedAt`；不檢查 `document_versions.index_status` 是否仍為 `indexed`。

**理由**：archive 期間 AI Search 索引狀態不會自動失效；若有失效（例如 retention 清除），應由 `retention-cleanup-governance` 的下游邏輯同步降級 version 狀態，而不是 unarchive 時反查。

**Open question**：若 archive 已超過 180 天 retention window，unarchive 是否應該拒絕？**當前決議**：不拒絕，交給 answer 流程的 `index_status = indexed` 過濾自然處理；若日後 retention job 會降級 version，unarchive 的 document 會變成「active 但無 current version」狀態，此時 UI 需引導 admin 重新上傳。此行為在 v1.0.0 範圍可接受。

### Decision: UI actions menu 採漸進式揭露

**採用**：`DocumentListTable.vue` actions 欄以 `UDropdownMenu` 承載動作項；可用動作依 `documents.status` 與 `current_version_id` 動態過濾：

| 當前狀態                  | 可見動作                 |
| ------------------------- | ------------------------ |
| draft + 無 published 版本 | 檢視、刪除               |
| draft + 有 published 版本 | 檢視、封存（不顯示刪除） |
| active                    | 檢視、封存               |
| archived                  | 檢視、解除封存           |

Retry-sync 不放在 document-level menu；出現在 `[id].vue` 的版本歷史每一列，`sync_status IN (pending, failed)` 時顯示。

**替代方案**：所有動作常駐、禁用灰化。**拒絕理由**：`feedback_form_submit_disable_visibility` 規則禁止沉默 disable；但 lifecycle action 的「不可用」理由過於依賴狀態組合，在下拉選單全部列出反而雜訊多。漸進式揭露直接隱藏不適用選項、配合 tooltip 說明路徑更清楚。

### Decision: 破壞性動作皆以確認對話框取得二次同意

**採用**：delete / archive / unarchive 點擊後顯示 `UModal` 確認對話框，內容包含：

- 動作名稱與影響範圍（「此操作將永久刪除 `N` 個版本與其全部原文片段」、「封存後此文件將不再出現於對外檢索」）
- 授權狀態：顯示當前 admin email
- 取消與確認按鈕，確認需額外點擊（不設倒數計時或打字確認）

Retry-sync 不需二次同意（操作非破壞性）。

### Decision: 不引入 idempotency key

**採用**：4 個 endpoint 皆仰賴伺服器端狀態做 idempotency：

- Retry：`sync_status = running` 時拒絕重複觸發
- Delete：目標文件不存在時回 `404`，無副作用
- Archive：已 archived 時回 `200` no-op
- Unarchive：已 active 時回 `200` no-op

**理由**：符合 `api-patterns.md` 的「unique constraint / 狀態 dedup」模式，複雜度低於額外 idempotency key table。

## Risks / Trade-offs

- [Risk] Cascade delete 對未來新增的 `document_versions` 子表有連帶影響 → **Mitigation**：禁止刪除有 `citation_records` 的 published document；未來新增 FK 到 `document_versions` 時必須評估 cascade 行為
- [Risk] Retry sync 若多次失敗會堆積 `failed` 狀態，admin 反覆按鈕可能造成 API 暴風 → **Mitigation**：UI 在 `sync_status = running` 時 disable 按鈕；伺服器端以 `409 already running` 防守；不加 rate limit，AI Search 本身有額度保護
- [Risk] Archive 期間 AI Search 索引若因 retention 被清，unarchive 後 UI 無法直接暴露「需重新上傳」 → **Mitigation**：列表 `currentVersion` 欄位若為 `無版本` 或 `index_status != indexed`，導引 admin 至「上傳新版」；此狀態在 v1.0.0 範圍不強制處理
- [Trade-off] 不做二階段確認 → 簡化 UX；但 admin 誤刪 draft 後無 undo。接受此風險，因為 delete 僅限 draft-never-published，誤刪成本為重新上傳，不涉及對外資料
- [Trade-off] Retry 只改 `sync_status` 不改 `index_status` → 若 preprocessing 失敗後資料殘缺，retry 會在伺服器端檢查時被拒；此錯誤訊息需要 UI 清楚呈現，避免 admin 反覆按 retry 仍無效果
