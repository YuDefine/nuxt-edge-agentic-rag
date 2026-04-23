## ADDED Requirements

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
