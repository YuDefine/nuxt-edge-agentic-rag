## MODIFIED Requirements

### Requirement: Passkey-Only Account Self-Deletion Requires Reauth

The system SHALL provide an authenticated endpoint that deletes the current user's account, and SHALL require a successful WebAuthn authentication ceremony (or Google reauth if the account has a linked Google credential) completed within the last 5 minutes before committing the deletion. Deletion SHALL cascade from `user` across `account`, `session`, `passkey`, and `mcp_tokens`, and SHALL leave one final audit row in `member_role_changes` with `reason = 'self-deletion'` that survives the user row's deletion. The application layer SHALL delete `user_profiles` explicitly before deleting `user`.

The database SHALL NOT restrict deletion of the `user` row because of existing `member_role_changes` rows: the `member_role_changes.user_id` column SHALL be a plain text reference with no FOREIGN KEY constraint, so audit tombstones preserve the historical user id after the `user` row is gone. The `mcp_tokens.created_by_user_id` column SHALL carry `ON DELETE CASCADE`, so tokens are removed atomically with their creator. The `query_logs.mcp_token_id` column SHALL carry `ON DELETE SET NULL`, so observability rows survive the cascade with their token attribution set to `NULL` rather than blocking the cascade with a RESTRICT.

#### Scenario: Passkey-only user deletes their account after reauth

- **WHEN** an authenticated user whose only credential is a passkey clicks "Delete account" and completes a WebAuthn authentication ceremony within the last 5 minutes
- **THEN** the system inserts a `member_role_changes` row with `from_role = <previous role>`, `to_role = <previous role>`, `changed_by = 'system'`, `reason = 'self-deletion'`
- **AND** the system deletes rows from `user_profiles`, `user`, and cascades to `account`, `session`, `passkey`, and `mcp_tokens`
- **AND** the response indicates successful deletion and the client is redirected to `/` with no active session

#### Scenario: Deletion without reauth is refused

- **WHEN** a client calls the delete-account endpoint with a session older than 5 minutes
- **THEN** the server SHALL respond with HTTP 403 and no rows SHALL be deleted
- **AND** the `member_role_changes` tombstone row SHALL NOT be inserted

#### Scenario: Audit tombstone survives user deletion

- **WHEN** a passkey-only user successfully self-deletes via the delete-account endpoint
- **THEN** the `member_role_changes` row with `reason = 'self-deletion'` and `user_id = <deleted user id>` SHALL still exist in the table after the `user` row is gone
- **AND** a `SELECT count(*) FROM member_role_changes WHERE user_id = <deleted user id>` SHALL return at least one row
- **AND** the database SHALL NOT raise any FOREIGN KEY constraint error during the `DELETE FROM "user"` statement

#### Scenario: MCP tokens cascade on user deletion

- **WHEN** a user with one or more `mcp_tokens` rows (where `created_by_user_id = <user id>`) successfully self-deletes
- **THEN** after the deletion all `mcp_tokens` rows whose `created_by_user_id` matched SHALL be removed
- **AND** `PRAGMA foreign_key_check(mcp_tokens)` SHALL return zero rows

#### Scenario: query_logs survive with NULL mcp_token_id after user deletion

- **WHEN** a user with one or more `mcp_tokens` rows (where `created_by_user_id = <user id>`) AND one or more `query_logs` rows referencing those tokens successfully self-deletes
- **THEN** after the deletion every `query_logs` row whose `mcp_token_id` pointed at one of the deleted tokens SHALL still exist with its `query_redacted_text`, `created_at`, `channel`, `environment`, and `status` unchanged
- **AND** those `query_logs` rows SHALL have `mcp_token_id = NULL`
- **AND** the `DELETE FROM "user"` statement SHALL NOT raise a FOREIGN KEY constraint error

#### Scenario: Admin-initiated delete against passkey-only member is not DB-blocked

- **WHEN** an admin action or future `DELETE /api/admin/members/[userId]` handler invokes the same delete-user code path for a passkey-only member who has audit tombstones
- **THEN** the `DELETE FROM "user"` statement SHALL succeed without FOREIGN KEY restriction
- **AND** the audit tombstones SHALL remain intact for compliance review
