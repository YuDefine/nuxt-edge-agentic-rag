# admin-member-management-ui Specification

## Purpose

TBD - created by archiving change 'member-and-permission-management'. Update Purpose after archive.

## Requirements

### Requirement: Admin Member List Page

The system SHALL provide an admin-only page at `/admin/members` that lists all users with their email, name, current role, last login timestamp, and an action column for promoting or demoting their role. The page SHALL handle loading, empty, unauthorized, and error states explicitly. Non-admin users SHALL NOT see or access this page.

#### Scenario: Admin views member list

- **WHEN** an authenticated Admin navigates to `/admin/members`
- **THEN** the page renders a paginated list of users with their role badge and last login timestamp
- **AND** each row shows an action button appropriate for the user's current role

#### Scenario: Non-admin is blocked from member list

- **WHEN** an authenticated user with `role = 'member'` or `role = 'guest'` visits `/admin/members`
- **THEN** the page responds with an unauthorized state and does not leak member data

#### Scenario: Member list handles empty database

- **WHEN** the `users` table has zero non-admin rows
- **THEN** the page shows an empty state with guidance rather than a blank table

---

### Requirement: Role Promotion And Demotion Actions With Confirmation

The member list SHALL provide explicit promote and demote actions that route to `PATCH /api/admin/members/:userId` after a confirmation dialog. The confirmation SHALL display the target email, the current role, the requested role, and a warning if the action is irreversible without Admin intervention.

#### Scenario: Admin promotes guest to member via UI

- **WHEN** an Admin clicks the promote button on a guest row and confirms in the dialog
- **THEN** the API is called with `{ role: 'member' }`
- **AND** the UI refetches the list and shows the updated role badge

#### Scenario: Admin dismisses confirmation

- **WHEN** an Admin opens the confirmation dialog and cancels
- **THEN** no API call is made and the list remains unchanged

#### Scenario: Admin promote attempt for non-allowlisted user fails with clear message

- **WHEN** the Admin attempts to set `role = 'admin'` on a user not in `ADMIN_EMAIL_ALLOWLIST`
- **THEN** the UI surfaces the HTTP 403 response body explaining that admin promotion must be done via env var allowlist

---

### Requirement: Guest Policy Settings Page With Single Dial

The system SHALL provide an admin-only page at `/admin/settings/guest-policy` that displays the current value of `guest_policy` and offers a single radio-group selector with the three enum values. Saving the selection SHALL call `PATCH /api/admin/settings/guest-policy` and show immediate feedback on success or failure.

#### Scenario: Admin views and updates guest policy

- **WHEN** an authenticated Admin visits `/admin/settings/guest-policy`
- **THEN** the page shows the three options and marks the current value as selected
- **AND** choosing a different value and confirming updates the setting and shows a success toast

#### Scenario: Each option shows effect description

- **WHEN** the Admin hovers or focuses any of the three options
- **THEN** the UI displays a short description of the effect on guest users

#### Scenario: Save failure preserves previous selection

- **WHEN** the API call to update the policy fails with any non-2xx response
- **THEN** the UI reverts the radio selection to the previous value and shows an error toast with the server-provided message

---

### Requirement: Admin Navigation Exposes Member And Policy Entries

The admin navigation shell SHALL expose entries for `/admin/members` and `/admin/settings/guest-policy` alongside existing admin entries. These entries SHALL only appear for users with `role = 'admin'`.

#### Scenario: Admin sees member and policy nav items

- **WHEN** a user with `role = 'admin'` loads any admin page
- **THEN** the navigation shell shows entries labeled for the members page and the guest-policy settings page

#### Scenario: Non-admin does not see admin nav entries

- **WHEN** a user with `role = 'member'` or `'guest'` loads any page
- **THEN** the navigation shell does not render the admin entries
