## ADDED Requirements

### Requirement: Rich Document Extraction Test Coverage

系統 SHALL 維護 rich document extraction 單元測試，覆蓋 `application/pdf`、DOCX、XLSX、PPTX supported-rich formats 的 canonical text output。每個 extractor 測試 MUST 使用 deterministic fixture，並 MUST assert 完整 line-oriented canonical text，而不是只 assert 非空內容。

測試 coverage MUST 包含 empty file 或 textless rich source、encrypted PDF、corrupted zip、missing source bytes / text，以及 extractor 回傳 non-replayable 或 missing-source failure contract 的行為。

#### Scenario: Supported rich extractors produce deterministic canonical text

- **WHEN** unit tests call `extractDocumentSourceSnapshot` with PDF, DOCX, XLSX, and PPTX supported-rich fixtures
- **THEN** each result includes the exact expected `canonicalText`
- **AND** PDF output preserves `[Page N]` markers
- **AND** XLSX output preserves `[Sheet: <name>]` markers
- **AND** PPTX output preserves `[Slide N]` markers

##### Example: canonical fixture assertions

| Format | Required marker | Required content assertion |
| --- | --- | --- |
| PDF | `[Page 1]` | page text appears in reading order |
| DOCX | none | paragraphs and table rows are represented as lines |
| XLSX | `[Sheet: Revenue]` | row cells are joined with ` | ` |
| PPTX | `[Slide 1]` | slide text appears after the slide marker |

#### Scenario: Non-replayable rich sources fail before replay assets exist

- **WHEN** unit tests pass empty rich source content, encrypted PDF content, or corrupted zip content to the extractor
- **THEN** the extractor fails through the existing `DocumentSourceExtractionError` contract or an explicitly wrapped extractor error
- **AND** the observed failure identifies the source as non-replayable instead of producing an empty canonical snapshot

#### Scenario: Missing source inputs fail with missing-source contract

- **WHEN** direct-text extraction is called without `sourceText`
- **OR** supported-rich extraction is called without `sourceBytes`
- **THEN** the extractor fails with `code = "missing-source"`
- **AND** the failure status remains an internal server contract rather than an operator-facing unsupported-format rejection

### Requirement: Document Source Format Registry Test Coverage

系統 SHALL 維護 `document-source-format` 單元測試，覆蓋 `classifyDocumentSourceFormat`、`getSupportedUploadAcceptValues`、`getDocumentSourceRejectionMessage` 的 direct-text、supported-rich、deferred legacy Office、deferred media、unknown 與 extension/MIME mismatch 行為。

`getSupportedUploadAcceptValues` output MUST include only direct-text 與 supported-rich extensions and primary MIME types. Rejection message tests MUST verify upload 與 sync contexts 的 operator guidance 差異。

#### Scenario: Format classification covers every support tier

- **WHEN** tests classify `.txt`, `.md`, `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.doc`, `.xls`, `.ppt`, audio/video, and unknown extensions with representative MIME types
- **THEN** each classification returns the expected `supportTier`
- **AND** supported upload formats return `isSupportedUpload = true`
- **AND** deferred and unknown formats return `isSupportedUpload = false`

#### Scenario: Upload accept values exclude deferred formats

- **WHEN** tests call `getSupportedUploadAcceptValues`
- **THEN** the returned list contains `.txt`, `.md`, `.pdf`, `.docx`, `.xlsx`, `.pptx` and their primary MIME types
- **AND** the returned list does not contain `.doc`, `.xls`, `.ppt`, audio MIME prefixes, video MIME prefixes, or unknown extensions

#### Scenario: Rejection messages preserve operator guidance by context

- **WHEN** tests call `getDocumentSourceRejectionMessage` for deferred legacy Office, deferred media, and unknown classifications
- **THEN** legacy Office upload context uses guidance that ends in upload wording
- **AND** legacy Office sync context uses guidance that ends in sync wording
- **AND** media and unknown formats return their configured actionable guidance

### Requirement: Supported Rich Sync Snapshot Integration Coverage

系統 SHALL 維護 `syncDocumentVersionSnapshot` integration-style unit tests，證明 supported-rich document sync 會走 source bytes loading、extract canonical text、prepare replay chunks、write normalized text chunk objects、create `document_versions`、and create `source_chunks` in that order of observable effects.

The tests MUST verify failure paths do not create partial document, version, chunk object, or source chunk records when extraction fails before replay assets are prepared.

#### Scenario: Supported rich sync uses bytes path and writes replay assets

- **WHEN** `syncDocumentVersionSnapshot` receives a finalized PDF, DOCX, XLSX, or PPTX object key and MIME type
- **THEN** the test observes `loadSourceBytes` called with the object key
- **AND** `loadSourceText` is not called
- **AND** `writeChunkObjects` receives chunk objects derived from the extracted canonical text
- **AND** `createVersion` receives `normalizedTextR2Key`, `metadataJson`, and `smokeTestQueriesJson`
- **AND** `createSourceChunks` receives source chunks with line-based `citationLocator` values

#### Scenario: Extraction failure prevents partial writes

- **WHEN** `syncDocumentVersionSnapshot` receives a supported-rich source whose extraction fails as non-replayable or corrupted
- **THEN** the test observes no call to `createDocument`
- **AND** no call to `createVersion`
- **AND** no call to `writeChunkObjects`
- **AND** no call to `createSourceChunks`

### Requirement: Staging And Production Rich Document Round-Trip Verification

系統 SHALL maintain a manual verification plan for staging and production that exercises the existing admin upload, sync, publish, chat, and citation replay path with a PDF source. The verification record MUST identify the environment, uploaded PDF name, document slug or id, version id, sync/publish result, chat question, answer evidence, and citation locator or quoted excerpt.

This verification SHALL NOT require new UI implementation. It SHALL use the existing admin upload flow and existing chat flow. Production verification MUST be treated as production observation and MUST require explicit human discussion before it is marked complete.

#### Scenario: Staging verifies upload to chat citation round-trip

- **WHEN** an admin uploads a text-selectable PDF in staging, syncs it, publishes the version, and asks a chat question whose answer depends on the PDF content
- **THEN** the answer includes a citation that points to the uploaded document version
- **AND** the cited locator or quoted excerpt matches text extracted from the PDF canonical snapshot
- **AND** the verification evidence records the staging document slug or id and version id

#### Scenario: Production verification is recorded as production observation

- **WHEN** production verification is authorized and the same PDF upload to chat citation flow is performed in production
- **THEN** the verification evidence records the production document slug or id, version id, chat question, citation locator, and observed answer excerpt
- **AND** the result is reviewed through a `[discuss]` manual review item before the change is archived
