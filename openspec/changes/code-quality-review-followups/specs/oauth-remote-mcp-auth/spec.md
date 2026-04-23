## ADDED Requirements

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
