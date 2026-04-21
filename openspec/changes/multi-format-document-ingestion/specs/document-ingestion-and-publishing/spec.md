## ADDED Requirements

### Requirement: Canonical Snapshot Extraction By Source Format

The system SHALL classify uploaded source files into direct-text, supported-rich, and deferred source tiers before replay assets are built. `text/plain` and `text/markdown` SHALL continue the direct-text path. `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, and `application/vnd.openxmlformats-officedocument.presentationml.presentation` SHALL be converted into a deterministic line-oriented canonical text snapshot before `normalized_text_r2_key`, `smoke_test_queries_json`, and `source_chunks` are created. Deferred classes, including legacy binary Office formats and audio/video media, SHALL be rejected with actionable guidance.

#### Scenario: Supported rich format creates replay assets from a canonical snapshot

- **WHEN** an Admin syncs a finalized `.pdf`, `.docx`, `.xlsx`, or `.pptx` source file whose extractor can produce meaningful text
- **THEN** the system derives `normalized_text_r2_key`, `smoke_test_queries_json`, and `source_chunks` from the extracted canonical snapshot
- **AND** the resulting replay assets remain compatible with the existing line-based citation contract

#### Scenario: Unsupported legacy Office format is rejected before version creation

- **WHEN** an Admin attempts to sync a finalized `.doc`, `.xls`, or `.ppt` source file
- **THEN** the server rejects the sync request with an actionable 4xx response
- **AND** the system does not create a new `documents` or `document_versions` row for that request

#### Scenario: Textless rich source is rejected as non-replayable

- **WHEN** a finalized supported-rich source file yields no meaningful extractable text
- **THEN** the server rejects the sync request as non-replayable
- **AND** the system does not create replay assets or a new `document_versions` row

#### Scenario: Direct text formats keep the existing direct path

- **WHEN** an Admin syncs a finalized `.txt` or `.md` source file
- **THEN** the system continues the direct-text normalization path
- **AND** the resulting replay assets follow the same `normalized_text_r2_key` and `source_chunks` contract as before
