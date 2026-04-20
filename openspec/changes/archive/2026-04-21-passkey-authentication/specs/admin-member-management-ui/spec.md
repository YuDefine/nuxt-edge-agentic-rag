## MODIFIED Requirements

### Requirement: Admin Member List Page

The system SHALL provide an admin-only page at `/admin/members` that lists all users with their `display_name`, email (or a visually distinct "—" placeholder when `email IS NULL`), bound credential types (one or more of `google`, `passkey`), current role, registration timestamp, last activity timestamp, and an action column for promoting or demoting their role. The page SHALL handle loading, empty, unauthorized, and error states explicitly. Non-admin users SHALL NOT see or access this page.

#### Scenario: Admin views member list with mixed credential types

- **WHEN** an authenticated Admin navigates to `/admin/members`
- **THEN** the page renders a paginated list of users showing `display_name`, email (or "—"), credential badges (e.g., "Google", "Passkey", or both), role badge, registration timestamp, and last activity timestamp
- **AND** each row shows an action button appropriate for the user's current role

#### Scenario: Passkey-only user row shows credential badge and no email

- **WHEN** the Admin views a row for a user whose `email IS NULL` and whose only credential is a passkey
- **THEN** the email cell SHALL render a "—" placeholder with accessible label "沒有 email"
- **AND** the credential column SHALL render a single "Passkey" badge

#### Scenario: Non-admin is blocked from member list

- **WHEN** an authenticated user with `role = 'member'` or `role = 'guest'` visits `/admin/members`
- **THEN** the page responds with an unauthorized state and does not leak member data

#### Scenario: Member list handles empty database

- **WHEN** the `users` table has zero non-admin rows
- **THEN** the page shows an empty state with guidance rather than a blank table

---

### Requirement: Role Promotion And Demotion Actions With Confirmation

The member list SHALL provide explicit promote and demote actions that route to `PATCH /api/admin/members/:userId` after a confirmation dialog. The confirmation SHALL display the target `display_name`, the target email if non-NULL (or "—" otherwise), the current role, the requested role, and a warning if the action is irreversible without Admin intervention.

#### Scenario: Admin promotes guest to member via UI

- **WHEN** an Admin clicks the promote button on a guest row and confirms in the dialog
- **THEN** the API is called with `{ role: 'member' }`
- **AND** the UI refetches the list and shows the updated role badge

#### Scenario: Confirmation shows display_name for passkey-only user

- **WHEN** an Admin opens the confirmation dialog for a user whose `email IS NULL`
- **THEN** the dialog header SHALL present `display_name` as the primary identifier
- **AND** the dialog SHALL render the email field as "—" without making it look like a missing value

#### Scenario: Admin dismisses confirmation

- **WHEN** an Admin opens the confirmation dialog and cancels
- **THEN** no API call is made and the list remains unchanged

#### Scenario: Admin promote attempt for non-allowlisted or NULL-email user to admin fails with clear message

- **WHEN** the Admin attempts to set `role = 'admin'` on a user not in `ADMIN_EMAIL_ALLOWLIST` or whose `email IS NULL`
- **THEN** the UI surfaces the HTTP 403 response body explaining that admin promotion requires an email in the allowlist
