## 1. 現況 Audit

- [ ] 1.1 Audit existing rich document tests before adding cases：讀 `test/unit/document-source-extractor.test.ts`、`test/unit/document-source-format-registry.test.ts`、`test/unit/document-sync.test.ts`、`test/helpers/document-source-fixtures.ts`，列出已覆蓋與缺口；完成時 task note MUST 對應四個 requirements：Rich Document Extraction Test Coverage、Document Source Format Registry Test Coverage、Supported Rich Sync Snapshot Integration Coverage、Staging And Production Rich Document Round-Trip Verification。
- [ ] 1.2 確認本 change 仍為非 view scope：apply diff MUST NOT include 前端 view、layout 或 stylesheet 檔；完成時以 `git diff --name-only` 摘要驗證 phase purity。

## 2. Rich Document Extraction Test Coverage

- [ ] 2.1 Use synthetic document fixtures and assert canonical text：補齊 PDF / DOCX / XLSX / PPTX extractor happy path assertion，完整比對 `canonicalText`、page/sheet/slide markers、table row line format；完成時 `pnpm test test/unit/document-source-extractor.test.ts` MUST pass。
- [ ] 2.2 Model extractor failures as non-replayable or missing-source contracts：補 empty/textless rich source、encrypted PDF、corrupted zip、missing `sourceBytes`、missing `sourceText` 測試；完成時 failure assertions MUST 覆蓋 `DocumentSourceExtractionError.code`、`statusCode`、`clientMessage` 或明確包裝後的 stable contract，且 `pnpm test test/unit/document-source-extractor.test.ts` MUST pass。
- [ ] 2.3 若 2.2 揭露 extractor bug，以最小 production-code 修法更新 `server/utils/document-source-extractor.ts`；完成時 regression case MUST fail before the fix and pass after the fix，且不得改變 supported-rich canonical happy path output。

## 3. Document Source Format Registry Test Coverage

- [ ] [P] 3.1 Keep format registry tests tied to upload and sync operator messages：補 `classifyDocumentSourceFormat` cases，覆蓋 direct-text、supported-rich、deferred legacy Office、deferred media、unknown、extension/MIME mismatch；完成時 `pnpm test test/unit/document-source-format-registry.test.ts` MUST pass。
- [ ] [P] 3.2 補 `getSupportedUploadAcceptValues` assertion，確認 accept list 只包含 `.txt`、`.md`、`.pdf`、`.docx`、`.xlsx`、`.pptx` 與 primary MIME types，不包含 deferred tiers；完成時同一 targeted test MUST pass。
- [ ] [P] 3.3 補 `getDocumentSourceRejectionMessage` assertion，確認 legacy Office 在 `upload` context 使用「再上傳」、在 `sync` context 使用「再同步」，media / unknown 回傳 actionable guidance；完成時同一 targeted test MUST pass。

## 4. Supported Rich Sync Snapshot Integration Coverage

- [ ] 4.1 Prove syncDocumentVersionSnapshot rich routing writes replay assets：補 PDF / DOCX / XLSX / PPTX integration cases，確認 `loadSourceBytes` 被呼叫、`loadSourceText` 未被呼叫、`writeChunkObjects` 使用 extracted canonical text、`createVersion` 寫入 normalized key / metadata / smoke queries、`createSourceChunks` 寫入 line-based `citationLocator`；完成時 `pnpm test test/unit/document-sync.test.ts` MUST pass。
- [ ] 4.2 補 sync failure no-partial-write cases，確認 extraction failure 時 `createDocument`、`createVersion`、`writeChunkObjects`、`createSourceChunks` 都不被呼叫；完成時 `pnpm test test/unit/document-sync.test.ts` MUST pass。
- [ ] 4.3 若 4.1 或 4.2 揭露 sync routing bug，以最小 production-code 修法更新 `server/utils/document-sync.ts`；完成時 direct-text path 與 existing replacement version tests MUST still pass。

## 5. Staging And Production Rich Document Round-Trip Verification Plan

- [ ] 5.1 Treat staging and production round-trip as manual evidence, not UI scope：準備一份 text-selectable PDF 驗證樣本，內容 MUST 包含唯一短句 `rich-doc-round-trip-citation-anchor` 或等價唯一 anchor；完成時 tasks note MUST 記錄 PDF filename、anchor phrase、預期 chat question。
- [ ] 5.2 Staging And Production Rich Document Round-Trip Verification：在 staging 使用既有 admin upload / sync / publish / chat path 驗證 PDF 上傳到 citation replay，完成時 MUST 記錄 environment、document slug/id、version id、sync/publish result、chat question、answer excerpt、citation locator 或 citation id。
- [ ] 5.3 Staging And Production Rich Document Round-Trip Verification：production 驗證前 MUST 取得 `[discuss]` 授權；完成後 MUST 記錄 production document slug/id、version id、chat question、answer excerpt、citation locator 或 citation id，並說明測試文件清理或保留狀態。

## 6. Backend Verification Evidence

> 由 apply 階段 Claude 自跑、自貼證據；非使用者人工檢查項目。每條完成時 MUST 在 task note 貼出關鍵輸出或明確 skip 理由。

- [ ] 6.1 Run targeted unit tests：執行 `pnpm test test/unit/document-source-extractor.test.ts test/unit/document-source-format-registry.test.ts test/unit/document-sync.test.ts`，貼出 pass summary，證明 extractor / format / sync integration coverage 均通過。
- [ ] 6.2 若 production code 有修改，執行 `pnpm typecheck` 並貼 pass summary；若只修改測試，貼出「production code unchanged」與 `git diff --name-only` 摘要。
- [ ] 6.3 跑 `spectra validate rich-document-extraction-tests` 或 apply 當下等價 artifact gate，確認 proposal / design / tasks / spec 仍與 implementation 對齊。

## 人工檢查

- [ ] #1 [discuss] staging PDF 上傳到 chat citation evidence walkthrough：確認已提供 environment、PDF filename、document slug/id、version id、sync/publish result、chat question、answer excerpt、citation locator 或 citation id。
- [ ] #2 [discuss] production PDF round-trip 授權與觀察結果：production 操作前取得明確授權，操作後確認已提供 document slug/id、version id、chat question、answer excerpt、citation locator 或 citation id、測試文件清理或保留狀態。
- [ ] #3 [verify:api] staging 或 production `POST /api/chat` HTTP round-trip：使用已發布 rich PDF 的 anchor question 發出 curl-compatible request，response MUST include answer text and at least one citation linked to the uploaded document/version。
- [ ] #4 [verify:api] staging 或 production `GET /api/citations/<citationId>` citation replay：使用 #3 captured citation id 發出 curl-compatible request，response MUST include chunk text containing the PDF anchor phrase or the cited excerpt recorded in #1/#2。
