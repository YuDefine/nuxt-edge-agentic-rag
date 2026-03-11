## MODIFIED Requirements

### Requirement: Chat Page Access And Navigation

The system SHALL provide a chat page at `/chat` for authenticated Web users and SHALL expose a role-aware navigation entry from the home page. Unauthenticated users SHALL be redirected to login. Authenticated users SHALL see only the entries their current permissions allow. The chat entry SHALL be conditionally enabled, disabled with explanation, or redirected, according to the combination of `users.role` and the current `guest_policy` system setting.

#### Scenario: Authenticated member enters chat from home

- **WHEN** a user with `role = 'member'` or `role = 'admin'` visits the home page
- **THEN** the page shows an enabled entry to `/chat`
- **AND** navigating there renders the chat interface with full question submission capability

#### Scenario: Unauthenticated user is redirected to login

- **WHEN** an unauthenticated user requests `/chat`
- **THEN** the system redirects to the login page
- **AND** preserves the intended destination for the post-login redirect

#### Scenario: Guest under same_as_member policy uses chat normally

- **WHEN** a user with `role = 'guest'` visits `/chat` and the active `guest_policy = 'same_as_member'`
- **THEN** the chat interface behaves identically to the member experience

#### Scenario: Guest under browse_only policy sees disabled input with banner

- **WHEN** a user with `role = 'guest'` visits `/chat` and the active `guest_policy = 'browse_only'`
- **THEN** the chat interface renders with the message input disabled
- **AND** a banner explains that guests are in browse-only mode and links to the public document catalog

#### Scenario: Guest under no_access policy is redirected to account-pending

- **WHEN** a user with `role = 'guest'` visits `/chat` and the active `guest_policy = 'no_access'`
- **THEN** the app redirects to `/account-pending`
- **AND** the account-pending page explains how to contact an admin
