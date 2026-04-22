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

<!-- @trace
source: oauth-user-delegated-remote-mcp
updated: 2026-04-22
code:
  - app/pages/auth/mcp/authorize.vue
  - app/components/auth/McpConnectorConsentCard.vue
  - app/components/auth/McpConnectorLoginCard.vue
  - playwright.config.ts
  - nuxt.config.ts
  - app/composables/useMcpConnectorAuthorization.ts
  - reports/latest.md
  - shared/utils/mcp-connector-client-registry.ts
  - shared/utils/mcp-connector-redirect.ts
  - server/api/auth/mcp/authorize.get.ts
  - docs/runbooks/claude-desktop-mcp.md
  - app/components/admin/tokens/TokenCreateModal.vue
  - docs/verify/DISASTER_RECOVERY_RUNBOOK.md
  - docs/verify/production-deploy-checklist.md
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - app/utils/mcp-connector-return-to.ts
  - app/pages/admin/tokens/index.vue
  - server/api/auth/mcp/authorize.post.ts
  - app/pages/auth/callback.vue
  - docs/design-review-findings.md
tests:
  - e2e/mcp-connector-authorize.spec.ts
  - test/integration/mcp-connector-authorize-route.test.ts
  - test/unit/mcp-connector-redirect.test.ts
  - test/unit/mcp-connector-client-registry.test.ts
  - test/integration/mcp-oauth-tool-access.test.ts
  - test/integration/mcp-connector-authorize-post-account-guard.test.ts
-->

---

### Requirement: No-Access Policy Blocks All Feature Surfaces For Guests

When `guest_policy = 'no_access'`, the system SHALL deny guest users access to every feature surface except a dedicated `/account-pending` page and its supporting auth endpoints. MCP tools SHALL respond with HTTP 403 and error code `ACCOUNT_PENDING` for guest principals resolved from remote OAuth access tokens and for any remaining guest-scoped legacy MCP tokens during migration.

#### Scenario: Guest visits chat under no_access policy

- **WHEN** `guest_policy = 'no_access'` and a guest user navigates to `/chat`
- **THEN** the app redirects to `/account-pending`
- **AND** `/account-pending` displays a message instructing the guest to contact an admin

#### Scenario: Guest MCP principal is fully blocked under no_access

- **WHEN** `guest_policy = 'no_access'` and an MCP request resolves to a guest principal
- **THEN** the tool responds with HTTP 403 and error code `ACCOUNT_PENDING`

<!-- @trace
source: oauth-user-delegated-remote-mcp
updated: 2026-04-22
code:
  - app/pages/auth/mcp/authorize.vue
  - app/components/auth/McpConnectorConsentCard.vue
  - app/components/auth/McpConnectorLoginCard.vue
  - playwright.config.ts
  - nuxt.config.ts
  - app/composables/useMcpConnectorAuthorization.ts
  - reports/latest.md
  - shared/utils/mcp-connector-client-registry.ts
  - shared/utils/mcp-connector-redirect.ts
  - server/api/auth/mcp/authorize.get.ts
  - docs/runbooks/claude-desktop-mcp.md
  - app/components/admin/tokens/TokenCreateModal.vue
  - docs/verify/DISASTER_RECOVERY_RUNBOOK.md
  - docs/verify/production-deploy-checklist.md
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - app/utils/mcp-connector-return-to.ts
  - app/pages/admin/tokens/index.vue
  - server/api/auth/mcp/authorize.post.ts
  - app/pages/auth/callback.vue
  - docs/design-review-findings.md
tests:
  - e2e/mcp-connector-authorize.spec.ts
  - test/integration/mcp-connector-authorize-route.test.ts
  - test/unit/mcp-connector-redirect.test.ts
  - test/unit/mcp-connector-client-registry.test.ts
  - test/integration/mcp-oauth-tool-access.test.ts
  - test/integration/mcp-connector-authorize-post-account-guard.test.ts
-->

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
