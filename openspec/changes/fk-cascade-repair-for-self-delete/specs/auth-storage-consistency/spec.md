## ADDED Requirements

### Requirement: FK Cascade Policy Supports Account Deletion

The D1 schema SHALL declare `ON DELETE` policies on every foreign key that references the `user(id)` primary key, and the chosen policy SHALL reflect the audit-preservation intent for that child table. Tables whose rows MUST be erased atomically with the user (passkey credentials, OAuth accounts, active sessions, MCP tokens provisioned by the user) SHALL carry `ON DELETE CASCADE`. Tables whose rows MUST survive user deletion for compliance or audit purposes (`member_role_changes`) SHALL NOT carry a FOREIGN KEY constraint at all — the `user_id` column SHALL remain a plain text reference.

No column referencing `user(id)` SHALL fall back to SQLite's implicit `NO ACTION` behaviour, because `NO ACTION` silently blocks `DELETE FROM "user"` statements the application layer expects to succeed.

#### Scenario: PRAGMA foreign_key_list reports explicit policy on every user FK and every FK on its cascade path

- **WHEN** an operator runs `PRAGMA foreign_key_list(<table>)` for every D1 table whose schema references `user(id)`, `mcp_tokens(id)`, or `query_logs(id)`
- **THEN** every referencing column SHALL report an `on_delete` value of either `CASCADE` or `SET NULL`
- **AND** no referencing column SHALL report an `on_delete` value of `NO ACTION` or `RESTRICT`
- **AND** `query_logs.mcp_token_id` SHALL report `on_delete = 'SET NULL'` so that the `user → mcp_tokens` CASCADE is not blocked by a downstream RESTRICT

#### Scenario: member_role_changes has no FK constraint on user_id

- **WHEN** an operator runs `PRAGMA foreign_key_list(member_role_changes)`
- **THEN** the result SHALL be empty
- **AND** the `idx_member_role_changes_user_created` index SHALL still be present according to `PRAGMA index_list(member_role_changes)`

#### Scenario: mcp_tokens.created_by_user_id cascades on user deletion

- **WHEN** an operator runs `PRAGMA foreign_key_list(mcp_tokens)`
- **THEN** a row SHALL be returned with `from = 'created_by_user_id'`, `to = 'id'`, `table = 'user'`, and `on_delete = 'CASCADE'`

#### Scenario: query_logs.mcp_token_id is SET NULL so the cascade chain does not RESTRICT

- **WHEN** an operator runs `PRAGMA foreign_key_list(query_logs)`
- **THEN** a row SHALL be returned with `from = 'mcp_token_id'`, `to = 'id'`, `table = 'mcp_tokens'`, and `on_delete = 'SET NULL'`

#### Scenario: query_logs.mcp_token_id becomes NULL when parent mcp_tokens row is deleted

- **WHEN** an `mcp_tokens` row with id `T` is deleted (either directly or via `DELETE FROM "user"` cascading through `mcp_tokens.created_by_user_id`), and at least one `query_logs` row existed with `mcp_token_id = T`
- **THEN** after the delete commits, every such `query_logs` row SHALL have `mcp_token_id = NULL`
- **AND** no `query_logs` row SHALL be deleted as a consequence of the token deletion
- **AND** every surviving `query_logs` row SHALL retain its `query_redacted_text`, `created_at`, `channel`, `environment`, and `status` values unchanged

### Requirement: Rebuild Migration Preserves Row Counts And Integrity

Any migration that rebuilds `member_role_changes` or `mcp_tokens` to adjust FK policy SHALL preserve row count for every rebuilt table (including the `mcp_tokens` FK child chain `query_logs`, `citation_records`, and `messages` that must be rebuilt alongside to re-bind FK references) and SHALL verify `PRAGMA foreign_key_check` returns zero rows before commit.

The migration SHALL DROP the rebuilt tables in children-first order (`messages` → `citation_records` → `query_logs` → `mcp_tokens`) to prevent `ON DELETE SET NULL` on `messages.query_log_id` from silently nulling message rows when `query_logs` is dropped.

#### Scenario: Row count preserved across rebuild for every rebuilt table

- **WHEN** an operator runs the FK-cascade repair migration against a D1 database containing `N1` rows in `member_role_changes`, `N2` rows in `mcp_tokens`, `N3` rows in `query_logs`, `N4` rows in `citation_records`, and `N5` rows in `messages`
- **THEN** after the migration commits, `SELECT count(*) FROM member_role_changes` SHALL return `N1`
- **AND** `SELECT count(*) FROM mcp_tokens` SHALL return `N2`
- **AND** `SELECT count(*) FROM query_logs` SHALL return `N3`
- **AND** `SELECT count(*) FROM citation_records` SHALL return `N4`
- **AND** `SELECT count(*) FROM messages` SHALL return `N5`

#### Scenario: messages.query_log_id survives children-first DROP order

- **WHEN** the migration rebuilds `query_logs`, where `messages.query_log_id` is declared `ON DELETE SET NULL` against `query_logs(id)`
- **THEN** the migration SHALL `DROP TABLE messages` before `DROP TABLE query_logs`, so the `ON DELETE SET NULL` action never fires during the DROP chain
- **AND** after the migration commits, every `messages` row that had a non-NULL `query_log_id` before the migration SHALL still have the same non-NULL `query_log_id`

#### Scenario: Foreign key integrity check passes

- **WHEN** the migration reaches the integrity-check step
- **THEN** `PRAGMA foreign_key_check` SHALL return zero rows
- **AND** the migration SHALL only commit after that check passes
