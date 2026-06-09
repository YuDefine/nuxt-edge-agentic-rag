## Context

`document-ingestion-and-publishing` 已要求 `.pdf`、`.docx`、`.xlsx`、`.pptx` 走 supported-rich tier，先抽成 line-oriented canonical snapshot，再建立 `normalized_text_r2_key`、`smoke_test_queries_json` 與 `source_chunks`。目前 repo 已有 `test/unit/document-source-extractor.test.ts`、`test/unit/document-source-format-registry.test.ts`、`test/unit/document-sync.test.ts`，但覆蓋集中在 happy path 與部分 sync routing，尚未把失敗模式與 staging / production round-trip 驗證計畫固化。

本 change 不碰 UI、不碰 schema、不新增格式。apply 階段的工作是補測試缺口、必要時修被測試揭露的 bug，並把 staging / production 的手動上傳到 chat/citation 驗證寫成可執行 checklist。

## Goals / Non-Goals

**Goals:**

- 讓 PDF / DOCX / XLSX / PPTX extractor 各自有 deterministic fixture 與 canonical text assertion。
- 讓 empty / encrypted PDF / corrupted zip / missing source 對應到既有 `DocumentSourceExtractionError` contract，並驗證不產生 partial replay assets。
- 讓 `classifyDocumentSourceFormat`、`getSupportedUploadAcceptValues`、`getDocumentSourceRejectionMessage` 覆蓋 supported-rich、legacy Office、media、unknown 與 upload/sync 文案差異。
- 讓 `syncDocumentVersionSnapshot` 的 supported-rich integration 證明 extract → chunk object → `document_versions` → `source_chunks` 的成功路徑，以及失敗時不寫入。
- 讓 staging / production 手動驗證有清楚 evidence shape：測試 PDF、sync/publish 結果、chat 問答、citation locator 與引用文字。

**Non-Goals:**

- 不新增 `.doc` / `.xls` / `.ppt` / audio / video 支援。
- 不重寫 XML parser 或替換 `pdfjs-dist` / `fflate`。
- 不調整 UploadWizard MIME allowlist 或任何 `.vue` / page / component。
- 不新增 DB seed；staging / production 驗證使用一次性 admin 上傳文件。
- 不把 AI Search provider chunk id 變成 replay truth；truth layer 仍是 normalized text 與 `source_chunks`。

## Decisions

### Audit existing rich document tests before adding cases

apply 階段先讀既有三個測試檔與 `test/helpers/document-source-fixtures.ts`，整理已覆蓋與未覆蓋案例，再只補缺口。這避免把現有 happy path 測試搬成重複 cases，也讓「背景曾認為零測試」的資訊落到目前 repo 狀態。

替代方案：刪掉重寫全部測試。拒絕原因：會增加 diff 與 regression 風險，且目前 fixture helper 已可產生最小 PDF / Office Open XML fixture。

### Use synthetic document fixtures and assert canonical text

單元測試使用 `createPdfFixture`、`createDocxFixture`、`createXlsxFixture`、`createPptxFixture` 或在同 helper 內補最小變體 fixture。每個 supported-rich format 都必須 assert 完整 `canonicalText`，不是只 assert `length > 0`。XLSX / PPTX 的 sheet / slide marker 與 PDF page marker 必須在 assertion 內出現，確保 citation locator 的 line-oriented input 穩定。

替代方案：用 repo 內真實 report 檔。拒絕原因：大型 binary fixture 會讓測試慢、diff 難審，也不利於 edge case 精準控制。

### Model extractor failures as non-replayable or missing-source contracts

edge cases 不新增新的 error hierarchy。missing `sourceBytes` / `sourceText` 應維持 `missing-source` 500 contract；空內容、加密 PDF、壞 zip、結構不完整 Office Open XML 應歸入 `non-replayable-source` 或既有 extractor error mapping，測試需確認 `statusCode`、`code`、client-facing message 是否符合現行 server route 封裝期待。

替代方案：在測試裡只用 `toThrow()`。拒絕原因：只驗 throw 不能保證 API route 對外仍是可操作的 rejection，而這是 upload/sync operator 會看到的 contract。

### Keep format registry tests tied to upload and sync operator messages

`document-source-format` 測試要同時驗 classification 與 rejection message，尤其是 legacy Office 在 `upload` context 需顯示「再上傳」、在 `sync` context 需顯示「再同步」；media 與 unknown 則使用各自 guidance。`getSupportedUploadAcceptValues` 必須只含 direct-text 與 supported-rich 的 extension + primary MIME，不包含 deferred tiers。

替代方案：只測 `supportTier`。拒絕原因：frontend accept list 與 server rejection message 都消費同一 registry；只測 tier 無法保護 operator-facing guidance。

### Prove syncDocumentVersionSnapshot rich routing writes replay assets

integration test 必須 mock `loadSourceBytes` / `loadSourceText`，並對每個 supported-rich case 確認只呼叫 `loadSourceBytes`、`writeChunkObjects` 收到 canonical snapshot chunk、`createVersion` 收到 expected metadata / normalized key / smoke queries、`createSourceChunks` 收到 line locator。失敗 case 必須確認 `createDocument`、`createVersion`、`createSourceChunks`、`writeChunkObjects` 都未被呼叫或未產生 partial write。

替代方案：只測 extractor，假設 sync routing 正確。拒絕原因：`syncDocumentVersionSnapshot` 是 supported-rich 與 replay truth 的整合邊界，錯走 `loadSourceText` 或先寫 document 再失敗都會造成 staging/prod cleanup 成本。

### Treat staging and production round-trip as manual evidence, not UI scope

staging / production 驗證使用既有 admin upload / sync / publish / chat UI，但本 change 不改 UI。tasks 的 `## 人工檢查` 只保留 `[discuss]` production/staging 觀察與 `[verify:api]` 可用 HTTP 重現的 round-trip；SSH / psql / R2 object / log 查核放入 `## Backend Verification Evidence`，由 apply 階段 Claude 自跑或貼證據。

替代方案：新增 Playwright E2E。拒絕原因：目前需求明確要求 human staging/prod 手動上傳驗證，且 production 觀察需要授權與真環境狀態；本 change 不應新增 UI automation scope。

## Implementation Contract

- Behavior: supported-rich extraction tests 必須覆蓋 PDF / DOCX / XLSX / PPTX canonical text 與 failure cases；format registry tests 必須覆蓋 classification、accept list、rejection message；sync integration tests 必須覆蓋 rich source bytes path 與 no-partial-write failure path。
- Interface / data shape: `extractDocumentSourceSnapshot` 回傳 `{ canonicalText, sourceFormat }`；failure 使用 `DocumentSourceExtractionError` 的 `code`、`statusCode`、`clientMessage`；`syncDocumentVersionSnapshot` 透過 `loadSourceBytes` / `loadSourceText`、`writeChunkObjects`、`DocumentSyncStore` mock 觀察 contract。
- Failure modes: empty rich source、encrypted PDF、corrupted zip、missing bytes/text 都必須有 deterministic assertion；若現有 extractor 對 pdfjs / fflate raw error 未包成可預期 contract，apply 階段應以最小修法修正並保留 regression test。
- Acceptance criteria: targeted command `pnpm test test/unit/document-source-extractor.test.ts test/unit/document-source-format-registry.test.ts test/unit/document-sync.test.ts` 通過；若改 production code，另跑 `pnpm typecheck`。staging / production checklist 完成時必須能指出測試 PDF 的 document/version、sync/publish 結果、chat query、answer citation 與引用片段。
- Scope boundaries: 不改 UploadWizard、不新增 migration、不新增格式、不改 AI Search provider integration；若 staging/prod 發現非 extraction 的 chat grounding 或 auth 問題，登記到 `docs/tech-debt.md` 或 `HANDOFF.md`，不在本 change 內展開。

## Risks / Trade-offs

- [Risk] `pdfjs-dist` 對手工最小 PDF 或 encrypted PDF 的錯誤訊息可能因版本改變而漂移。→ Mitigation：測試 assert stable `DocumentSourceExtractionError` contract 與 code/status，而不是 raw pdfjs wording。
- [Risk] Office Open XML fixture 太簡化，無法代表真實 docx/xlsx/pptx。→ Mitigation：保留 synthetic fixture 作 deterministic unit，staging/prod 手動 PDF round-trip 補真環境 evidence；若未來要擴真實 Office fixture，另開 change。
- [Risk] production 手動驗證會建立測試文件。→ Mitigation：使用 clearly named 測試文件與既有 admin flow，tasks 要求紀錄 document slug/version 並在驗證後依既有管理流程清理或標記。
- [Risk] 現有測試已覆蓋部分 happy path，新增測試可能重複。→ Mitigation：第一個 task 明確要求 audit 現有測試，新增 cases 需對應未覆蓋 failure / message / integration assertion。

## Migration Plan

- 無 migration、無 rollout flag、無 schema 變更。
- apply 後先跑 targeted unit tests；若 production code 有修正再跑 `pnpm typecheck`。
- staging 驗證先完成並留下 evidence，再進 production 觀察型 manual review。
- rollback 為移除測試新增段落與任何由 failing tests 驅動的最小 bugfix；因無資料結構變更，不需要 DB rollback。

## Open Questions

無。
