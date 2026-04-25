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
  - docs/runbooks/remote-mcp-connectors.md
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

---

### Requirement: MCP handler middleware preserves request body for transport

The `/mcp` JSON-RPC endpoint SHALL ensure that any intermediate read of the HTTP request body (for audit logging, tool-name extraction, rate-limit routing, or role gating) does NOT prevent the downstream MCP transport from parsing the same JSON-RPC payload. After middleware completes, the request body stream reachable from the MCP SDK transport handler MUST still be readable and contain the original client-sent bytes.

On Cloudflare Workers specifically, where `event.web.request` is the native `Request` object consumed directly by the transport, the handler MUST replace `event.web.request` with a fresh `Request` carrying the same method / URL / headers and an unread body stream before handing off to the transport.

#### Scenario: MCP initialize succeeds after middleware reads body

- **WHEN** a Cloudflare Workers MCP handler middleware reads the JSON-RPC request body (e.g. to extract the tool name for rate limiting) and then yields to the MCP transport
- **THEN** `transport.handleRequest(request)` successfully parses the original JSON-RPC body
- **AND** the response is a valid JSON-RPC `initialize` result with `serverInfo` and `capabilities`
- **AND** the HTTP status is not `400` / not a `-32700 parse_error`

#### Scenario: GET /mcp without body skips rehydration

- **WHEN** the `/mcp` endpoint receives a `GET` request with no body
- **THEN** the body-rehydration step in middleware is a no-op (not attempted)
- **AND** the existing transport-level handling of `GET` (whether 405 or SSE) is preserved

#### Scenario: POST /mcp with empty body does not crash

- **WHEN** the `/mcp` endpoint receives a `POST` with an empty or missing body (pathological client)
- **THEN** the middleware body-rehydration step does not throw
- **AND** the transport receives a valid `Request` (empty body is acceptable) and produces its standard JSON-RPC parse_error / invalid_request response

<!-- @trace
source: fix-mcp-transport-body-consumed
updated: 2026-04-24
code:
  - app/pages/index.vue
  - app/components/chat/ConversationHistory.vue
  - app/composables/useMcpConnectorAuthorization.ts
  - app/components/chat/Container.vue
  - scripts/check-staging-gate.mjs
  - app/components/chat/CitationReplayModal.vue
  - docs/tech-debt.md
  - app/composables/useChatConversationHistory.ts
tests:
  - test/unit/chat-history-sidebar-source-contract.test.ts
  - test/unit/staging-gate.test.ts
  - test/unit/conversation-history-aria.spec.ts
  - test/unit/conversation-history-component.test.ts
  - test/unit/conversation-history-midnight.spec.ts
  - e2e/chat-home-fetch-dedup.spec.ts
  - e2e/collapsible-chat-history-sidebar.spec.ts
-->

---

### Requirement: MCP handler rejects GET and DELETE with 405 per MCP spec stateless mode

The MCP endpoint at `/mcp` SHALL respond to `GET` and `DELETE` HTTP methods with status `405 Method Not Allowed`, including the `Allow: POST` response header and a JSON-RPC error body `{ jsonrpc: "2.0", error: { code: -32000, message: ... }, id: null }`. This aligns with MCP Streamable HTTP spec 2025-11-25 which permits stateless servers to decline SSE stream establishment via `405`, instructing compliant clients to continue using `POST` for all MCP communication. The `405` response SHALL be returned immediately (no long-polling, no 30s CPU hang on Cloudflare Workers).

#### Scenario: GET /mcp returns 405 immediately

- **WHEN** a client issues `GET /mcp` with `Accept: text/event-stream`
- **THEN** the endpoint returns `405 Method Not Allowed` within 1 second
- **AND** the response includes `Allow: POST` header
- **AND** the response body is a JSON-RPC error object with `code: -32000` and no `id`
- **AND** no transport instance is created, no server CPU budget is consumed waiting for server-initiated events

#### Scenario: DELETE /mcp returns 405

- **WHEN** a client issues `DELETE /mcp` (attempting client-initiated session termination)
- **THEN** the endpoint returns `405 Method Not Allowed`
- **AND** the response includes `Allow: POST` header
- **AND** the response body is a JSON-RPC error object explaining this server uses stateless POST-only transport

---

### Requirement: MCP handler POST path enforces JSON response over SSE

The MCP endpoint SHALL instantiate `WebStandardStreamableHTTPServerTransport` with `enableJsonResponse: true` and `sessionIdGenerator: undefined`, ensuring every `POST /mcp` response uses `Content-Type: application/json` containing a complete JSON-RPC response (or `202 Accepted` for notifications), rather than opening an SSE stream. This prevents Cloudflare Worker 30-second CPU timeouts on tool calls and eliminates re-initialize loops triggered by dropped SSE connections.

#### Scenario: POST initialize returns JSON response

- **WHEN** a client posts an `initialize` JSON-RPC request to `/mcp`
- **THEN** the server returns `200` with `Content-Type: application/json`
- **AND** the response body is a complete JSON-RPC `InitializeResult` (not an SSE event stream)
- **AND** no `MCP-Session-Id` header is issued (stateless)

#### Scenario: POST tools/call returns JSON response

- **WHEN** a client posts a `tools/call` request (e.g. `AskKnowledge`, `ListCategories`, `Search`, `GetDocumentChunk`) to `/mcp`
- **THEN** the server returns `200` with `Content-Type: application/json`
- **AND** the response body is a complete JSON-RPC response containing the tool result

#### Scenario: POST notification returns 202

- **WHEN** a client posts a JSON-RPC notification (e.g. `notifications/initialized`) to `/mcp`
- **THEN** the server returns `202 Accepted` with no body

---

### Requirement: Stateless MCP handler preserves existing auth and rate-limit semantics

The `405`/`JSON response` changes SHALL NOT alter middleware auth, rate-limit, or role-gate semantics. Each `POST /mcp` request SHALL continue to be authenticated via `Authorization: Bearer <token>` per the existing `mcpAuth` middleware, with rate-limit windows keyed on the token. No `MCP-Session-Id` header is introduced or consumed.

#### Scenario: POST without Bearer token still returns 401

- **WHEN** a client posts to `/mcp` without a valid `Authorization: Bearer <token>` header
- **THEN** the endpoint returns `401` before any transport work begins
- **AND** the existing `mcpAuth` error response shape is preserved

#### Scenario: Rate-limit window remains token-scoped

- **WHEN** multiple `POST /mcp` requests arrive with the same Bearer token within the rate-limit window
- **THEN** rate-limit is applied using the token as the window key (not a session ID)
- **AND** exceeded limits return the existing `429` response

---

### Requirement: Tool Discovery Metadata

The MCP tool surface SHALL expose LLM-consumable discovery metadata on every tool registered under `server/mcp/tools/` so that MCP clients can accurately select tools and construct well-formed arguments without additional prompting. Metadata SHALL include:

- Field-level `.describe()` on every Zod input field, stating purpose, expected input form, and any retrieval or ownership semantics the caller needs to know.
- Tool-level `annotations` (MCP SDK `ToolAnnotations`) specifying at minimum `readOnlyHint`, `destructiveHint`, `openWorldHint`, and `idempotentHint`. Values SHALL reflect actual handler behavior; tools that only read governed knowledge SHALL set `readOnlyHint: true` and `destructiveHint: false`.
- `inputExamples` covering at least one typical argument payload for every tool whose input is semantically non-trivial (`askKnowledge`, `searchKnowledge`, `getDocumentChunk`).

Metadata SHALL NOT change handler behavior, authentication, scope checks, or response shape. Tool `name` values SHALL NOT change.

#### Scenario: Tool list response exposes field descriptions

- **WHEN** an authenticated MCP client calls `tools/list`
- **THEN** every tool entry's `inputSchema.properties.<field>.description` is a non-empty string for every declared input field
- **AND** no field description is the literal string `"TBD"`, `"TODO"`, or an empty placeholder

#### Scenario: Tool annotations reflect read-only knowledge behavior

- **WHEN** an authenticated MCP client calls `tools/list`
- **THEN** every knowledge tool entry includes `annotations.readOnlyHint === true` and `annotations.destructiveHint === false`
- **AND** `annotations.openWorldHint` is present and aligned with whether the tool reaches the governed knowledge corpus

##### Example: annotation values per tool

| Tool             | readOnlyHint | destructiveHint | openWorldHint | idempotentHint |
| ---------------- | ------------ | --------------- | ------------- | -------------- |
| askKnowledge     | true         | false           | false         | true           |
| searchKnowledge  | true         | false           | false         | true           |
| getDocumentChunk | true         | false           | false         | true           |
| listCategories   | true         | false           | false         | true           |

#### Scenario: Semantically non-trivial tools ship input examples

- **WHEN** an authenticated MCP client calls `tools/list`
- **THEN** `askKnowledge`, `searchKnowledge`, and `getDocumentChunk` entries each include at least one entry in `inputExamples`
- **AND** every example validates against the tool's own `inputSchema`
- **AND** examples for `askKnowledge` and `searchKnowledge` cover at least one specific-topic natural-language query and one category-flavored query

#### Scenario: Metadata enrichment preserves handler behavior

- **WHEN** an authenticated MCP client calls `tools/call` with valid arguments for any knowledge tool
- **THEN** the response shape, success path, error paths, and scope enforcement match the behavior observed before metadata was added
- **AND** tool `name` values remain `askKnowledge`, `searchKnowledge`, `getDocumentChunk`, and `listCategories`

<!-- @trace
source: enhance-mcp-tool-metadata
updated: 2026-04-24
code:
  - .agents/skills/manage-mcp/references/resources.md
  - server/durable-objects/mcp-session.ts
  - server/utils/current-mcp-event.ts
  - app/pages/account/settings.vue
  - .agents/skills/manage-mcp/references/testing.md
  - server/utils/mcp-rehydrate-request-body.ts
  - app/components/admin/tokens/TokenCreateModal.vue
  - server/durable-objects/mcp-event-shim.ts
  - .env.example
  - test/evals/mcp-tool-selection.eval.ts
  - app/components/form/PositiveIntegerInput.vue
  - server/utils/mcp-middleware.ts
  - wrangler.staging.jsonc
  - app/components/auth/DeleteAccountDialog.vue
  - nuxt.config.ts
  - .github/workflows/deploy.yml
  - app/utils/positive-integer-input.ts
  - .agents/skills/commit/SKILL.md
  - server/utils/mcp-auth-context-codec.ts
  - HANDOFF.md
  - server/api/admin/mcp-tokens/index.post.ts
  - wrangler.jsonc
  - .agents/skills/manage-mcp/SKILL.md
  - app/pages/auth/login.vue
  - build/nitro/rollup.ts
  - app/utils/assert-never.ts
  - server/mcp/index.ts
  - server/utils/mcp-agents-compat.ts
  - .agents/skills/manage-mcp/references/tools.md
  - package.json
  - .agents/skills/manage-mcp/references/middleware.md
  - .agents/skills/manage-mcp/references/prompts.md
  - docs/evals/mcp-tool-selection.md
  - docs/tech-debt.md
  - scripts/mint-dev-mcp-token.mts
  - test/evals/helpers/mcp-client.ts
  - .agents/skills/manage-mcp/references/troubleshooting.md
  - app/pages/auth/callback.vue
tests:
  - test/unit/delete-account-dialog-initial-reauth.test.ts
  - test/unit/mcp-auth-context-codec.test.ts
  - test/unit/auth-login-passkey-register-transition.test.ts
  - test/integration/mcp-session-handshake.spec.ts
  - test/integration/mcp-session-tool-dispatch.spec.ts
  - test/unit/account-settings-heading-order.test.ts
  - test/unit/mcp-middleware.test.ts
  - test/integration/mcp-auth-context-forwarding.spec.ts
  - test/unit/mcp-event-shim.test.ts
  - test/unit/positive-integer-input.test.ts
  - test/integration/mcp-session-durable-object.spec.ts
-->

---

### Requirement: MCP Tool Dispatch Via Durable Object

When the `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` feature flag is enabled and a signed-in MCP client has completed a session initialize handshake, subsequent JSON-RPC requests (`tools/list`, `tools/call`, and any other non-initialize method) SHALL be dispatched inside the `MCPSessionDurableObject` through the MCP SDK server connected over `DoJsonRpcTransport`. The dispatch SHALL produce the same response shape as the stateless fallback path for identical inputs, including success payloads, structured errors, and JSON-RPC envelope fields.

The Durable Object SHALL reconstruct the caller's authentication context from a signed envelope provided by the Nuxt layer; the envelope SHALL be verified with an HMAC signature keyed on a runtime-configured secret, and SHALL be rejected when the signature is invalid or the issuance timestamp is older than sixty seconds. Tool handlers SHALL receive an execution context that exposes the same `event.context.cloudflare.env` and `event.context.mcpAuth` keys that they receive on the stateless path, so the four knowledge tool handlers do not require distinct branches for Durable Object versus stateless execution.

When a Durable Object dispatch fails at any layer (signature invalid, envelope expired, `McpServer` init error, tool handler exception, transport close), the Durable Object SHALL return the failure as a JSON-RPC error with an HTTP status that reflects the failure class (400 for malformed envelope, 401 for invalid signature, 500 for internal errors); it SHALL NOT fall back to a synthetic success payload.

#### Scenario: Tool dispatch via Durable Object produces stateless-equivalent success

- **WHEN** an authenticated MCP client with a valid session calls any of the four knowledge tools through the Durable Object path
- **THEN** the Durable Object reconstructs the auth context from the signed envelope forwarded by the Nuxt middleware
- **AND** the MCP SDK server executes the tool handler and returns the same JSON-RPC success response the stateless path would return for the same inputs
- **AND** the response includes a valid `Mcp-Session-Id` header matching the session
- **AND** the session's `lastSeenAt` is renewed and the alarm is rescheduled to `lastSeenAt + TTL`

#### Scenario: Auth context envelope with invalid signature is rejected

- **WHEN** a Durable Object receives a forwarded request with an `X-Mcp-Auth-Context` header whose HMAC signature does not verify against the configured signing key
- **THEN** the Durable Object returns HTTP 401 with a JSON-RPC error payload
- **AND** no tool handler is invoked
- **AND** the session's `lastSeenAt` is not renewed

#### Scenario: Auth context envelope older than sixty seconds is rejected

- **WHEN** a Durable Object receives a forwarded request whose auth context envelope signature verifies but whose `issuedAt` timestamp is more than sixty seconds earlier than the Durable Object's current clock
- **THEN** the Durable Object returns HTTP 401 with a JSON-RPC error payload
- **AND** no tool handler is invoked
- **AND** the response body explicitly identifies the expiry condition to aid client diagnostics

#### Scenario: Tool handler exception surfaces as JSON-RPC error without synthetic success

- **WHEN** a tool handler executing inside the Durable Object throws an error (for example, the 404 `citationId` path in `getDocumentChunk` or a scope violation in `askKnowledge`)
- **THEN** the Durable Object returns the MCP SDK's structured JSON-RPC error, not a synthetic `{ result: ... }` payload
- **AND** the HTTP status reflects the failure class (404 for citation not found, 403 for scope violation, 500 for unexpected errors)

#### Scenario: Stateless fallback remains byte-equivalent when flag is false

- **WHEN** the same request is issued against the same server with `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=false`
- **THEN** the response body and structured error payloads are byte-identical to the Durable Object path for identical inputs, excluding transport-level headers (`Mcp-Session-Id`, `Date`)
- **AND** regression integration tests covering the stateless path continue to pass without modification

<!-- @trace
source: wire-do-tool-dispatch
updated: 2026-04-25
code:
  - local/reports/archive/main-v0.0.54-working.md
  - local/reports/latest.md
  - local/reports/archive/main-v0.0.54-draft.md
  - local/excalidraw-diagram-workbench
-->
