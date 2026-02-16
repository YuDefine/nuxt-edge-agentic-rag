## 1. 共用基礎

- [x] 1.1 定義 `shared/schemas/admin-documents.ts` 的 request / response Zod schema：`retryDocumentSync`、`deleteDocument`、`archiveDocument`、`unarchiveDocument` 四組
- [x] 1.2 實作 `server/utils/document-deletability.ts`（新增）helper，依 Decision: 以伺服器端狀態判斷 deletability，不信任 client payload — 輸入 documentId，回傳 `{ deletable, reason }`，reason ∈ `'draft-never-published' | 'has-published-history' | 'status-active' | 'status-archived'`

## 2. Document Version Retry Sync Action

- [x] 2.1 [P] 實作 `server/api/admin/documents/[id]/versions/[versionId]/retry-sync.post.ts`，落實 Requirement: Document Version Retry Sync Action 與 Decision: Retry sync 只改 `sync_status`，不動 `index_status`；含 `index_status = preprocessing` 前置資料檢查與 `sync_status = running/completed` 拒絕路徑
- [x] 2.2 [P] 為 Document Version Retry Sync Action 撰寫 integration test：涵蓋 failed → running、preprocessing 缺件拒絕、already running 拒絕、completed 拒絕、非 admin 拒絕五條 scenario

## 3. Hard Delete For Draft-Never-Published Documents

- [x] 3.1 [P] 實作 `server/api/admin/documents/[id].delete.ts`，落實 Requirement: Hard Delete For Draft-Never-Published Documents 與 Decision: Cascade delete 依賴 FK onDelete；使用 1.2 helper 決定可否刪除；拒絕路徑回 `409` 並附 reason 字串
- [x] 3.2 [P] 為 Hard Delete For Draft-Never-Published Documents 撰寫 integration test：draft-never-published 成功、有 published history 拒絕、`status = active` 拒絕、`status = archived` 拒絕、client-supplied force flag 被忽略五條 scenario

## 4. Document Archive And Unarchive Actions

- [x] 4.1 [P] 實作 `server/api/admin/documents/[id]/archive.post.ts`，落實 Requirement: Document Archive And Unarchive Actions 的 archive 路徑與 Decision: Archive 只動 document，不動 version；re-archive 回 no-op success
- [x] 4.2 [P] 實作 `server/api/admin/documents/[id]/unarchive.post.ts`，落實 Requirement: Document Archive And Unarchive Actions 的 unarchive 路徑與 Decision: Unarchive 不強制重新驗證索引狀態；re-unarchive 回 no-op success
- [x] 4.3 為 Document Archive And Unarchive Actions 撰寫 integration test：archive 成功、unarchive 成功、re-archive no-op、re-unarchive no-op、archive 不動 `document_versions.isCurrent`、unarchive 不檢查 `index_status` 六條 scenario

## 5. Lifecycle Action Entry Points In Admin UI

- [x] 5.1 修改 `app/components/documents/DocumentListTable.vue`：actions 欄改用 `UDropdownMenu`，落實 Requirement: Lifecycle Action Entry Points In Admin UI 與 Decision: UI actions menu 採漸進式揭露（draft-never-published → delete；draft-has-published 與 active → archive；archived → unarchive）
- [x] 5.2 修改 `app/pages/admin/documents/[id].vue` toolbar，依 Lifecycle Action Entry Points In Admin UI 加入 archive / unarchive / delete 動作，顯示規則同 5.1
- [x] 5.3 修改 `app/pages/admin/documents/[id].vue` 版本歷史每一列：`sync_status IN (pending, failed)` 時顯示 retry-sync 按鈕；`running` 時 disable 並顯示 loading 文字（Lifecycle Action Entry Points In Admin UI 版本列規格）
- [x] 5.4 實作 `app/composables/useDocumentLifecycle.ts`（新增）：封裝 4 個 API call、共用 toast、失敗時解析 `409 reason` 轉為使用者訊息；順帶落實 Decision: 不引入 idempotency key（仰賴伺服器端狀態做 no-op / 409 dedup）

## 6. Destructive Action Confirmation Dialog

- [x] 6.1 實作 `app/components/documents/LifecycleConfirmDialog.vue`（新增），落實 Requirement: Destructive Action Confirmation Dialog 與 Decision: 破壞性動作皆以確認對話框取得二次同意；顯示動作名稱、影響範圍（刪除時顯示將移除版本與 chunks 數）、當前 Admin email、確認按鈕
- [x] 6.2 在 5.1 / 5.2 的 delete / archive / unarchive 動作接上 6.1 對話框；retry-sync 不接對話框（Destructive Action Confirmation Dialog 規格要求非破壞性動作不彈窗）

## 7. Design Review

- [x] 7.1 檢查 `.impeccable.md` 是否存在，若無則執行 /impeccable teach
- [x] 7.2 執行 /design improve `app/components/documents/DocumentListTable.vue`、`app/pages/admin/documents/[id].vue`、`app/components/documents/LifecycleConfirmDialog.vue`（含 Design Fidelity Report）
- [x] 7.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [x] 7.4 依 /design 計劃按 canonical order 執行 targeted skills
- [x] 7.5 執行 /audit — 確認 Critical = 0
- [x] 7.6 執行 review-screenshot — 視覺 QA
- [x] 7.7 Fidelity 確認 — design-review.md 中無 DRIFT 項

## 8. 人工檢查

- [ ] 8.1 在 staging 重現「殘留 draft 復原流程」：上傳手動造一個 draft-never-published，從列表 actions menu 走「重試同步」與「刪除」兩條路徑
- [ ] 8.2 在 staging 重現「已發布文件下架流程」：對一個 active 文件執行 archive → 驗證 Web 問答不再命中 → unarchive → 驗證回到可檢索
- [ ] 8.3 在 staging 重現「失敗版本重試流程」：人工造一個 `sync_status = failed` 版本，驗證版本歷史該列 retry 按鈕出現、點擊後 disable、同步完成後按鈕消失
- [ ] 8.4 驗證 Decision: 以伺服器端狀態判斷 deletability，不信任 client payload：用 curl 直接 `DELETE /api/admin/documents/[active-id]` 並帶 `{ "force": true }` payload，確認 server 回 `409` 且 payload 被忽略
- [ ] 8.5 驗證非 admin 使用者無法呼叫 4 個 endpoint 之任一（登出或換非 admin 帳號嘗試）
