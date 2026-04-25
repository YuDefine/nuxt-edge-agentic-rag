## ADDED Requirements

### Requirement: Live DDL Foreign Key References Match Canonical Table Names

Every `FOREIGN KEY` clause stored in `sqlite_master.sql` for any D1 / libsql application table SHALL textually reference the canonical (post-rename) name of its parent table. No stored `CREATE TABLE` statement SHALL contain a `REFERENCES <table>_new(id)` clause that points at a transient rebuild table that no longer exists.

This requirement strengthens `Rebuild Migration Preserves Row Counts And Integrity` (which only checks row counts and `PRAGMA foreign_key_check`). When a rebuild migration uses the `*_new` staging pattern, the post-`RENAME` stored DDL is expected to read `REFERENCES <canonical>(id)`. SQLite's modern `legacy_alter_table = OFF` performs the rewrite automatically; libsql's default `legacy_alter_table = 1` does not. A stored DDL that retains `REFERENCES *_new(id)` after RENAME causes every `INSERT` / `UPDATE` against the child table to fail with `SQLITE_ERROR: no such table` because the FK lookup is text-resolved at statement time, not pointer-bound.

A migration that rebuilds an FK child table SHALL either run with `PRAGMA legacy_alter_table = OFF` or write the post-rename canonical name into the rebuild's `REFERENCES` clause directly, so that the stored DDL is correct regardless of the host engine's RENAME-rewrite behaviour.

#### Scenario: sqlite_master.sql contains no \_new FK references after migrations apply

- **WHEN** an operator runs `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%REFERENCES %_new(%';` against a fresh local libsql database after all migrations have applied
- **THEN** the result SHALL be empty
- **AND** the same query against production D1 SHALL likewise be empty

##### Example: query_logs chain DDL after migration 0015

| Table              | Stored FK clause (excerpt)                                               | Allowed | Forbidden                       |
| ------------------ | ------------------------------------------------------------------------ | ------- | ------------------------------- |
| `query_logs`       | `mcp_token_id TEXT REFERENCES mcp_tokens(id) ON DELETE SET NULL`         | yes     | `REFERENCES mcp_tokens_new(id)` |
| `messages`         | `query_log_id TEXT REFERENCES query_logs(id) ON DELETE SET NULL`         | yes     | `REFERENCES query_logs_new(id)` |
| `citation_records` | `query_log_id TEXT NOT NULL REFERENCES query_logs(id) ON DELETE CASCADE` | yes     | `REFERENCES query_logs_new(id)` |

#### Scenario: INSERT into a rebuilt FK child table succeeds on fresh local libsql

- **WHEN** an operator opens a fresh local libsql database, applies all migrations, and inserts a row into `query_logs`, `messages`, or `citation_records` via the application code paths (`createQueryLog`, `createMessage`, `createCitationRecord`)
- **THEN** every insert SHALL succeed without raising `SQLITE_ERROR: no such table`
- **AND** the inserted row SHALL be retrievable by primary key

#### Scenario: Migration that uses the \_new staging pattern declares legacy_alter_table = OFF or writes canonical names directly

- **WHEN** a future migration rebuilds an FK child table via the `<table>_new` staging pattern
- **THEN** the migration SHALL either set `PRAGMA legacy_alter_table = OFF` before any `CREATE TABLE *_new` statement, or write the rebuilt table's `REFERENCES` clause with the post-rename canonical parent name directly
- **AND** the migration SHALL conclude with `PRAGMA foreign_key_check` returning zero rows
