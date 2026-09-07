## ADDED Requirements

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
