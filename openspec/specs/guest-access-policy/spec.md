# guest-access-policy Specification

## Purpose

TBD - created by archiving change 'member-and-permission-management'. Update Purpose after archive.

## Requirements

### Requirement: Guest Policy Enum And Default

The `guest_policy` setting SHALL be one of exactly three values: `same_as_member`, `browse_only`, or `no_access`. The system default SHALL be `same_as_member`. All server-side permission checks for users with `role = 'guest'` SHALL consult this setting before granting or denying access.

#### Scenario: Invalid policy value is rejected

- **WHEN** an Admin submits `PATCH /api/admin/settings/guest-policy` with a value outside the enum
- **THEN** the API responds with HTTP 400 and does not change the stored value

#### Scenario: Default policy allows guest parity with members

- **WHEN** `guest_policy = 'same_as_member'` and a guest user calls any member-level API endpoint
- **THEN** the endpoint proceeds as if the user had `role = 'member'`

---

### Requirement: Browse-Only Policy Restricts Guest Question Submission

When `guest_policy = 'browse_only'`, the system SHALL allow guest users to view published non-restricted documents and citation previews, but SHALL NOT allow them to submit new questions via Web `/chat` or MCP `askKnowledge`.

#### Scenario: Guest submits question under browse_only policy on Web

- **WHEN** `guest_policy = 'browse_only'` and a guest user submits a message via Web `/chat`
- **THEN** the server rejects the request with HTTP 403 and a message explaining guests are in browse-only mode
- **AND** the chat UI disables the input field and displays a browse-only banner

#### Scenario: Guest calls askKnowledge under browse_only via MCP

- **WHEN** `guest_policy = 'browse_only'` and a guest-owned MCP token calls `askKnowledge`
- **THEN** the tool responds with HTTP 403 and error code `GUEST_ASK_DISABLED`

#### Scenario: Guest still lists categories under browse_only

- **WHEN** `guest_policy = 'browse_only'` and a guest calls `listCategories` or browses the document catalog UI
- **THEN** the system returns public non-restricted categories and documents

---

### Requirement: No-Access Policy Blocks All Feature Surfaces For Guests

When `guest_policy = 'no_access'`, the system SHALL deny guest users access to every feature surface except a dedicated `/account-pending` page and its supporting auth endpoints. MCP tools SHALL respond with HTTP 403 and error code `ACCOUNT_PENDING` for guest-owned tokens.

#### Scenario: Guest visits chat under no_access policy

- **WHEN** `guest_policy = 'no_access'` and a guest user navigates to `/chat`
- **THEN** the app redirects to `/account-pending`
- **AND** `/account-pending` displays a message instructing the guest to contact an admin

#### Scenario: Guest MCP token is fully blocked under no_access

- **WHEN** `guest_policy = 'no_access'` and a guest-owned MCP token calls any tool
- **THEN** the tool responds with HTTP 403 and error code `ACCOUNT_PENDING`

---

### Requirement: Policy Changes Propagate Across Worker Instances Within One Request

When an Admin updates `guest_policy`, all Worker instances SHALL observe the new value no later than their next request after the Admin's update commits. The system SHALL achieve this by checking a KV-stored version stamp on each request and reloading from D1 when the cached stamp is stale.

#### Scenario: Other worker instance picks up new policy on next request

- **WHEN** Admin updates `guest_policy` from `same_as_member` to `no_access`
- **THEN** any other Worker instance, upon receiving its next request, observes the new value and enforces `no_access` behavior for guests

---

### Requirement: OAuth Callback Does Not Gate On Allowlist

The OAuth sign-in flow SHALL accept any valid Google account and create a corresponding `users` row. The allowlist SHALL only influence the `role` assigned at row creation or update time; it SHALL NOT reject the login itself.

#### Scenario: Non-allowlisted user completes OAuth

- **WHEN** a user whose email is not in `ADMIN_EMAIL_ALLOWLIST` completes Google OAuth
- **THEN** the system creates or reuses a `users` row for that email
- **AND** the user is signed in with `role = 'guest'` (or existing role if previously set)

#### Scenario: Invalid OAuth credential is rejected as before

- **WHEN** a Google OAuth callback fails upstream credential validation
- **THEN** the system rejects the login with the existing error flow (no user row is created)
