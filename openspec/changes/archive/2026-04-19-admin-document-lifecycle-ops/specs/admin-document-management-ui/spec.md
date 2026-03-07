## ADDED Requirements

### Requirement: Document Version Retry Sync Action

The system SHALL provide an admin-only action to retry a stuck or failed document version sync. Retrying SHALL advance `document_versions.sync_status` from `pending` or `failed` to `running` without creating a new version record and without altering `document_versions.index_status`. The server SHALL reject retries that cannot make progress and SHALL NOT trust any client-supplied precondition flags.

#### Scenario: Retry advances a failed sync task

- **WHEN** an Admin triggers retry-sync on a version where `sync_status = failed` and `index_status IN (preprocessing, smoke_pending, indexed)`
- **THEN** the server transitions `sync_status` to `running`
- **AND** the existing `document_versions` record is reused with its `versionNumber` unchanged
- **AND** the retry does not alter `index_status`

#### Scenario: Retry is rejected when preprocessing artifacts are missing

- **WHEN** an Admin triggers retry-sync on a version where `index_status = preprocessing` and `normalized_text_r2_key` is NULL or no `source_chunks` exist
- **THEN** the server rejects the request with a conflict response
- **AND** the response explains that the upload side must complete preprocessing before retry is possible

#### Scenario: Retry is rejected when sync is already running

- **WHEN** an Admin triggers retry-sync on a version where `sync_status = running`
- **THEN** the server rejects the request with a conflict response indicating sync is already in progress
- **AND** no state mutation occurs

#### Scenario: Retry is rejected for a completed version

- **WHEN** an Admin triggers retry-sync on a version where `sync_status = completed`
- **THEN** the server rejects the request with a conflict response indicating there is nothing to retry
- **AND** no state mutation occurs

#### Scenario: Non-admin cannot trigger retry

- **WHEN** a caller without current Admin allowlist membership requests retry-sync
- **THEN** the server rejects the request with an unauthorized response
- **AND** no state mutation occurs

---

### Requirement: Hard Delete For Draft-Never-Published Documents

The system SHALL allow an Admin to permanently delete a document if and only if its `documents.status = draft` AND no `document_versions` row belonging to the document has ever been published (`published_at IS NULL` for every version). The server SHALL determine deletability solely from stored state and SHALL NOT accept any client-supplied force or confirm flag to bypass the check. Deletion SHALL cascade to `document_versions` and `source_chunks` via foreign key `onDelete: cascade`.

#### Scenario: Draft document with no published history is deleted

- **WHEN** an Admin deletes a document where `status = draft` and every `document_versions.published_at` is NULL
- **THEN** the `documents` row is removed
- **AND** the cascading foreign keys remove all related `document_versions` and `source_chunks` rows
- **AND** the server returns a success response

#### Scenario: Deletion is rejected for a document that was ever published

- **WHEN** an Admin requests deletion of a document where at least one `document_versions.published_at` is not NULL, even if the document is currently `status = draft`
- **THEN** the server rejects the request with a conflict response
- **AND** the response identifies "document has published history" as the reason
- **AND** the response instructs the Admin to use archive instead

#### Scenario: Deletion is rejected for an active document

- **WHEN** an Admin requests deletion of a document where `status = active`
- **THEN** the server rejects the request with a conflict response
- **AND** no state mutation occurs

#### Scenario: Deletion is rejected for an archived document

- **WHEN** an Admin requests deletion of a document where `status = archived`
- **THEN** the server rejects the request with a conflict response
- **AND** the response clarifies that archived content is retained until the retention window expires

#### Scenario: Client-supplied force flag is ignored

- **WHEN** a deletion request includes any payload field suggesting bypass of the preconditions
- **THEN** the server ignores such fields
- **AND** evaluates deletability from server-side state only

---

### Requirement: Document Archive And Unarchive Actions

The system SHALL allow an Admin to archive a document by setting `documents.status = archived` and writing `documents.archivedAt`, and to unarchive a document by returning `documents.status` to `active` and clearing `documents.archivedAt`. Archive and unarchive SHALL NOT modify `document_versions` or `source_chunks` rows. Archived documents SHALL be excluded from answering and retrieval flows by the existing `documents.status = active` filter. Re-archiving an already archived document and re-unarchiving an already active document SHALL each return a success no-op response.

#### Scenario: Archive sets status and timestamp without touching versions

- **WHEN** an Admin archives a document where `status = active`
- **THEN** `documents.status` becomes `archived`
- **AND** `documents.archivedAt` is set to the current timestamp
- **AND** `documents.currentVersionId` is preserved
- **AND** no `document_versions.isCurrent` values change

#### Scenario: Unarchive restores an archived document

- **WHEN** an Admin unarchives a document where `status = archived`
- **THEN** `documents.status` returns to `active`
- **AND** `documents.archivedAt` is cleared
- **AND** no `document_versions` rows are mutated

#### Scenario: Archived document is excluded from answering

- **WHEN** a Web or MCP answer flow evaluates retrieval eligibility
- **THEN** the existing `documents.status = active` filter excludes all archived documents
- **AND** no additional archive-specific filter logic is required

#### Scenario: Re-archiving returns a no-op success

- **WHEN** an Admin archives a document where `status = archived`
- **THEN** the server returns a success response without mutating state
- **AND** retry semantics remain stable for clients

#### Scenario: Re-unarchiving returns a no-op success

- **WHEN** an Admin unarchives a document where `status = active`
- **THEN** the server returns a success response without mutating state
- **AND** retry semantics remain stable for clients

#### Scenario: Unarchive does not re-validate index state

- **WHEN** an Admin unarchives a document whose current version has been retention-cleaned since archiving
- **THEN** the unarchive action still succeeds
- **AND** downstream answer flows continue to filter on `document_versions.index_status = indexed`
- **AND** the document returns to the Admin view but may appear without a servable current version

---

### Requirement: Lifecycle Action Entry Points In Admin UI

The admin document UI SHALL expose lifecycle actions whose visibility reflects each document's current state. The document list SHALL render an actions menu whose items are filtered by status and publication history. The document detail page SHALL render archive, unarchive, and delete actions in its toolbar according to the same filtering rules. The version history SHALL render a retry action for each version whose `sync_status` is `pending` or `failed`. Unavailable actions SHALL NOT be rendered as disabled controls; the UI SHALL hide them instead.

#### Scenario: Draft document with no published history shows delete action

- **WHEN** the list or detail page renders a document where `status = draft` and no version has `published_at`
- **THEN** the UI shows a delete action
- **AND** the UI does not show archive or unarchive actions

#### Scenario: Draft document with published history shows archive only

- **WHEN** the list or detail page renders a document where `status = draft` and at least one version has `published_at`
- **THEN** the UI shows an archive action
- **AND** the UI does not show a delete action

#### Scenario: Active document shows archive action

- **WHEN** the list or detail page renders a document where `status = active`
- **THEN** the UI shows an archive action
- **AND** the UI does not show a delete action
- **AND** the UI does not show an unarchive action

#### Scenario: Archived document shows unarchive action

- **WHEN** the list or detail page renders a document where `status = archived`
- **THEN** the UI shows an unarchive action
- **AND** the UI does not show a delete action
- **AND** the UI does not show an archive action

#### Scenario: Version history shows retry for pending or failed sync

- **WHEN** the version history row renders a version where `sync_status IN (pending, failed)`
- **THEN** the UI shows a retry-sync action for that row
- **AND** the UI does not show retry for versions with `sync_status IN (running, completed)`

#### Scenario: Retry button is disabled while sync is running

- **WHEN** a retry action was triggered and its `sync_status` is now `running`
- **THEN** the UI disables that row's retry button
- **AND** the UI communicates that the sync task is currently in progress

---

### Requirement: Destructive Action Confirmation Dialog

The admin UI SHALL present a confirmation dialog before invoking delete, archive, or unarchive actions. The dialog SHALL state the action name, describe the impact in concrete terms, and display the current Admin email. The dialog SHALL require an explicit confirm click to proceed. Retry-sync SHALL NOT require a confirmation dialog because it is not destructive.

#### Scenario: Delete opens a confirmation dialog naming impact

- **WHEN** an Admin clicks a delete action in the list or detail page
- **THEN** a confirmation dialog appears
- **AND** the dialog states the number of versions and source chunks that will be removed
- **AND** the dialog displays the current Admin email
- **AND** the dialog requires an explicit confirm click before the server request is sent

#### Scenario: Archive opens a confirmation dialog describing retrieval impact

- **WHEN** an Admin clicks an archive action
- **THEN** a confirmation dialog appears
- **AND** the dialog states that the document will no longer appear in answering or retrieval flows
- **AND** the dialog displays the current Admin email
- **AND** the dialog requires an explicit confirm click before the server request is sent

#### Scenario: Unarchive opens a confirmation dialog

- **WHEN** an Admin clicks an unarchive action
- **THEN** a confirmation dialog appears
- **AND** the dialog states that the document will return to the answering flow
- **AND** the dialog requires an explicit confirm click before the server request is sent

#### Scenario: Retry-sync does not open a confirmation dialog

- **WHEN** an Admin clicks a retry-sync action
- **THEN** no confirmation dialog appears
- **AND** the server request is sent immediately
