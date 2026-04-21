## ADDED Requirements

### Requirement: Audit Trail Survives User Deletion

The `member_role_changes` table SHALL retain every row across the lifetime of the deployment even when the referenced `user` row has been deleted. The `user_id` column SHALL be treated as a plain text reference to a better-auth `user.id` that is potentially orphaned, and the database SHALL NOT enforce a FOREIGN KEY relationship from `member_role_changes.user_id` to `user(id)`. Tombstone rows written during account deletion (`reason = 'self-deletion'`) SHALL remain queryable for compliance and audit purposes after the user row is gone.

#### Scenario: Tombstone row remains after user deletion

- **WHEN** a user with id `U` triggers account self-deletion and the handler commits `DELETE FROM "user" WHERE id = U`
- **THEN** at least one `member_role_changes` row with `user_id = U` and `reason = 'self-deletion'` SHALL still exist in the table
- **AND** `SELECT reason FROM member_role_changes WHERE user_id = U ORDER BY created_at DESC LIMIT 1` SHALL return `'self-deletion'`

#### Scenario: Orphan tombstone rows do not block admin role history queries

- **WHEN** an admin queries `SELECT * FROM member_role_changes WHERE user_id = <deleted user id>` to investigate a past member's role history
- **THEN** the query SHALL return all historical rows for that user id
- **AND** the query SHALL NOT fail because the `user` row no longer exists

#### Scenario: recordRoleChange writes tombstone without FK restriction

- **WHEN** the application code invokes `recordRoleChange({ userId: U, reason: 'self-deletion', ... })` immediately before deleting the `user` row with id `U`
- **THEN** the insert SHALL succeed
- **AND** the subsequent `DELETE FROM "user" WHERE id = U` SHALL NOT raise a `SQLITE_CONSTRAINT_FOREIGNKEY` error caused by the just-inserted `member_role_changes` row
