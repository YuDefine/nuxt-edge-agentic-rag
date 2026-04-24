## MODIFIED Requirements

### Requirement: Chat Page Access And Navigation

The system SHALL serve the chat UI at the root path `/`. Access to `/` SHALL require authentication; unauthenticated visitors SHALL be redirected to `/login` by the global authentication middleware, with their intended destination preserved via the `redirect` query parameter per the `auth-redirect` capability (omitted when the origin path is `/` itself). The legacy route `/chat` SHALL continue to redirect to `/` for backward compatibility. Authenticated users SHALL see only the navigation entries their current permissions allow. Chat access SHALL be conditionally enabled, disabled with explanation, or redirected, according to the combination of `users.role` and the current `guest_policy` system setting.

#### Scenario: Authenticated member accesses chat at root

- **WHEN** a user with `role = 'member'` or `role = 'admin'` navigates to `/`
- **THEN** the chat interface renders with full question submission capability
- **AND** the page does not display any login UI

#### Scenario: Unauthenticated user is redirected to login with origin preserved

- **WHEN** an unauthenticated user navigates to `/account/settings`
- **THEN** the global middleware redirects to `/login?redirect=%2Faccount%2Fsettings`
- **AND** after successful login the user lands back on `/account/settings`

#### Scenario: Unauthenticated user visiting root redirects without redirect query

- **WHEN** an unauthenticated user navigates to `/`
- **THEN** the global middleware redirects to `/login` without any query parameters

#### Scenario: Legacy chat route redirects to root

- **WHEN** any user navigates to `/chat`
- **THEN** the page redirects to `/` with `replace: true`
- **AND** authentication rules at `/` apply normally

#### Scenario: Guest under same_as_member policy uses chat normally

- **WHEN** a user with `role = 'guest'` visits `/` and the active `guest_policy = 'same_as_member'`
- **THEN** the chat interface behaves identically to the member experience

#### Scenario: Guest under browse_only policy sees disabled input with banner

- **WHEN** a user with `role = 'guest'` visits `/` and the active `guest_policy = 'browse_only'`
- **THEN** the chat interface renders with the message input disabled
- **AND** a banner explains that guests are in browse-only mode and links to the public document catalog

#### Scenario: Guest under no_access policy is redirected to account-pending

- **WHEN** a user with `role = 'guest'` visits `/` and the active `guest_policy = 'no_access'`
- **THEN** the app redirects to `/account-pending`
- **AND** the account-pending page explains how to contact an admin

#### Scenario: Root page does not trigger conversation history fetch before authentication

- **WHEN** an unauthenticated user attempts to render `/`
- **THEN** the global middleware intercepts before any client-side chat history fetch executes
- **AND** no request is made to `/api/conversations`
