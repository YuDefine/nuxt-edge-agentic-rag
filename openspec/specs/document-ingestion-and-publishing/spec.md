# document-ingestion-and-publishing Specification

## Purpose

TBD - created by archiving change 'bootstrap-v1-core-from-report'. Update Purpose after archive.

## Requirements

### Requirement: Staged Upload Finalization

The system SHALL use a staged upload flow where an Admin first requests a one-time R2 signed URL and `uploadId`, uploads the file directly to R2, and finalizes the upload before any document or version record is created. Finalization SHALL validate checksum, size, and MIME type and SHALL reject invalid uploads.

#### Scenario: Version creation waits for finalize

- **WHEN** an Admin uploads a file to R2 but has not completed upload finalization
- **THEN** the system does not create a `documents` or `document_versions` record
- **AND** the file cannot enter sync or publish workflows

#### Scenario: Finalize rejects invalid file metadata

- **WHEN** the finalize request reports a checksum, size, or MIME type that does not match the uploaded object
- **THEN** the finalize step fails
- **AND** the system does not create a publishable version snapshot

---
### Requirement: Versioned Replay Truth

Each `document_versions` record SHALL act as an immutable knowledge snapshot containing `normalized_text_r2_key`, `metadata_json`, `smoke_test_queries_json`, and prebuilt `source_chunks` before the version becomes publishable. `source_chunks` SHALL be derived from the normalized text snapshot rather than provider-owned chunk identifiers, and a version SHALL NOT enter `smoke_pending` or `indexed` without those replay assets.

#### Scenario: Replay assets are required before indexing

- **WHEN** a version has no `normalized_text_r2_key`, `smoke_test_queries_json`, or prebuilt `source_chunks`
- **THEN** the version does not advance to `smoke_pending` or `indexed`
- **AND** the version is not eligible for publish

#### Scenario: Published snapshots stay immutable

- **WHEN** a version has been published and later metadata or category values change on the parent document
- **THEN** the previously published version keeps its stored `metadata_json` and replay assets
- **AND** a new version or re-synced snapshot is required to change publish-time truth

---
### Requirement: Current Version Publishing

The system SHALL publish only versions whose parent document is `active`, whose index status is `indexed`, and that have no in-progress sync task. Publishing SHALL switch `is_current` atomically so only one version per document remains current, and re-publishing the already current version SHALL return a no-op success response.

#### Scenario: Publish switches current version atomically

- **WHEN** an indexed replacement version is published for an active document
- **THEN** the newly published version becomes the only row with `is_current = true`
- **AND** the previously current version is demoted in the same transaction

#### Scenario: Re-publishing the current version is a no-op

- **WHEN** the publish endpoint is called for a version that is already current
- **THEN** the endpoint returns a success response without changing version state
- **AND** downstream clients observe stable retry semantics
