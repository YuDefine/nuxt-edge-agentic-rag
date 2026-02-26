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

The system SHALL derive `allowed_access_levels` before the first retrieval step for every Web or MCP request. Web User sessions SHALL receive `['internal']`, Web Admin sessions SHALL receive `['internal', 'restricted']`, MCP tokens without `knowledge.restricted.read` SHALL receive `['internal']`, and MCP tokens with `knowledge.restricted.read` SHALL receive `['internal', 'restricted']`. Unauthenticated users SHALL NOT access chat, admin, or MCP token management surfaces.

#### Scenario: Web user cannot retrieve restricted evidence

- **WHEN** a Web User submits a query whose relevant evidence exists only in `restricted` documents
- **THEN** the retrieval filters only include `internal`
- **AND** the response does not expose restricted evidence

#### Scenario: Restricted MCP token widens visible access levels

- **WHEN** an active MCP token includes `knowledge.restricted.read`
- **THEN** the derived `allowed_access_levels` include both `internal` and `restricted`
- **AND** downstream retrieval and replay checks use that expanded visibility set

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
