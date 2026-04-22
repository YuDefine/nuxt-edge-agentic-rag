# mcp-knowledge-tools Specification

## Purpose

TBD - created by archiving change 'bootstrap-v1-core-from-report'. Update Purpose after archive.

## Requirements

### Requirement: Stateless MCP Authentication

The MCP surface SHALL accept `Authorization: Bearer <token>` authentication for both remote OAuth access tokens and legacy MCP tokens, require tool-specific scopes, and reject `conversationId` or `MCP-Session-Id` state coupling in `v1.0.0`. OAuth access tokens SHALL resolve to a local MCP principal whose subject is the local `user.id`; legacy MCP tokens SHALL continue to resolve through hashed token lookup during migration. Missing or invalid tokens SHALL return `401`, and scope failures or restricted citation replay attempts SHALL return `403`.

#### Scenario: Missing token returns 401

- **WHEN** an MCP request omits the Bearer token header or provides an invalid token
- **THEN** the endpoint returns `401`
- **AND** no retrieval, model, or replay work starts

#### Scenario: OAuth token authenticates as a local principal

- **WHEN** an MCP request presents a valid remote OAuth access token
- **THEN** the MCP middleware resolves the token to a local principal whose subject is the local `user.id`
- **AND** downstream tool authorization uses that principal without requiring a legacy `mcp_tokens` row

#### Scenario: Restricted citation replay without scope returns 403

- **WHEN** `getDocumentChunk` resolves a citation that points to `restricted` content and the caller lacks `knowledge.restricted.read`
- **THEN** the endpoint returns `403`
- **AND** the response does not reveal the restricted chunk text

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
  - docs/runbooks/claude-desktop-mcp.md
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

---

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
