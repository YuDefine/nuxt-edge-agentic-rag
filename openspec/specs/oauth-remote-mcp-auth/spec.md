# oauth-remote-mcp-auth Specification

## Purpose

TBD - created by archiving change 'oauth-user-delegated-remote-mcp'. Update Purpose after archive.

## Requirements

### Requirement: Remote MCP Authorization Uses Existing Local Accounts

The system SHALL authorize remote MCP access only for an already-provisioned local user account. The authorization flow SHALL reuse the existing local sign-in/session truth and SHALL NOT create a new local user as a side effect of connector authorization.

#### Scenario: Existing signed-in user authorizes remote MCP access

- **WHEN** a signed-in local user starts connector authorization for a supported remote MCP client
- **THEN** the authorization flow resolves that user's existing local `user.id`
- **AND** the system proceeds to consent and token issuance without creating a new user row

#### Scenario: Unknown user is denied connector authorization

- **WHEN** a connector authorization flow reaches the application without a resolvable pre-existing local account
- **THEN** the system denies authorization
- **AND** the response instructs the caller to complete the normal application onboarding or sign-in flow first

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

### Requirement: Remote MCP Clients Must Be Pre-Registered

The system SHALL accept remote MCP authorization requests only from pre-registered connector clients. Each registered client SHALL define its `client_id`, permitted redirect URIs, enabled status, environment binding, and allowed scope set. Requests from unknown, disabled, or redirect-mismatched clients SHALL be rejected before user consent is granted.

#### Scenario: Unknown client is rejected

- **WHEN** a remote MCP authorization request presents a `client_id` that is not registered for the current environment
- **THEN** the system rejects the request
- **AND** no consent screen or access token issuance occurs

#### Scenario: Redirect URI mismatch is rejected

- **WHEN** a registered client starts authorization with a redirect URI outside its configured allowlist
- **THEN** the system rejects the request
- **AND** the user is not asked to grant consent for that request

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

### Requirement: OAuth Access Tokens Resolve To Local MCP Principals

The system SHALL issue remote MCP access tokens whose subject is the local `user.id`. The granted scope set SHALL be the intersection of the client's allowed scopes, the requested scopes, and the application's MCP scope vocabulary. MCP middleware SHALL be able to resolve the token into a local MCP principal without consulting legacy `mcp_tokens` state.

#### Scenario: Access token subject is the local user

- **WHEN** a user approves authorization for a supported remote MCP client
- **THEN** the issued access token resolves to that user's local `user.id`
- **AND** downstream MCP authorization uses that local principal for role, guest policy, and audit checks

#### Scenario: Unsupported scope is not granted

- **WHEN** a client requests a scope outside the application's supported `knowledge.*` scope vocabulary or outside the client's configured allowlist
- **THEN** the system does not grant that scope
- **AND** the resulting MCP principal only carries the permitted scope subset

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

### Requirement: ChatGPT Connector OAuth Callback Path Segment Has Restricted Character Set

The ChatGPT connector OAuth callback redirect URI validation SHALL accept only path segments drawn from the character set `[A-Za-z0-9_-]` with length between 1 and 64 characters after the `/connector/oauth/` prefix. The system SHALL reject redirect URIs whose callback path contains any other character (including `.`, `/`, query or fragment markers, Unicode codepoints) and SHALL reject segments exceeding 64 characters.

#### Scenario: ASCII alphanumeric connector id is accepted

- **WHEN** the system validates a ChatGPT connector OAuth redirect URI whose path is `/connector/oauth/connector-abc_123`
- **THEN** validation accepts the URI and the flow proceeds to token issuance

#### Scenario: Dot in segment is rejected

- **WHEN** the system validates a ChatGPT connector OAuth redirect URI whose path is `/connector/oauth/foo.bar`
- **THEN** validation rejects the URI
- **AND** the caller receives an authorization error rather than proceeding

#### Scenario: Unicode codepoint in segment is rejected

- **WHEN** the system validates a ChatGPT connector OAuth redirect URI whose path contains non-ASCII characters (for example `/connector/oauth/漢字id`)
- **THEN** validation rejects the URI

#### Scenario: Segment longer than 64 characters is rejected

- **WHEN** the system validates a ChatGPT connector OAuth redirect URI whose segment after `/connector/oauth/` exceeds 64 characters
- **THEN** validation rejects the URI

<!-- @trace
source: code-quality-review-followups
updated: 2026-04-24
code:
  - app/pages/auth/login.vue
  - app/pages/auth/callback.vue
  - app/middleware/auth.global.ts
  - app/utils/auth-return-to.ts
  - app/middleware/admin.ts
  - app/pages/index.vue
tests:
  - test/integration/auth-redirect-flow.spec.ts
-->

---

### Requirement: Token revocation SHALL cascade-invalidate active session Durable Object storage

The system SHALL, upon successful revocation of an MCP authorization token, cascade-invalidate any Durable Object session storage that was created using the revoked token. The cascade invalidation SHALL be best-effort and SHALL NOT block or fail the primary token revocation flow on cascade errors. An idle TTL alarm on the Durable Object SHALL remain in place as a safety net so that orphaned session storage is eventually reclaimed even when cascade invalidation is skipped or fails.

The cascade invalidation SHALL be triggered through an internal-only Durable Object endpoint that requires HMAC authentication. The HMAC SHALL bind the request to a specific session identifier and a recent timestamp so that captured signatures cannot be replayed indefinitely. External callers without a valid HMAC signature SHALL receive a forbidden response distinct from the existing stateless fallback rejection used for plain GET and DELETE requests.

#### Scenario: Successful revocation invalidates active session storage within bounded time

- **WHEN** an admin revokes an MCP authorization token that has at least one active Durable Object session attached
- **THEN** the system records the token as revoked in the primary token store and writes the revocation audit entry as before
- **AND** the system reads the token-to-session index for the revoked token
- **AND** for each indexed session identifier, the system invokes the Durable Object internal invalidate endpoint with a valid HMAC-signed header
- **AND** each addressed Durable Object clears its persistent storage and in-memory state within a bounded time window measured in seconds, not minutes
- **AND** the token-to-session index entry for the revoked token is cleared after the cascade attempt completes

#### Scenario: Cascade failure does not block revocation

- **WHEN** the cascade invalidation step fails for any reason such as a Durable Object being unreachable, the token-to-session index being missing, or the HMAC verification round-trip raising an error
- **THEN** the primary token revocation flow still completes successfully and returns a successful response to the admin caller
- **AND** the system records the cascade failure as a warning observation event for later inspection
- **AND** the existing Durable Object idle TTL alarm continues to act as the safety net that eventually clears any session storage left behind

#### Scenario: External caller cannot trigger session storage invalidation

- **WHEN** any caller other than the trusted internal revocation flow sends a request that attempts to invalidate a Durable Object session, including requests that omit the HMAC header, supply a tampered signature, or replay a stale signature beyond the accepted timestamp window
- **THEN** the Durable Object SHALL reject the request with a forbidden response that is distinct from the existing stateless fallback response used for plain GET and DELETE requests
- **AND** no session storage SHALL be cleared as a result of the rejected request
- **AND** the rejection SHALL produce an observable event so that abuse attempts can be inspected

<!-- @trace
source: add-mcp-token-revoke-do-cleanup
updated: 2026-04-26
code:
  - HANDOFF.md
  - package.json
  - docs/tech-debt.md
  - server/api/chat.post.ts
  - server/utils/workers-ai.ts
  - server/utils/chat-sse-response.ts
tests:
  - test/unit/workers-ai.test.ts
  - test/integration/chat-route.test.ts
-->
