## ADDED Requirements

### Requirement: Admin Token List And Create UI

The system SHALL provide an Admin-only token management page that lists MCP tokens with label, scopes, status, expiry, and last-used metadata, and SHALL allow Admins to create new tokens through a controlled UI flow.

#### Scenario: Admin sees token metadata list

- **WHEN** an Admin opens the token management page
- **THEN** the page lists existing tokens with label, scopes, status, expiry, and last-used information
- **AND** the page does not reveal token plaintext values in the list

#### Scenario: Token creation reveals secret once

- **WHEN** an Admin creates a new token successfully
- **THEN** the UI reveals the token secret exactly once in the success state
- **AND** later reloads show only hashed/metadata views, never the plaintext token again

### Requirement: Token Revoke UI

The token management UI SHALL allow Admins to revoke active tokens and SHALL reflect revoked state without deleting historical audit metadata.

#### Scenario: Revoked token stays visible as revoked metadata

- **WHEN** an Admin revokes an active token
- **THEN** the token list updates to show revoked status
- **AND** the UI preserves audit-safe metadata such as label and revoked timestamp

#### Scenario: Non-admin cannot access token UI

- **WHEN** a non-admin user requests the token management page
- **THEN** the system blocks access
- **AND** does not reveal token metadata
