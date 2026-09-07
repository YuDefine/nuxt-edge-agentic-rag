## ADDED Requirements

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
