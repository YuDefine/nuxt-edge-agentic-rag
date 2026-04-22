## MODIFIED Requirements

### Requirement: Browse-Only Policy Restricts Guest Question Submission

When `guest_policy = 'browse_only'`, the system SHALL allow guest users to view published non-restricted documents and citation previews, but SHALL NOT allow them to submit new questions via Web `/chat` or MCP `askKnowledge`. This rule SHALL apply to guest principals resolved from remote OAuth access tokens and to any remaining guest-scoped legacy MCP tokens during migration.

#### Scenario: Guest submits question under browse_only policy on Web

- **WHEN** `guest_policy = 'browse_only'` and a guest user submits a message via Web `/chat`
- **THEN** the server rejects the request with HTTP 403 and a message explaining guests are in browse-only mode
- **AND** the chat UI disables the input field and displays a browse-only banner

#### Scenario: Guest principal calls askKnowledge under browse_only via MCP

- **WHEN** `guest_policy = 'browse_only'` and an MCP request resolves to a guest principal
- **THEN** the tool responds with HTTP 403 and error code `GUEST_ASK_DISABLED`

#### Scenario: Guest still lists categories under browse_only

- **WHEN** `guest_policy = 'browse_only'` and a guest calls `listCategories` or browses the document catalog UI
- **THEN** the system returns public non-restricted categories and documents

### Requirement: No-Access Policy Blocks All Feature Surfaces For Guests

When `guest_policy = 'no_access'`, the system SHALL deny guest users access to every feature surface except a dedicated `/account-pending` page and its supporting auth endpoints. MCP tools SHALL respond with HTTP 403 and error code `ACCOUNT_PENDING` for guest principals resolved from remote OAuth access tokens and for any remaining guest-scoped legacy MCP tokens during migration.

#### Scenario: Guest visits chat under no_access policy

- **WHEN** `guest_policy = 'no_access'` and a guest user navigates to `/chat`
- **THEN** the app redirects to `/account-pending`
- **AND** `/account-pending` displays a message instructing the guest to contact an admin

#### Scenario: Guest MCP principal is fully blocked under no_access

- **WHEN** `guest_policy = 'no_access'` and an MCP request resolves to a guest principal
- **THEN** the tool responds with HTTP 403 and error code `ACCOUNT_PENDING`
