## ADDED Requirements

### Requirement: Persisted Refusal Flag On Messages

The `messages` table SHALL include a non-null integer column `refused` with default value `0` that records whether an assistant message represents a refusal outcome. User and system messages SHALL store `refused = 0`. Assistant messages SHALL store `refused = 1` when the message corresponds to any refusal outcome of the answering pipeline (audit-blocked, pipeline refusal, or pipeline error) and `refused = 0` for accepted answers. The schema migration that introduces the column MUST be additive only (`ALTER TABLE ... ADD COLUMN`) so that existing rows backfill to `0` without rewriting historical data. Conversation read APIs that return message content SHALL include the `refused` value in the payload.

#### Scenario: Migration adds refused column with default zero

- **WHEN** the schema migration runs against a D1 database that already has a populated `messages` table
- **THEN** the migration adds the `refused` column as `INTEGER NOT NULL DEFAULT 0`
- **AND** existing rows acquire `refused = 0`
- **AND** no existing row content is altered

#### Scenario: Conversation read API exposes refused flag

- **WHEN** a signed-in user requests `GET /api/conversations/:id/messages` for a conversation they own
- **THEN** every message in the response carries a boolean `refused` field
- **AND** the `refused` field is `true` for assistant rows that were persisted with `refused = 1`
- **AND** the `refused` field is `false` for all other rows

#### Scenario: Historical refusal turns remain false after migration

- **WHEN** a conversation predates the migration and contained a refusal turn that was never persisted (because the previous orchestration skipped writing assistant rows for refusals)
- **THEN** the migration does not retroactively create the missing assistant row
- **AND** the response for that conversation continues to omit the historical refusal turn
- **AND** new refusal turns generated after the migration are persisted with `refused = 1`

### Requirement: Persisted Refusal Reason On Messages

The `messages` table SHALL include a nullable text column `refusal_reason` that records the specific `RefusalReason` enum value associated with an assistant refusal turn. The schema migration that introduces the column MUST be additive only (`ALTER TABLE ... ADD COLUMN refusal_reason TEXT`) without `NOT NULL` so existing rows backfill to `NULL` without rewriting historical data and so user / accepted-assistant rows can legitimately store `NULL`. Assistant rows persisted with `refused = 1` SHALL store the matching `RefusalReason` value (`'restricted_scope'`, `'no_citation'`, `'low_confidence'`, `'pipeline_error'`, etc.); user rows, system rows, and accepted-answer assistant rows SHALL store `NULL`. Conversation read APIs that return message content SHALL include the `refusalReason` value in the payload (camelCase mapped from the snake_case column).

#### Scenario: Migration adds refusal_reason column as nullable text

- **WHEN** the migration that introduces `refusal_reason` runs against a D1 database that already has a populated `messages` table
- **THEN** the migration adds the `refusal_reason` column as `TEXT` (nullable, no `NOT NULL`)
- **AND** existing rows acquire `refusal_reason = NULL`
- **AND** no existing row content is altered

#### Scenario: Conversation read API exposes refusalReason

- **WHEN** a signed-in user requests `GET /api/conversations/:id/messages` for a conversation they own
- **THEN** every message in the response carries a `refusalReason` field
- **AND** the `refusalReason` field is `null` for user rows, system rows, and accepted-assistant rows
- **AND** the `refusalReason` field equals the persisted `RefusalReason` value (for example `'restricted_scope'`) for assistant refusal rows

#### Scenario: Historical assistant rows retain null refusalReason

- **WHEN** an assistant row predates the `refusal_reason` migration
- **THEN** the migration does NOT backfill a reason into that row
- **AND** the conversation read API returns `refusalReason: null` for that row
- **AND** new refusal turns generated after the migration store the matching reason
