## ADDED Requirements

### Requirement: MCP knowledge tools SHALL use the same AI Search retrieval adapter

MCP `askKnowledge` 與 `searchKnowledge` SHALL use the same Cloudflare AI Search retrieval adapter as Web chat. The tools SHALL preserve existing MCP authorization, scope checks, visibility filtering, and response shapes while replacing legacy AutoRAG binding usage with `AI_SEARCH.get(instanceId).search()`.

#### Scenario: MCP ask uses AI Search namespace binding after authorization

- **WHEN** an authorized MCP caller invokes `askKnowledge`
- **THEN** the tool SHALL complete MCP auth and scope checks before retrieval
- **AND** retrieval SHALL use `AI_SEARCH.get(<configured instance id>).search(...)`
- **AND** retrieval SHALL NOT call `AI.autorag(<index name>).search(...)`
- **AND** answer generation / judge logic SHALL continue using the Workers AI `AI` binding when required

#### Scenario: MCP search uses AI Search namespace binding and keeps visibility contract

- **WHEN** an authorized MCP caller invokes `searchKnowledge`
- **THEN** the tool SHALL derive allowed access levels from the MCP principal and scopes
- **AND** retrieval SHALL use the shared AI Search adapter
- **AND** D1 post-verification SHALL still remove candidates outside the caller's visible set
- **AND** the tool SHALL continue returning `200` with `results: []` when no visible evidence remains

#### Scenario: MCP search response does not expose internal diagnostics

- **WHEN** MCP `searchKnowledge` receives candidates from AI Search `chunks`
- **THEN** the tool SHALL map only the existing public search result fields into the MCP response
- **AND** the response SHALL NOT expose internal `documentVersionId`, raw AI Search chunk metadata, retrieval scores, or Cloudflare scoring details beyond the established MCP contract

### Requirement: MCP AI Search binding failures SHALL fail before business-response mapping

If the AI Search binding is unavailable or malformed, MCP retrieval tools SHALL surface a service-unavailable runtime error instead of returning an empty successful business result. This preserves the distinction between infrastructure failure and a valid no-evidence refusal.

#### Scenario: Missing AI_SEARCH binding does not become `results: []`

- **WHEN** `searchKnowledge` is called with valid MCP auth but Cloudflare env lacks `AI_SEARCH`
- **THEN** the tool SHALL fail through the service-unavailable path
- **AND** the tool SHALL NOT return `200` with `results: []`
- **AND** the failure SHALL be observable in route logging / evlog

#### Scenario: Cloudflare AI Search error does not become a business refusal

- **WHEN** `AI_SEARCH.get(instanceId).search()` rejects during `askKnowledge`
- **THEN** the tool SHALL NOT translate the infrastructure error into `refused = true`
- **AND** the failure SHALL propagate to the existing MCP route error handling path
- **AND** successful no-evidence refusals SHALL remain reserved for completed retrieval with insufficient verified evidence
