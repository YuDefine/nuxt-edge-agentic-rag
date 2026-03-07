## MODIFIED Requirements

### Requirement: Staged Upload And Publish Wizard

The system SHALL provide an Admin upload flow that guides the user through presign, file upload, finalize, sync, and publish steps with explicit per-step status feedback. The UI SHALL not allow later steps to run before earlier steps succeed. The first successful publish of a document SHALL atomically promote the document from `draft` to `active` state; subsequent publishes SHALL continue to require `active` state and MUST reject attempts on `archived` documents.

#### Scenario: Invalid file is rejected before upload

- **WHEN** an Admin selects an invalid file type or a file beyond the allowed size limit
- **THEN** the UI shows validation feedback
- **AND** the flow does not call the presign endpoint

#### Scenario: Upload flow progresses through finalize and sync

- **WHEN** an Admin completes presign, direct upload, and finalize successfully
- **THEN** the UI advances to sync
- **AND** displays progress and step outcome for each stage

#### Scenario: Publish requires indexed version

- **WHEN** a version is not yet indexed
- **THEN** the publish action stays disabled or unavailable
- **AND** the UI explains that indexing must succeed before publish

#### Scenario: First publish promotes draft document to active

- **WHEN** an Admin publishes the first indexed version of a document whose status is `draft`
- **THEN** the backend atomically sets `documents.status = 'active'` and marks the version as current within the same transaction
- **AND** the publish endpoint returns success without requiring manual status edits
- **AND** subsequent list reads show the document as `active`

#### Scenario: Archived documents cannot publish new versions

- **WHEN** an Admin attempts to publish a version of a document whose status is `archived`
- **THEN** the backend rejects the request with a 409 status
- **AND** the error message distinguishes `archived` from `draft` so the UI can guide recovery

<!-- @trace
source: add-v1-core-ui
updated: 2026-04-16
code:
  - .agents/commands/doc-sync.md
  - template/HANDOFF.md
-->

## ADDED Requirements

### Requirement: Upload Filename Preserves Unicode Characters

The staged upload pipeline SHALL preserve user-visible Unicode characters (Chinese, Japanese, Korean, accented Latin, emoji) in filenames while stripping only characters that are unsafe for R2 object keys or operating system paths. Stored object keys MUST retain the sanitized original filename so Admins can visually identify uploads in the document list.

#### Scenario: Chinese filename survives sanitization

- **WHEN** an Admin uploads a file named `採購流程.pdf`
- **THEN** the resulting R2 object key retains the Chinese characters verbatim
- **AND** the document list displays `採購流程.pdf` instead of `.pdf` or `upload.bin`

#### Scenario: Unsafe characters are stripped

- **WHEN** an Admin uploads a file named `report/2026:Q1*.pdf` containing path separators and shell metacharacters
- **THEN** the pipeline removes `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, and control characters
- **AND** the resulting filename is a single path segment with the extension preserved

#### Scenario: Empty or extension-only result falls back to generated name

- **WHEN** sanitization produces an empty string or a string whose only remaining content is the file extension
- **THEN** the pipeline substitutes a generated name in the form `upload-<short-hash>.<ext>`
- **AND** the hash is deterministic for a given upload identifier so retries produce stable keys

#### Scenario: Oversized filenames are truncated

- **WHEN** a filename exceeds 255 bytes after UTF-8 encoding
- **THEN** the pipeline truncates the base name while preserving the extension
- **AND** the resulting object key stays within Cloudflare R2 key length limits
