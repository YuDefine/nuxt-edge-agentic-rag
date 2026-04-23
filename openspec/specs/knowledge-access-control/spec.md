# knowledge-access-control Specification

## Purpose

TBD - created by archiving change 'bootstrap-v1-core-from-report'. Update Purpose after archive.

## Requirements

### Requirement: Runtime Admin Allowlist

The system SHALL derive admin privileges from the runtime `ADMIN_EMAIL_ALLOWLIST` and SHALL NOT treat a database-only allowlist table or stale role snapshot as the source of truth. Every admin-only request SHALL normalize the current session email and re-evaluate it against the runtime allowlist before authorization. Persisted role data in `user_profiles` SHALL be limited to audit and UI context.

#### Scenario: Allowlisted session performs an admin action

- **WHEN** an authenticated session email is present in `ADMIN_EMAIL_ALLOWLIST`
- **THEN** the request is authorized for admin-only operations
- **AND** the persisted profile state records `admin_source = allowlist` for audit context

#### Scenario: Allowlist membership is revoked

- **WHEN** a previously allowlisted user makes a new admin-only request after the runtime allowlist no longer contains the normalized email
- **THEN** the request is denied
- **AND** a stale database role snapshot does not preserve admin access

---

### Requirement: Channel Access Matrix

The system SHALL derive `allowed_access_levels` before the first retrieval step for every Web or MCP request. Web User sessions SHALL receive `['internal']`, Web Admin sessions SHALL receive `['internal', 'restricted']`, remote MCP principals without `knowledge.restricted.read` SHALL receive `['internal']`, and remote MCP principals with `knowledge.restricted.read` SHALL receive `['internal', 'restricted']` only when the resolved local user is eligible for restricted access under the existing role model. Legacy MCP tokens SHALL remain supported only during migration, and they SHALL be normalized into the same principal context before retrieval and replay checks run. Unauthenticated users SHALL NOT access chat, admin, or MCP token management surfaces.

#### Scenario: Web user cannot retrieve restricted evidence

- **WHEN** a Web User submits a query whose relevant evidence exists only in `restricted` documents
- **THEN** the retrieval filters only include `internal`
- **AND** the response does not expose restricted evidence

#### Scenario: Eligible MCP principal widens visible access levels

- **WHEN** a remote MCP request resolves to a local principal that both carries `knowledge.restricted.read` and is eligible for restricted access under the application's role rules
- **THEN** the derived `allowed_access_levels` include both `internal` and `restricted`
- **AND** downstream retrieval and replay checks use that expanded visibility set

#### Scenario: Ineligible MCP principal cannot escalate with scope alone

- **WHEN** a remote MCP request resolves to a local principal that requests or carries `knowledge.restricted.read` but is not eligible for restricted access under the application's role rules
- **THEN** the derived `allowed_access_levels` remain `['internal']`
- **AND** the response does not expose restricted evidence

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
  - docs/runbooks/remote-mcp-connectors.md
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

### Requirement: Google OAuth Only Interactive Login

For `v1.0.0`, the Web interactive sign-in surface SHALL expose Google OAuth as the only user login path. Email/password login, GitHub OAuth, and Passkey SHALL NOT be presented or enabled in runtime config, auth handlers, or the login page for the core release.

#### Scenario: Login page only offers Google sign-in

- **WHEN** an unauthenticated user opens the Web login page in `v1.0.0`
- **THEN** the page presents Google OAuth as the primary sign-in action
- **AND** the page explains that role assignment depends on the signed-in Google account and runtime allowlist

#### Scenario: Non-report auth providers stay disabled

- **WHEN** the server boots with `v1.0.0` auth configuration
- **THEN** email/password, GitHub OAuth, and Passkey are not enabled as interactive login providers
- **AND** runtime auth behavior stays aligned with the report-defined Google OAuth scope
