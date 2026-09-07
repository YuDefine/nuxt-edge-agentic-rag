## ADDED Requirements

### Requirement: Admin Document List UI

The system SHALL provide an Admin-only document list page at `/admin/documents` that displays document title, category, access level, status, current version information, and last updated time. The page SHALL handle loading, empty, unauthorized, and error states explicitly.

#### Scenario: Admin sees document list

- **WHEN** an allowlisted Admin visits `/admin/documents`
- **THEN** the page displays the current document list with status and version information
- **AND** the page provides entry points to upload, sync, or publish where allowed by status

#### Scenario: Non-admin is blocked from the page

- **WHEN** an authenticated user without Admin permission visits `/admin/documents`
- **THEN** the page redirects or blocks access with an unauthorized state
- **AND** the page does not leak document metadata

### Requirement: Staged Upload And Publish Wizard

The system SHALL provide an Admin upload flow that guides the user through presign, file upload, finalize, sync, and publish steps with explicit per-step status feedback. The UI SHALL not allow later steps to run before earlier steps succeed.

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

### Requirement: Version Status Clarity

The document management UI SHALL represent document and version states with explicit labels or badges so that Admins can tell whether a document is draft, active, archived, queued, syncing, indexed, or failed without reading raw backend values.

#### Scenario: Status badges distinguish success, pending, and failure

- **WHEN** the UI renders document or version status
- **THEN** active/indexed states are visually distinct from pending or failed states
- **AND** failed states are immediately scannable in the list or wizard
