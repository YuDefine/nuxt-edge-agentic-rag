## MODIFIED Requirements

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
