## ADDED Requirements

### Requirement: Stateless MCP Authentication

The MCP surface SHALL accept only `Authorization: Bearer <token>` authentication, store token values as hashes, require tool-specific scopes, and reject `conversationId` or `MCP-Session-Id` state coupling in `v1.0.0`. Missing or invalid tokens SHALL return `401`, and scope failures or restricted citation replay attempts SHALL return `403`.

#### Scenario: Missing token returns 401

- **WHEN** an MCP request omits the Bearer token header or provides an invalid token
- **THEN** the endpoint returns `401`
- **AND** no retrieval, model, or replay work starts

#### Scenario: Restricted citation replay without scope returns 403

- **WHEN** `getDocumentChunk` resolves a citation that points to `restricted` content and the token lacks `knowledge.restricted.read`
- **THEN** the endpoint returns `403`
- **AND** the response does not reveal the restricted chunk text

### Requirement: Stateless Ask And Replay

`askKnowledge` SHALL reuse the same validated retrieval, confidence routing, refusal, and citation-mapping core as the Web answer path after MCP authorization succeeds. `getDocumentChunk` SHALL replay the cited snapshot using `citationId`, SHALL re-check access rules before returning chunk text, and SHALL return `404` only when the `citationId` is absent or no longer replayable.

#### Scenario: Ask returns refused after successful authorization

- **WHEN** an authorized `askKnowledge` request has no sufficient evidence in the caller's visible set
- **THEN** the tool returns `refused = true` with empty citations
- **AND** the tool does not translate that business refusal into `401` or `403`

#### Scenario: Historical citation replay stays available inside retention

- **WHEN** `getDocumentChunk` receives a valid citation whose source version is no longer current but still inside the retention window
- **THEN** the tool returns the historical chunk snapshot
- **AND** the replay result still passes current authorization checks for that caller

### Requirement: Filtered Search And Categories

`searchKnowledge` SHALL apply `allowed_access_levels` before retrieval and SHALL return `200` with `results: []` when no visible evidence remains. `listCategories` SHALL count only visible `active` documents with a current version, deduplicate counts per document, and return categories in stable name order. Neither tool SHALL expose internal diagnostics such as retrieval scores, decision paths, or document version identifiers.

#### Scenario: Restricted-only search stays hidden

- **WHEN** an authorized token without `knowledge.restricted.read` searches for content that exists only in `restricted` documents
- **THEN** `searchKnowledge` returns `200` with `results: []`
- **AND** the response does not reveal that restricted evidence exists

#### Scenario: Category counts ignore historical versions

- **WHEN** `listCategories(includeCounts = true)` runs on a dataset that contains archived documents and multiple historical versions of the same active document
- **THEN** each category count includes only visible `active` documents with one current version
- **AND** historical versions do not increase the returned count
