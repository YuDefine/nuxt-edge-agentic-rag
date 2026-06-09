## Why

PDF / DOCX / XLSX / PPTX source extraction 已是文件發布與 citation replay 的正式路徑，但目前測試覆蓋只驗到 happy path 與部分 sync routing，尚未把空檔、加密 PDF、壞 zip、missing bytes / text、分類 rejection message、以及 staging / production 的上傳到 chat round-trip 寫成可追溯驗證。這會讓 supported-rich tier 在 deploy 後只能靠人工踩點發現抽取或 citation 失效。

## What Changes

- 補齊 `server/utils/document-source-extractor.ts` 的 rich extractor 單元測試：PDF、DOCX、XLSX、PPTX happy path 與 empty / encrypted PDF / corrupted zip / missing source 等 non-replayable 或 missing-source edge cases。
- 補齊 `shared/utils/document-source-format.ts` 的分類、upload accept values、以及 `getDocumentSourceRejectionMessage` 測試，覆蓋 supported-rich、legacy Office、media、unknown、extension/MIME mismatch 與 upload/sync 文案差異。
- 加嚴 `syncDocumentVersionSnapshot` integration coverage，確認 supported-rich 會走 `loadSourceBytes`、抽成 canonical text、建立 normalized text chunk object、寫入 `document_versions` 與 `source_chunks`，且失敗時不建立 document/version/chunk。
- 設計 staging / production 手動驗證計畫：使用既有 admin 上傳流程上傳 PDF，觸發 sync / publish 後在 chat 問答，確認答案 citation 指向該 PDF 抽取出的 line-oriented snapshot。
- 實作前先 audit 既有 `test/unit/document-source-extractor.test.ts`、`test/unit/document-source-format-registry.test.ts`、`test/unit/document-sync.test.ts`，只補缺口，不重複搬移測試。

## Non-Goals (optional)

- 不改 extraction 邏輯本身，除非新增測試揭露既有 bug；若需要修 bug，必須把 regression case 留在同一 change。
- 不新增格式支援，不支援 `.doc` / `.xls` / `.ppt` 或媒體 transcript pipeline。
- 不改前端 UploadWizard、admin 頁面、chat UI 或任何前端 view 檔。
- 不新增 seed / fixture 到資料庫；staging / production 驗證使用既有 admin 手動上傳流程與一次性測試文件。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `document-ingestion-and-publishing`: supported-rich 文件抽取路徑必須具備 extractor / format / sync integration 測試覆蓋，並在 staging / production 以 PDF upload → sync/publish → chat/citation round-trip 留下驗證證據。

## Impact

- Affected specs: `document-ingestion-and-publishing`
- Affected code:
  - New: (none expected)
  - Modified:
    - `test/helpers/document-source-fixtures.ts`
    - `test/unit/document-source-extractor.test.ts`
    - `test/unit/document-source-format-registry.test.ts`
    - `test/unit/document-sync.test.ts`
    - `server/utils/document-source-extractor.ts`（僅當測試揭露 extractor bug）
    - `shared/utils/document-source-format.ts`（僅當測試揭露 classifier / message bug）
    - `server/utils/document-sync.ts`（僅當測試揭露 rich routing bug）
  - Removed: (none)
- APIs / UI surfaces: 不新增 API、不改 UI；staging / production 驗證只使用既有 admin upload / sync / publish 與 chat 問答流程。
- Runtime bindings: 不新增 D1 / R2 / KV / AI Search binding；verification 需分別確認 staging 與 production 使用各自隔離資源。

## Affected Entity Matrix

本 change 不新增或修改 DB entity、enum、column、route 或 UI surface。測試會觀察既有 `documents`、`document_versions`、`source_chunks`、normalized text R2 objects 與 chat citation records，但不改 schema 或資料模型。

| Dimension | Values |
| --- | --- |
| Columns touched | (none) |
| Roles | admin / web user（只作驗證角色，不新增權限） |
| Actions | 測試 extractor / classifier / sync helper；人工驗證既有 upload / sync / publish / chat path |
| States | happy path、empty text、encrypted PDF、corrupted zip、missing source、unsupported/deferred format |
| Surfaces | (none changed) |

## User Journeys

**No user-facing journey (backend-only)**

理由：本 change 只新增/加嚴測試與驗證計畫，不新增或改動使用者可見功能。staging / production 的 upload → chat round-trip 是既有功能的驗證路徑，列入 `tasks.md` 的人工檢查與 backend evidence，不代表此 change 新增 UI scope。

## Implementation Risk Plan

- Truth layer / invariants: `document-ingestion-and-publishing` spec 是需求真相層；`normalized_text_r2_key` 與 `source_chunks` 仍是 citation replay 真相來源；supported-rich 不得繞過 canonical snapshot。
- Review tier: Tier 2。此 change 不改 UI / schema，但觸及 document ingestion 的核心 replay contract，需 unit + integration + staging/prod evidence。
- Contract / failure paths: supported-rich 成功時必須建立 canonical text、chunk object、version、source chunks；empty / encrypted / corrupted / missing source 必須回到既有 `DocumentSourceExtractionError` failure contract，且不建立 partial document/version/chunk。
- Test plan: 跑 targeted unit tests：`pnpm test test/unit/document-source-extractor.test.ts test/unit/document-source-format-registry.test.ts test/unit/document-sync.test.ts`；必要時補 `pnpm test:unit` 或 `pnpm typecheck` 作回歸確認。
- Artifact sync: 本 change 完成後更新 `tasks.md` evidence；若測試揭露 bug 並修 code，需同步 spec delta 與 backend evidence。無 ROADMAP / HANDOFF / docs/tech-debt 變更，除非 apply 階段發現 out-of-scope blocker。
