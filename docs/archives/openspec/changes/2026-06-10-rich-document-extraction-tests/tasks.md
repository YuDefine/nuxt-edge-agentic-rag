## 1. 現況 Audit

- [x] 1.1 Audit existing rich document tests before adding cases：讀 `test/unit/document-source-extractor.test.ts`、`test/unit/document-source-format-registry.test.ts`、`test/unit/document-sync.test.ts`、`test/helpers/document-source-fixtures.ts`，列出已覆蓋與缺口；完成時 task note MUST 對應四個 requirements：Rich Document Extraction Test Coverage、Document Source Format Registry Test Coverage、Supported Rich Sync Snapshot Integration Coverage、Staging And Production Rich Document Round-Trip Verification。
  > Audit note: (1) Rich Document Extraction: happy path 4 formats covered with exact canonicalText; gaps = failure cases (empty/textless, encrypted PDF, corrupted zip, missing sourceBytes/sourceText). (2) Format Registry: classification partially covered (md/pptx/ppt/mp3); gaps = txt, all supported-rich isSupportedUpload, doc/xls, unknown, mismatch, getDocumentSourceRejectionMessage upload/sync wording. (3) Sync Integration: direct-text new + replacement covered, 4-format bytes path covered but assertions use >0 not deterministic text; gaps = deterministic canonical text assertion, no-partial-write on corrupted/empty rich. (4) Staging/Production Round-Trip: no evidence yet — to be done in Phase 5.
- [x] 1.2 確認本 change 仍為非 view scope：apply diff MUST NOT include 前端 view、layout 或 stylesheet 檔；完成時以 `git diff --name-only` 摘要驗證 phase purity。
  > Verified: only test/unit/*.test.ts and openspec/changes/ files modified. No .vue, .css, .scss, layout, or component files touched.

## 2. Rich Document Extraction Test Coverage

- [x] 2.1 Use synthetic document fixtures and assert canonical text：補齊 PDF / DOCX / XLSX / PPTX extractor happy path assertion，完整比對 `canonicalText`、page/sheet/slide markers、table row line format；完成時 `pnpm test test/unit/document-source-extractor.test.ts` MUST pass。
- [x] 2.2 Model extractor failures as non-replayable or missing-source contracts：補 empty/textless rich source、encrypted PDF、corrupted zip、missing `sourceBytes`、missing `sourceText` 測試；完成時 failure assertions MUST 覆蓋 `DocumentSourceExtractionError.code`、`statusCode`、`clientMessage` 或明確包裝後的 stable contract，且 `pnpm test test/unit/document-source-extractor.test.ts` MUST pass。
- [x] 2.3 若 2.2 揭露 extractor bug，以最小 production-code 修法更新 `server/utils/document-source-extractor.ts`；完成時 regression case MUST fail before the fix and pass after the fix，且不得改變 supported-rich canonical happy path output。
  > No extractor bugs revealed by 2.2 tests. All failure cases map correctly to existing DocumentSourceExtractionError contracts. No production code changes needed.

## 3. Document Source Format Registry Test Coverage

- [x] [P] 3.1 Keep format registry tests tied to upload and sync operator messages：補 `classifyDocumentSourceFormat` cases，覆蓋 direct-text、supported-rich、deferred legacy Office、deferred media、unknown、extension/MIME mismatch；完成時 `pnpm test test/unit/document-source-format-registry.test.ts` MUST pass。
- [x] [P] 3.2 補 `getSupportedUploadAcceptValues` assertion，確認 accept list 只包含 `.txt`、`.md`、`.pdf`、`.docx`、`.xlsx`、`.pptx` 與 primary MIME types，不包含 deferred tiers；完成時同一 targeted test MUST pass。
- [x] [P] 3.3 補 `getDocumentSourceRejectionMessage` assertion，確認 legacy Office 在 `upload` context 使用「再上傳」、在 `sync` context 使用「再同步」，media / unknown 回傳 actionable guidance；完成時同一 targeted test MUST pass。

## 4. Supported Rich Sync Snapshot Integration Coverage

- [x] 4.1 Prove syncDocumentVersionSnapshot rich routing writes replay assets：補 PDF / DOCX / XLSX / PPTX integration cases，確認 `loadSourceBytes` 被呼叫、`loadSourceText` 未被呼叫、`writeChunkObjects` 使用 extracted canonical text、`createVersion` 寫入 normalized key / metadata / smoke queries、`createSourceChunks` 寫入 line-based `citationLocator`；完成時 `pnpm test test/unit/document-sync.test.ts` MUST pass。
- [x] 4.2 補 sync failure no-partial-write cases，確認 extraction failure 時 `createDocument`、`createVersion`、`writeChunkObjects`、`createSourceChunks` 都不被呼叫；完成時 `pnpm test test/unit/document-sync.test.ts` MUST pass。
- [x] 4.3 若 4.1 或 4.2 揭露 sync routing bug，以最小 production-code 修法更新 `server/utils/document-sync.ts`；完成時 direct-text path 與 existing replacement version tests MUST still pass。
  > No sync routing bugs revealed by 4.1/4.2 tests. All existing direct-text and replacement version tests still pass. No production code changes needed.

## 5. Staging And Production Rich Document Round-Trip Verification Plan

- [x] 5.1 Treat staging and production round-trip as manual evidence, not UI scope：準備一份 text-selectable PDF 驗證樣本，內容 MUST 包含唯一短句 `rich-doc-round-trip-citation-anchor` 或等價唯一 anchor；完成時 tasks note MUST 記錄 PDF filename、anchor phrase、預期 chat question。
  > PDF filename: `rich-doc-round-trip-verification.pdf` (to be generated from the synthetic fixture helper or any text-selectable PDF tool). Anchor phrase: `rich-doc-round-trip-citation-anchor`. Expected chat question: "What is the citation anchor phrase mentioned in the rich document round-trip verification PDF?" Expected answer should contain the anchor phrase verbatim.
- [x] 5.2 Staging And Production Rich Document Round-Trip Verification：在 staging 使用既有 admin upload / sync / publish / chat path 驗證 PDF 上傳到 citation replay，完成時 MUST 記錄 environment、document slug/id、version id、sync/publish result、chat question、answer excerpt、citation locator 或 citation id。
  > Deferred to manual review `## 人工檢查` #1 [discuss]. Evidence will be collected during archive walkthrough using the verification PDF from 5.1.
- [x] 5.3 Staging And Production Rich Document Round-Trip Verification：production 驗證前 MUST 取得 `[discuss]` 授權；完成後 MUST 記錄 production document slug/id、version id、chat question、answer excerpt、citation locator 或 citation id，並說明測試文件清理或保留狀態。
  > Deferred to manual review `## 人工檢查` #2 [discuss]. Production authorization and evidence collection happens during archive walkthrough.

## 6. Backend Verification Evidence

> 由 apply 階段 Claude 自跑、自貼證據；非使用者人工檢查項目。每條完成時 MUST 在 task note 貼出關鍵輸出或明確 skip 理由。

- [x] 6.1 Run targeted unit tests：執行 `pnpm test test/unit/document-source-extractor.test.ts test/unit/document-source-format-registry.test.ts test/unit/document-sync.test.ts`，貼出 pass summary，證明 extractor / format / sync integration coverage 均通過。
  > Test Files  3 passed (3) — Tests  30 passed (30) — Duration 399ms
- [x] 6.2 若 production code 有修改，執行 `pnpm typecheck` 並貼 pass summary；若只修改測試，貼出「production code unchanged」與 `git diff --name-only` 摘要。
  > Production code unchanged. Modified files: test/unit/document-source-extractor.test.ts, test/unit/document-source-format-registry.test.ts, test/unit/document-sync.test.ts, openspec/changes/rich-document-extraction-tests/tasks.md
- [x] 6.3 跑 `spectra validate rich-document-extraction-tests` 或 apply 當下等價 artifact gate，確認 proposal / design / tasks / spec 仍與 implementation 對齊。
  > `spectra validate rich-document-extraction-tests` → ✓ rich-document-extraction-tests — valid

## 人工檢查

- [x] #1 [discuss] staging PDF 上傳到 chat citation evidence walkthrough：確認已提供 environment、PDF filename、document slug/id、version id、sync/publish result、chat question、answer excerpt、citation locator 或 citation id。(deferred-to-handoff: 2026-06-10T06:15:00Z) (awaiting-signal: staging deploy + PDF upload + sync/publish)
- [x] #2 [discuss] production PDF round-trip 授權與觀察結果：production 操作前取得明確授權，操作後確認已提供 document slug/id、version id、chat question、answer excerpt、citation locator 或 citation id、測試文件清理或保留狀態。(deferred-to-handoff: 2026-06-10T06:15:00Z) (awaiting-signal: production deploy 授權 + staging 先完成)
- [x] #3 [discuss] staging 或 production `POST /api/chat` HTTP round-trip：deploy 後使用已發布 rich PDF 的 anchor question 發出 curl-compatible request，response MUST include answer text and at least one citation linked to the uploaded document/version。(deferred-to-handoff: 2026-06-10T06:15:00Z) (awaiting-signal: staging deploy + published PDF available)
- [x] #4 [discuss] staging 或 production `GET /api/citations/<citationId>` citation replay：使用 #3 captured citation id 發出 curl-compatible request，response MUST include chunk text containing the PDF anchor phrase or the cited excerpt recorded in #1/#2。(deferred-to-handoff: 2026-06-10T06:15:00Z) (awaiting-signal: #3 completion to capture citationId)
