## ADDED Requirements

### Requirement: Retrieval pipeline SHALL apply optional LLM-based query rewriting before AI Search

The system SHALL provide an optional query rewriting step that runs after `normalizeKnowledgeQuery` and before the AI Search call inside `retrieveVerifiedEvidence`. The rewriter SHALL transform the user query into a "title-restatement form" that more closely matches index document phrasing. The rewriter SHALL be controlled by the `features.queryRewriting` runtime flag and SHALL preserve the existing retrieval contract when disabled.

#### Scenario: Rewriter enabled produces transformed query for AI Search

- **WHEN** `features.queryRewriting` is true AND a Web chat or MCP ask request triggers `retrieveVerifiedEvidence`
- **THEN** the system SHALL invoke the rewriter to transform the normalized query
- **AND** the system SHALL pass the rewritten query (not the original normalized query) to the AI Search client
- **AND** the system SHALL record both original and rewritten queries in the retrieval audit log

#### Scenario: Rewriter disabled preserves original retrieval flow

- **WHEN** `features.queryRewriting` is false
- **THEN** the system SHALL skip the rewriter step entirely
- **AND** the system SHALL pass the normalized query directly to AI Search as before
- **AND** the audit log SHALL record `rewriter_status = 'disabled'`

#### Scenario: Rewriter applies to all four retrieval entry points

- **WHEN** any of `web-chat.ts`, `mcp-ask.ts`, `mcp-search.ts`, or `knowledge-answering.ts` triggers retrieval
- **THEN** all four entry points SHALL use the same `isQueryRewritingEnabled(runtimeConfig)` helper to determine flag state
- **AND** no entry point SHALL hard-code the flag value

### Requirement: Query rewriter SHALL fall back gracefully on failure

The query rewriter MUST NOT throw out of the retrieval flow. On LLM timeout, HTTP error, or JSON parse failure, the rewriter SHALL return the original normalized query and SHALL record the failure reason in the retrieval audit log. The retrieval flow SHALL continue uninterrupted.

#### Scenario: LLM timeout falls back to original query

- **WHEN** the rewriter LLM call exceeds the configured timeout
- **THEN** the rewriter SHALL return the original normalized query
- **AND** the audit log SHALL record `rewriter_status = 'fallback_timeout'`
- **AND** the retrieval flow SHALL proceed using the original query

#### Scenario: LLM HTTP error falls back to original query

- **WHEN** the rewriter LLM call returns a 5xx response or network error
- **THEN** the rewriter SHALL return the original normalized query
- **AND** the audit log SHALL record `rewriter_status = 'fallback_error'`

#### Scenario: LLM JSON parse failure falls back to original query

- **WHEN** the rewriter LLM response cannot be parsed as the expected JSON shape
- **THEN** the rewriter SHALL return the original normalized query
- **AND** the audit log SHALL record `rewriter_status = 'fallback_parse'`

#### Scenario: Rewriter never propagates exceptions to retrieval

- **WHEN** any error occurs inside the rewriter
- **THEN** the rewriter function SHALL NOT throw
- **AND** the retrieval pipeline SHALL receive a valid string return value in all failure modes

### Requirement: Retrieval audit log SHALL record query rewriter status and output

The `query_log_debug` table SHALL include columns that capture the rewriter outcome and the rewritten query string for every retrieval invocation. Admin debug consumers SHALL be able to inspect both fields to audit retrieval behavior.

#### Scenario: Successful rewrite records both status and rewritten query

- **WHEN** the rewriter successfully transforms a query
- **THEN** the system SHALL write `rewriter_status = 'success'` to `query_log_debug`
- **AND** the system SHALL write the transformed query to `rewritten_query`

#### Scenario: Disabled or fallback path records status only

- **WHEN** the rewriter is disabled or falls back due to failure
- **THEN** the system SHALL write the appropriate `rewriter_status` value
- **AND** the system SHALL leave `rewritten_query` as NULL

#### Scenario: Existing query_log_debug rows remain readable after migration

- **WHEN** migration 0017 adds the new columns
- **THEN** existing rows SHALL automatically receive `rewriter_status = 'disabled'` via column default
- **AND** existing rows SHALL receive `rewritten_query = NULL`
- **AND** all admin debug API responses for pre-migration logs SHALL remain backward compatible

### Requirement: Query rewriting feature flag SHALL default to false in production

The `features.queryRewriting` runtime flag SHALL default to `false` in the production environment until acceptance evidence demonstrates that retrieval quality improves without exceeding the latency budget. The flag SHALL default to `true` in the staging environment so acceptance fixtures can produce evidence under realistic conditions. Production ramp SHALL be gated by a recorded decision document.

#### Scenario: Production deploys with rewriter disabled

- **WHEN** the production worker boots
- **THEN** `runtimeConfig.features.queryRewriting` SHALL evaluate to `false`
- **AND** retrieval behavior SHALL match the pre-change baseline

#### Scenario: Staging deploys with rewriter enabled

- **WHEN** the staging worker boots
- **THEN** `runtimeConfig.features.queryRewriting` SHALL evaluate to `true`
- **AND** retrieval SHALL invoke the rewriter for every chat or MCP ask request

#### Scenario: Production ramp requires acceptance evidence

- **WHEN** an operator considers enabling the flag in production
- **THEN** the operator SHALL first reference a decision document that records:
  - Acceptance fixture coverage of at least 50% achieving retrieval_score ≥ 0.55
  - Latency p95 increment under 800ms compared to baseline
  - Rewriter fallback rate under 10%
- **AND** production ramp SHALL be tracked as a separate change, not as part of this change
