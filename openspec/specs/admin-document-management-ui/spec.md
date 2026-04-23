# admin-document-management-ui Specification

## Purpose

TBD - created by archiving change 'add-v1-core-ui'. Update Purpose after archive.

## Requirements

### Requirement: Admin Document List UI

The system SHALL provide an Admin-only document list page at `/admin/documents` that displays document title, category, access level, status, current version information, and last updated time. The page SHALL handle loading, empty, unauthorized, and error states explicitly. Access authorization SHALL be decided by the authenticated user's `role` column (required: `admin`), not by direct comparison against `ADMIN_EMAIL_ALLOWLIST`.

#### Scenario: Admin sees document list

- **WHEN** a user with `users.role = 'admin'` visits `/admin/documents`
- **THEN** the page displays the current document list with status and version information
- **AND** the page provides entry points to upload, sync, or publish where allowed by status

#### Scenario: Non-admin is blocked from the page

- **WHEN** an authenticated user with `role != 'admin'` visits `/admin/documents`
- **THEN** the page redirects or blocks access with an unauthorized state
- **AND** the page does not leak document metadata

#### Scenario: Former admin who was removed from allowlist is blocked

- **WHEN** a user whose email was removed from `ADMIN_EMAIL_ALLOWLIST` and whose `role` was downgraded on next login visits `/admin/documents`
- **THEN** the page blocks access with an unauthorized state

---

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
  - HANDOFF.md
-->

---

### Requirement: Version Status Clarity

The document management UI SHALL represent document and version states with explicit labels or badges so that Admins can tell whether a document is draft, active, archived, queued, syncing, indexed, or failed without reading raw backend values.

#### Scenario: Status badges distinguish success, pending, and failure

- **WHEN** the UI renders document or version status
- **THEN** active/indexed states are visually distinct from pending or failed states
- **AND** failed states are immediately scannable in the list or wizard

<!-- @trace
source: add-v1-core-ui
updated: 2026-04-16
code:
  - .agents/commands/doc-sync.md
  - HANDOFF.md
-->

---

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

---

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

---

### Requirement: Upload Wizard Format Tier Disclosure

The admin upload wizard SHALL disclose source format tiers and keep its client-side validation aligned with server-side ingestion support. The wizard SHALL distinguish direct-text formats (`.txt`, `.md`), supported-rich formats (`.pdf`, `.docx`, `.xlsx`, `.pptx`), and deferred formats that require a conversion or transcript workflow before they can become replayable knowledge snapshots.

#### Scenario: Supported rich format is accepted by the wizard

- **WHEN** an Admin selects a `.pdf`, `.docx`, `.xlsx`, or `.pptx` source file within the size limit
- **THEN** the wizard allows the upload flow to proceed
- **AND** the UI identifies the file as a supported rich format rather than a generic text upload

#### Scenario: Legacy Office format shows conversion guidance

- **WHEN** an Admin selects a `.doc`, `.xls`, or `.ppt` source file
- **THEN** the wizard blocks the upload before presign
- **AND** the validation message explains that the file must be converted to a supported modern Office or text-based format first

#### Scenario: Media format shows transcript-pipeline guidance

- **WHEN** an Admin selects an audio or video source file
- **THEN** the wizard blocks the upload before presign
- **AND** the validation message explains that media ingestion is deferred to a future transcript pipeline

#### Scenario: Extraction failure shows a next-step message

- **WHEN** a supported rich format upload passes file validation but the server later rejects sync because no replayable text could be extracted
- **THEN** the wizard surfaces an extraction-failed message
- **AND** the message suggests a concrete next step such as converting the source to a text-friendly format or preparing a manually reviewed Markdown snapshot

<!-- @trace
source: multi-format-document-ingestion
updated: 2026-04-23
code:
  - local/reports/archive/main-v0.0.33.md
  - local/reports/archive/main-v0.0.22.md
  - local/reports/archive/main-v0.0.36.docx
  - reports/archive/main-v0.0.16.md
  - .github/instructions/commit.instructions.md
  - tooling/scripts/__init__.py
  - .codex/hooks/_codex_hook_wrapper.sh
  - local/reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.22.md
  - reports/archive/main-v0.0.21.md
  - .tmp/document-source-fixtures/legacy.ppt
  - app/pages/auth/callback.vue
  - local/reports/archive/main-v0.0.36.md
  - .husky/commit-msg
  - local/reports/archive/main-v0.0.16.md
  - reports/archive/main-v0.0.18.md
  - docs/verify/production-deploy-checklist.md
  - .codex/hooks/stop-accumulate.sh
  - .agents/skills/review-screenshot/SKILL.md
  - .github/instructions/logging.instructions.md
  - docs/solutions/tooling/posttooluse-hook-non-json-stdin.md
  - local/tooling/scripts/sync_docx_content.py
  - .agents/skills/spectra-discuss/SKILL.md
  - references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - scripts/spectra-ux/pre-apply-brief.sh
  - docs/verify/rollout-checklist.md
  - reports/notes/diagram.md
  - local/reports/archive/main-v0.0.11_assets/image1.jpeg
  - tooling/requirements.txt
  - local/reports/archive/main-v0.0.31.md
  - docs/design-review-findings.md
  - local/reports/archive/main-v0.0.14.md
  - docs/verify/RETENTION_REPLAY_CONTRACT.md
  - app/composables/useChatConversationHistory.ts
  - app/pages/index.vue
  - local/tooling/__init__.py
  - reports/archive/main-v0.0.33.md
  - local/reports/archive/main-v0.0.50.md
  - tooling/scripts/legacy/transform_v36.py
  - server/utils/cloudflare-bindings.ts
  - app/utils/chat-conversation-loader.ts
  - local/reports/archive/main-v0.0.13.md
  - local/reports/archive/main-v0.0.37.docx
  - docs/README.md
  - reports/archive/main-v0.0.24.md
  - reports/archive/main-v0.0.14.md
  - reports/archive/main-v0.0.34.md
  - .agents/skills/commit/SKILL.md
  - reports/archive/main-v0.0.37.docx
  - .codex/agents/screenshot-review.toml
  - package.json
  - server/api/auth/passkey/verify-authentication.post.ts
  - scripts/spectra-ux/roadmap-sync.mts
  - server/utils/r2-object-access.ts
  - .github/instructions/handoff.instructions.md
  - local/references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - server/utils/knowledge-runtime.ts
  - app/layouts/default.vue
  - local/reports/archive/main-v0.0.29.md
  - .agents/skills/critique/reference/personas.md
  - .github/instructions/skills.instructions.md
  - server/auth.config.ts
  - references/yuntech/專題報告編排規範1141216.pdf
  - reports/archive/main-v0.0.12.md
  - .github/instructions/mcp_remote.instructions.md
  - reports/archive/main-v0.0.11.docx
  - scripts/spectra-ux/claims-lib.mts
  - .tmp/document-source-fixtures/sample.xlsx
  - .tmp/document-source-fixtures/legacy.doc
  - .agents/skills/spectra-commit/SKILL.md
  - local/reports/archive/main-v0.0.21.md
  - tooling/scripts/docx_apply.py
  - local/reports/notes/main-v0.0.51-word-compare.md
  - .agents/skills/spectra-audit/SKILL.md
  - scripts/spectra-ux/claims-status.mts
  - reports/archive/main-v0.0.10.md
  - scripts/spectra-ux/lib/common.sh
  - .codex/hooks/post-propose-design-inject.sh
  - server/api/_dev/uploads/local.put.ts
  - scripts/spectra-ux/pre-propose-scan.sh
  - scripts/sync-docs-pages-domains.mjs
  - .github/instructions/knowledge_and_decisions.instructions.md
  - local/reports/archive/main-v0.0.11.docx
  - vite.config.ts
  - local/tooling/scripts/__init__.py
  - server/utils/debug-surface-guard.ts
  - local/tooling/scripts/docx_diff.py
  - .github/instructions/testing_anti_patterns.instructions.md
  - server/utils/passkey-verify-authentication.ts
  - .github/instructions/error_handling.instructions.md
  - local/reports/archive/main-v0.0.10.md
  - shared/utils/mcp-connector-redirect.ts
  - local/tooling/scripts/office/unpack.py
  - server/utils/document-source-extractor.ts
  - docs/solutions/README.md
  - reports/archive/main-v0.0.11.md
  - reports/archive/main-v0.0.31.md
  - .tmp/document-source-fixtures/sample.docx
  - scripts/spectra-ux/claim-work.mts
  - shared/utils/document-source-format.ts
  - shared/utils/mcp-connector-client-registry.ts
  - .tmp/upload-wizard-checks/xl.png
  - docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md
  - .codex/hooks/session-start-roadmap-sync.sh
  - tooling/scripts/office/pack.py
  - .github/copilot-instructions.md
  - docs/runbooks/claude-desktop-mcp.md
  - scripts/audit-ux-drift.mts
  - tooling/__init__.py
  - local/reports/archive/main-v0.0.18.md
  - local/tooling/scripts/docx_rebuild_content.py
  - local/reports/archive/main-v0.0.32.md
  - reports/archive/main-v0.0.11_assets/image1.jpeg
  - reports/archive/main-v0.0.36.md
  - scripts/spectra-ux/design-inject.sh
  - .github/instructions/screenshot_strategy.instructions.md
  - local/reports/latest.md
  - local/tooling/scripts/docx_sections.py
  - docs/solutions/auth/admin-allowlist-session-reconciliation.md
  - .tmp/document-source-fixtures/legacy.xls
  - docs/decisions/2026-04-23-canonical-root-handoff-artifact.md
  - local/reports/archive/latest.docx
  - playwright.config.ts
  - docs/decisions/2026-04-23-recognize-staging-as-active-environment.md
  - scripts/spectra-ux/post-propose-check.sh
  - local/reports/archive/main-v0.0.24.md
  - .agents/skills/impeccable/SKILL.md
  - reports/archive/main-v0.0.32.md
  - scripts/spectra-ux/release-work.mts
  - server/api/documents/sync.post.ts
  - app/components/auth/McpConnectorConsentCard.vue
  - .agents/skills/spectra-ingest/SKILL.md
  - reports/archive/main-v0.0.20.md
  - server/api/auth/mcp/authorize.get.ts
  - .tmp/upload-wizard-checks/xs.png
  - wrangler.staging.jsonc
  - docs/STRUCTURE.md
  - docs/onboarding.md
  - reports/archive/main-v0.0.25.md
  - tooling/scripts/office/unpack.py
  - docs/verify/RETENTION_CLEANUP_VERIFICATION.md
  - .codex/hooks/post-edit-roadmap-sync.sh
  - app/utils/chat-conversation-state.ts
  - docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md
  - .codex/hooks/pre-archive-followup-gate.sh
  - app/components/chat/ConversationHistory.vue
  - reports/archive/main-v0.0.23.md
  - tooling/scripts/extract_docx_to_md.py
  - .github/instructions/manual_review.instructions.md
  - docs/verify/DEBUG_SURFACE_VERIFICATION.md
  - server/utils/document-sync.ts
  - server/api/uploads/presign.post.ts
  - app/composables/useChatConversationSession.ts
  - .codex/agents/check-runner.toml
  - templates/海報樣板.pptx
  - local/reports/archive/main-v0.0.30.md
  - local/reports/archive/main-v0.0.19.md
  - app/composables/useMcpConnectorAuthorization.ts
  - tooling/scripts/clone_insert_docx.py
  - local/海報樣板.pptx
  - HANDOFF.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - local/reports/archive/main-v0.0.23.md
  - tooling/scripts/clone_section.py
  - nuxt.config.ts
  - reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.19.md
  - local/reports/archive/main-v0.0.34.md
  - server/utils/staged-upload.ts
  - .github/instructions/api_patterns.instructions.md
  - .tmp/document-source-fixtures/sample.pptx
  - local/reports/archive/main-v0.0.17.md
  - .github/instructions/review_tiers.instructions.md
  - app/components/chat/Container.vue
  - reports/archive/main-v0.0.1.docx
  - reports/archive/main-v0.0.37.md
  - server/utils/link-google-for-passkey-first.ts
  - local/reports/archive/main-v0.0.27.md
  - .github/workflows/deploy.yml
  - CLAUDE.md
  - local/reports/archive/main-v0.0.1.docx
  - docs/verify/DISASTER_RECOVERY_RUNBOOK.md
  - reports/archive/main-v0.0.30.md
  - .github/instructions/proactive_skills.instructions.md
  - tooling/scripts/docx_diff.py
  - .agents/skills/spectra-propose/SKILL.md
  - docs/rules/index.md
  - local/reports/archive/main-v0.0.51.md
  - .agents/skills/spectra-archive/SKILL.md
  - .tmp/upload-wizard-checks/md.png
  - README.md
  - app/pages/account/settings.vue
  - server/api/auth/account/link-google-for-passkey-first/index.get.ts
  - .tmp/document-source-fixtures/sample.pdf
  - .agents/skills/spectra-debug/SKILL.md
  - docs/verify/RETENTION_CLEANUP_RUNBOOK.md
  - deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - local/reports/notes/main-v0.0.51-word-copy.md
  - local/reports/archive/main-v0.0.35.md
  - app/components/documents/UploadWizard.vue
  - local/deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - app/components/auth/DeleteAccountDialog.vue
  - spectra-ux.config.json
  - shared/utils/link-google-for-passkey-first.ts
  - tooling/scripts/docx_sections.py
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - tooling/scripts/sync_docx_content.py
  - local/tooling/requirements.txt
  - reports/latest.md
  - docs/solutions/auth/better-auth-passkey-worker-catchall-override.md
  - reports/archive/main-v0.0.17.md
  - tooling/scripts/office/__init__.py
  - .github/instructions/development.instructions.md
  - .agents/skills/design-retro/SKILL.md
  - local/reports/archive/main-v0.0.28.md
  - local/tooling/scripts/clone_section.py
  - AGENTS.md
  - local/reports/notes/diagram.md
  - local/reports/archive/main-v0.0.25.md
  - local/tooling/scripts/clone_insert_docx.py
  - reports/archive/main-v0.0.50.md
  - reports/archive/main-v0.0.28.md
  - reports/archive/main-v0.0.48.md
  - .codex/agents/code-review.toml
  - docs/index.md
  - local/deliverables/defense/答辯準備_口試Q&A.md
  - app/components/auth/McpConnectorLoginCard.vue
  - docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md
  - docs/verify/KNOWLEDGE_SMOKE.md
  - local/reports/archive/main-v0.0.48.md
  - app/pages/admin/tokens/index.vue
  - tooling/scripts/docx_rebuild_content.py
  - .codex/hooks/pre-archive-design-gate.sh
  - .agents/skills/critique/SKILL.md
  - app/pages/auth/mcp/authorize.vue
  - docs/verify/ACCEPTANCE_RUNBOOK.md
  - server/api/auth/account/link-google-for-passkey-first/callback.get.ts
  - .github/instructions/unused_features.instructions.md
  - local/references/yuntech/專題報告編排規範1141216.pdf
  - reports/archive/main-v0.0.27.md
  - .codex/hooks.json
  - scripts/spectra-ux/design-gate.sh
  - reports/archive/main-v0.0.26.md
  - app/components/admin/tokens/TokenCreateModal.vue
  - local/tooling/scripts/docx_word_compare_md.py
  - server/utils/database.ts
  - local/tooling/scripts/legacy/transform_v36.py
  - local/reports/archive/main-v0.0.37.md
  - server/api/auth/mcp/authorize.post.ts
  - local/reports/archive/main-v0.0.11.md
  - server/utils/document-preprocessing.ts
  - local/reports/archive/main-v0.0.20.md
  - local/tooling/scripts/extract_docx_to_md.py
  - .tmp/document-source-fixtures/scanned.pdf
  - reports/archive/main-v0.0.29.md
  - server/utils/better-auth-safe-logger.ts
  - .codex/config.toml
  - docs/solutions/auth/passkey-self-delete-hard-redirect.md
  - docs/verify/evidence/web-chat-persistence.json
  - local/reports/archive/main-v0.0.26.md
  - local/reports/archive/main-v0.0.12.md
  - template/HANDOFF.md
  - .agents/skills/spectra-ask/SKILL.md
  - reports/archive/main-v0.0.36.docx
  - local/tooling/scripts/office/pack.py
  - docs/tech-debt.md
  - docs/verify/index.md
  - .agents/skills/spectra-apply/SKILL.md
  - .github/instructions/ux_completeness.instructions.md
  - reports/archive/main-v0.0.49.md
  - docs/decisions/index.md
  - local/reports/archive/main-v0.0.49.md
  - local/tooling/scripts/docx_apply.py
  - pnpm-workspace.yaml
  - test/helpers/document-source-fixtures.ts
  - app/types/chat.ts
  - shared/schemas/knowledge-runtime.ts
  - docs/decisions/2026-04-23-claude-source-of-truth-across-offline-repos.md
  - scripts/spectra-ux/ui-qa-reminder.sh
  - reports/archive/main-v0.0.35.md
  - reports/archive/main-v0.0.13.md
  - app/utils/mcp-connector-return-to.ts
  - .codex/hooks/post-edit-ui-qa.sh
  - local/tooling/scripts/office/__init__.py
tests:
  - test/unit/mcp-connector-client-registry.test.ts
  - test/unit/r2-object-access.test.ts
  - test/integration/document-sync-route.test.ts
  - test/unit/document-source-format-registry.test.ts
  - test/unit/document-preprocessing.test.ts
  - test/unit/oauth-callback.spec.ts
  - test/unit/document-source-extractor.test.ts
  - test/unit/link-google-for-passkey-first-initiator.test.ts
  - test/unit/mcp-connector-redirect.test.ts
  - test/unit/chat-conversation-session.test.ts
  - test/unit/chat-conversation-state.test.ts
  - test/unit/document-sync.test.ts
  - test/integration/passkey-first-link-google.spec.ts
  - tooling/tests/test_extract_docx_to_md.py
  - test/unit/better-auth-worker-cookie-cache-hotfix.test.ts
  - test/unit/passkey-verify-authentication.test.ts
  - test/unit/better-auth-passkey-hotfix-version.test.ts
  - test/unit/database.test.ts
  - tooling/tests/test_office_pack_unpack.py
  - test/unit/better-auth-safe-logger.test.ts
  - test/unit/deploy-workflow-config.test.ts
  - test/integration/local-upload-route.test.ts
  - e2e/chat-persistence.spec.ts
  - local/tooling/tests/test_office_pack_unpack.py
  - test/integration/mcp-oauth-tool-access.test.ts
  - test/unit/knowledge-runtime-config.test.ts
  - test/integration/mcp-connector-authorize-route.test.ts
  - test/unit/chat-conversation-history.test.ts
  - e2e/mcp-connector-authorize.spec.ts
  - test/integration/passkey-verify-authentication-hotfix.spec.ts
  - test/unit/staged-upload.test.ts
  - test/unit/deploy-workflow-passkey-env.test.ts
  - test/integration/mcp-connector-authorize-post-account-guard.test.ts
  - local/tooling/tests/test_extract_docx_to_md.py
-->
