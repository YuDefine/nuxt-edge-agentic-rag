## ADDED Requirements

### Requirement: Restricted Scope Violation Audit

The system SHALL persist a `query_logs` audit record whenever an MCP client attempts to access a restricted citation without the required scope. The record MUST capture `channel='mcp'`, `status='blocked'`, the offending `token_id`, the attempted `citation_id`, the active `config_snapshot_version`, and `risk_flags_json` containing `restricted_scope_violation`. The audit write MUST occur before the 403 error is thrown to the caller, so that no successful HTTP response can return without a corresponding log row.

#### Scenario: Non-restricted token attempts restricted citation replay

- **WHEN** an MCP client authenticated with a token lacking `knowledge.restricted.read` calls `getDocumentChunk` against a citation whose underlying document `access_level='restricted'`
- **THEN** the handler SHALL insert a `query_logs` row with `channel='mcp'`, `status='blocked'`, `risk_flags_json` containing `'restricted_scope_violation'`, the active `config_snapshot_version`, and the violating token id
- **AND** the handler SHALL return HTTP 403 with no chunk content, document title, or citation locator in the response body
- **AND** the audit row SHALL be queryable via `wrangler d1 execute agentic-rag-db --remote --command "SELECT * FROM query_logs WHERE status='blocked' AND risk_flags_json LIKE '%restricted_scope_violation%'"`

#### Scenario: Audit write failure does not mask the 403 response

- **WHEN** the `query_logs` INSERT fails (e.g., D1 transient error) during a restricted scope violation
- **THEN** the handler SHALL log the audit failure via `log.error` with the violating token id and citation id
- **AND** the handler SHALL still return HTTP 403 to the caller (best-effort audit, fail-loud refusal)
- **AND** the response body MUST NOT contain restricted content even when the audit fails

#### Scenario: Successful restricted access by authorized token does not duplicate audit

- **WHEN** an MCP client authenticated with a token holding `knowledge.restricted.read` successfully replays a restricted citation
- **THEN** the existing successful-path audit (`status='accepted'`) SHALL be the sole `query_logs` row for that request
- **AND** no `restricted_scope_violation` flag SHALL appear on accepted requests
