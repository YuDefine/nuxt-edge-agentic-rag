## ADDED Requirements

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
