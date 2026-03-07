## Why

核心六步閉環中「publish document」目前**不可用**：admin 透過 UI 上傳文件成功（presign → PUT → finalize → sync 全綠），但下一步發布按鈕必定回傳 `409 Only active documents can publish versions`。

根因：`server/utils/document-sync.ts:83` 建立新文件時寫死 `status = 'draft'`，而 `server/utils/document-publish.ts:44` 拒絕非 `active` 狀態——**沒有任何程式路徑把 `draft → active`**，形成死結。目前只能手動進 D1 console 改欄位才能發布，這直接阻斷 bootstrap 6.2 的 Manual Acceptance。

附帶 pipeline 同側的 UX 漏洞：`server/utils/staged-upload.ts:75-85` 的 `sanitizeFilename` 用 `replace(/[^\p{ASCII}]/gu, '')` 無差別剝除非 ASCII 字元，中文檔名如 `採購流程.md` 被消毒成 `.md`，進 R2 與 D1 後 admin 看到的全是 `.md` / `upload.bin`，等於遺失使用者可辨識的真實檔名。

兩者同屬 document upload/publish pipeline 且都阻礙 end-to-end 使用，合併處理。

## What Changes

### 主要：publish gap

- 修改 `publishDocumentVersion`：若 `document.status === 'draft'` 且首次 publish（`previousCurrentVersionId === null`），自動升格為 `active`，不再 throw 409
- 擴充 `DocumentPublishStore.publishVersionAtomic` 介面：新增 `promoteToActive: boolean` 旗標，在同一筆 atomic transaction 內升格 `documents.status`
- 保留 `draft` 語意：非首次 publish 情境下仍維持 `status !== 'active'` 的 409 拒絕（防止已歸檔文件被重新 publish 舊版本）
- Store 層實作：`hub:db` 版本用單一 `executeBatch` 包 version update + document status update

### 附帶：中文檔名 sanitize

- 重寫 `sanitizeFilename`：改用 NFC normalize + 黑名單過濾（`/ \ : * ? " < > |` + 控制字元）而非 ASCII whitelist
- 保留 Unicode 檔名（中文、日文、韓文、emoji），只剝除作業系統/R2 不允許的字元
- Extension 保留邏輯：若消毒後整段為空或僅剩副檔名（`.md` / `.pdf`），fallback 到 `upload-<short-hash>.<ext>`
- 加檔名長度上限（255 bytes UTF-8）避免 R2 key 過長

## Non-Goals

- **不**引入 `staged_uploads` 表或重設計 sync metadata 驗證（已記錄於 `docs/decisions/2026-04-18-sync-endpoint-staging-verification.md`，下個 cycle 處理）
- **不**改 `documents.status` enum 擴充（保持現有 `draft` / `active` / `archived`）
- **不**支援「pending review」人工審核流程（未來若要加上架前審核再開新 change）
- **不**改 slug 生成邏輯（`slug` 已走另一套 path-based derivation，與 filename sanitize 無關）
- **不**遷移既有 R2 上已存在的 `.md` / `upload.bin` 物件（僅影響新上傳）

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `admin-document-management-ui`: publish action 首次發布時自動將 document 升格為 `active`；檔名 sanitize 保留 Unicode 字元

## Impact

- Affected specs: `admin-document-management-ui`
- Affected code:
  - `server/utils/document-publish.ts`（升格邏輯）
  - `server/utils/staged-upload.ts`（sanitizeFilename 重寫）
  - `server/infra/document-publish-store.ts` 或對應 hub:db 實作（`promoteToActive` 欄位）
  - `server/api/documents/[documentId]/versions/[versionId]/publish.post.ts`（確認 error mapping 不變）
  - `test/unit/document-publish.test.ts`（新增首次 publish 升格、非首次 publish 維持拒絕兩組 scenario）
  - `test/unit/staged-upload.test.ts`（新增中文 / 日文 / emoji filename 保留、危險字元剝除、長度上限 scenarios）
- Affected user journeys: admin 首次「上傳 → 發布」端到端流程解鎖；bootstrap 6.2 Manual Acceptance #1–#5 可實際執行
- Runtime / bindings: 無變動（仍用現有 D1 + R2 binding）
- Breaking: 無（`DocumentPublishStore.publishVersionAtomic` 介面為 internal，新增欄位帶 default `false` 即相容）
