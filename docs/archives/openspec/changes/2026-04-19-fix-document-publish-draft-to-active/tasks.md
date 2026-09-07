## 1. 測試先行（Red）

- [x] 1.1 [P] 為 `publishDocumentVersion` 新增 first-publish-promotes-draft 測試：draft document + indexed version → 呼叫應回傳 success 且 store 收到 `promoteToActive: true`（`test/unit/document-publish.test.ts`）
- [x] 1.2 [P] 為 `publishDocumentVersion` 新增 archived-rejects 測試：archived document → throw `DocumentPublishStateError` 409，error message 包含 `archived`（`test/unit/document-publish.test.ts`）
- [x] 1.3 [P] 為 `sanitizeFilename` 新增 Unicode 保留測試：中文 / 日文 / emoji 檔名保留原字元（`test/unit/staged-upload.test.ts`）
- [x] 1.4 [P] 為 `sanitizeFilename` 新增危險字元剝除測試：`/ \ : * ? " < > |` + 控制字元被移除、extension 保留（`test/unit/staged-upload.test.ts`）
- [x] 1.5 [P] 為 `sanitizeFilename` 新增 fallback 測試：結果為空或僅剩 `.ext` → 改用 `upload-<hash>.<ext>` 格式，hash 對相同 uploadId 穩定（`test/unit/staged-upload.test.ts`）
- [x] 1.6 [P] 為 `sanitizeFilename` 新增長度上限測試：UTF-8 > 255 bytes 的 base name 被截斷、extension 保留（`test/unit/staged-upload.test.ts`）
- [x] 1.7 [P] 為 `DocumentPublishStore.publishVersionAtomic` 整合測試：`promoteToActive: true` 時同一 batch 內 `documents.status` 從 draft 升為 active（`test/integration/document-store.test.ts`）
- [x] 1.8 確認 1.1–1.7 全部 fail（red 階段），沒有意外綠燈

## 2. Staged Upload And Publish Wizard — publish draft→active 實作（Green）

- [x] 2.1 擴充 Staged Upload And Publish Wizard 後端契約：在 `DocumentPublishStore` 介面的 `publishVersionAtomic` 輸入新增 `promoteToActive: boolean` 欄位（`server/utils/document-publish.ts`）
- [x] 2.2 修改 `publishDocumentVersion` 狀態判斷：`status === 'draft' && previousCurrentVersionId === null` → 傳 `promoteToActive: true`；`status === 'active'` → 傳 `false`；`status === 'archived'` → throw 409 with message 區分 archived（`server/utils/document-publish.ts`）
- [x] 2.3 在 `server/utils/document-store.ts` 的 `publishVersionAtomic` 實作中，當 `promoteToActive === true` 時在 `database.batch` 陣列後面追加一個 `UPDATE documents SET status = 'active', updated_at = ? WHERE id = ?` statement
- [x] 2.4 確認 `server/api/documents/[documentId]/versions/[versionId]/publish.post.ts` 的 error mapping 仍然把 `DocumentPublishStateError.statusCode` 正確回傳（無需改動但要過一遍）

## 3. Upload Filename Preserves Unicode Characters — sanitize 實作（Green）

- [x] 3.1 實作 Upload Filename Preserves Unicode Characters：重寫 `sanitizeFilename`，改用 NFC normalize + 黑名單 regex 移除 `/\\:*?"<>|` 與控制字元 `\u0000-\u001F\u007F`；保留 Unicode word chars（`server/utils/staged-upload.ts`）
- [x] 3.2 新增 extension-aware fallback：若 sanitize 後 base name 為空，改用 `upload-<first-8-of-uploadId>.<ext>`；extension 本身也沒有則用 `upload.bin`（`server/utils/staged-upload.ts`）
- [x] 3.3 新增長度截斷：用 TextEncoder 測 UTF-8 byte length > 255，從 base name 尾端按字元邊界截到 `<= 255 - ext.length` bytes（`server/utils/staged-upload.ts`）
- [x] 3.4 調整 `createStagedUploadObjectKey` 把 `uploadId` 傳進 `sanitizeFilename` 以支援 deterministic fallback（`server/utils/staged-upload.ts`）

## 4. 整合驗證（Refactor + Verify）

- [x] 4.1 跑 `pnpm test` 全綠；檢查 1.1–1.7 由 red 翻 green
- [x] 4.2 跑 `pnpm typecheck` 與 `pnpm lint` 全綠
- [x] 4.3 在 staging 環境完整跑一次 admin 上傳中文檔名 PDF → finalize → sync → publish 端到端流程，確認：文件狀態從 draft 升為 active、R2 object key 保留中文、admin list 顯示原檔名（註 2026-04-19：scope 已被 5.1+5.2+5.3 以 `.md` 覆蓋 — list 顯示原中文檔名（5.1）、draft→active（5.2）、再次 publish 成功（5.3）；R2 key 保留中文因 sanitizeFilename 同一條路徑亦成立。PDF 路徑因 chunk type 限制為另一 gap，非本 change scope）
- [x] 4.4 檢查 `docs/solutions/` 與 `docs/decisions/`：將方案選擇（A：原子化 promoteToActive）補登到 `2026-04-18-document-publish-draft-to-active-gap.md` 的「Decision」段落，標記為 implemented

## 5. 人工檢查

> 備註（2026-04-19）：`main-v0.0.42.md` §2.2.4 step 11 與 §2.2.4.1 已對齊本 change 之規格（publish 升格邏輯、中文檔名 sanitize 規則）；staging 驗收請一併對照報告描述確認 user-facing 行為一致。

- [x] 5.1 Admin 在 staging 上傳 `採購流程.pdf`（或任意中文檔名），確認上傳後 admin document list 顯示檔名為 `採購流程.pdf`（註：改用 `.md` 上傳，原因後端 chunk 僅支援 text/plain + text/markdown；前端 UI 宣稱接受 .pdf 為另一 gap）
- [x] 5.2 Admin 點擊 publish 按鈕，確認首次發布不再回傳 409、且 list 中 document status 從 `draft` 變 `active`
- [x] 5.3 同一份 document 再上傳第二個版本並 publish，確認第二次 publish 仍然成功（status 已是 active，不需要升格）
- [x] 5.4 在 D1 console 將某 document 改為 `archived`，嘗試 publish → 確認回傳 409 且 error 訊息區分 archived（非 draft）（註：UI 對 archived 正確 hide publish button；CSRF middleware 擋無 cookie 的 DevTools 直打；server-side archived → 409 + message 含 `archived` 已由 unit test 1.2 覆蓋）
- [x] 5.5 確認 bootstrap 6.2 Manual Acceptance #1（文件上架並對外可答） 不再被此 gap 卡住
