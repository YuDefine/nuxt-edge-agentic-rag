## ADDED Requirements

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
