# governance-and-observability Specification

## Purpose

TBD - created by archiving change 'bootstrap-v1-core-from-report'. Update Purpose after archive.

## Requirements

### Requirement: Masked Audit Records

Before model inference, the system SHALL evaluate user input for secrets, credentials, and PII risk. When high-risk input is detected, the system SHALL refuse the request before persisting raw content, SHALL store only marker or redacted forms in `messages`, and SHALL write `risk_flags_json`, `redaction_applied`, and the governing config snapshot version into `query_logs`.

#### Scenario: High-risk input never persists raw text

- **WHEN** a request contains high-risk secrets, credentials, or PII that triggers the redaction policy
- **THEN** the system rejects or blocks the request before raw content reaches durable storage
- **AND** persisted records contain only markers, redacted summaries, or audit metadata

---
### Requirement: Per-Channel Rate Limits

The system SHALL enforce fixed-window rate limits in KV for `/api/chat` per user and for each MCP tool per token. The initial `v1.0.0` baselines SHALL be 30 requests per 5 minutes for `/api/chat`, 30 for `askKnowledge`, 60 for `searchKnowledge`, and 120 for both `getDocumentChunk` and `listCategories`. Exceeding the active window SHALL return `429` and SHALL NOT consume additional downstream retrieval or model work.

#### Scenario: Chat limit returns 429

- **WHEN** a user exceeds the active `/api/chat` window limit
- **THEN** the system returns `429`
- **AND** the request does not execute retrieval or answer generation

---
### Requirement: Retention And Replay Window

The system SHALL retain `query_logs`, `citation_records`, `source_chunks.chunk_text`, and revoked or expired MCP token metadata for 180 days, and SHALL keep historical citation replay available inside that window even when the source document version is no longer current or the document is archived. After the retention window expires, the replay endpoint SHALL treat the citation as unavailable.

#### Scenario: Replay succeeds within retention

- **WHEN** a caller with valid scope requests a citation that was recorded within the retention window
- **THEN** `getDocumentChunk` returns the preserved chunk snapshot
- **AND** the replay result does not depend on the cited version still being current

#### Scenario: Replay expires after retention

- **WHEN** a citation falls outside the configured retention window
- **THEN** the replay endpoint treats the citation as unavailable
- **AND** the caller receives the same unavailable outcome as any other non-replayable citation

---
### Requirement: Environment Isolation

Local/Dev, Staging/Preview, and Production SHALL use separate D1, R2, KV, and AI Search resources. Secrets, OAuth credentials, binding names, and feature flags SHALL enter through runtime config or deployment settings, and Production SHALL default `features.passkey`, `features.mcpSession`, `features.cloudFallback`, and `features.adminDashboard` to false.

#### Scenario: Preview deployment uses isolated resources

- **WHEN** a Preview or Staging environment is configured for validation
- **THEN** its D1, R2, KV, and AI Search bindings are distinct from Production
- **AND** test data cannot mutate Production truth sources

#### Scenario: Production starts with deferred feature flags off

- **WHEN** Production boots `v1.0.0`
- **THEN** `features.passkey`, `features.mcpSession`, `features.cloudFallback`, and `features.adminDashboard` remain disabled by default
- **AND** those flags only change through runtime configuration updates
