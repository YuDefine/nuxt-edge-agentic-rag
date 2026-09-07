# ai-gateway-routing Specification

## Purpose

TBD - created by archiving change 'add-ai-gateway-usage-tracking'. Update Purpose after archive.

## Requirements

### Requirement: AI Gateway Routing For All Workers AI Calls

The system SHALL route all Workers AI binding invocations (`env.AI.autorag(...)`, `env.AI.run(...)`, and any future Workers AI methods consumed by `/api/chat`, `/api/mcp/ask`, `/api/mcp/search`) through a configured Cloudflare AI Gateway instance whose identifier is supplied by runtime configuration. The system MUST NOT bypass the gateway when a gateway identifier is configured, and MUST fall back to direct binding invocation only when no gateway identifier is present in runtime configuration.

#### Scenario: Chat endpoint routes through gateway

- **WHEN** a request to `/api/chat` triggers `env.AI.autorag(indexName).search(...)` and runtime config contains a non-empty `aiGateway.id`
- **THEN** the call SHALL include a `gateway: { id: <configured id> }` parameter so that the request is recorded by the configured AI Gateway

#### Scenario: MCP search endpoint routes through gateway

- **WHEN** a request to `/api/mcp/search` triggers `env.AI.autorag(indexName).search(...)` and runtime config contains a non-empty `aiGateway.id`
- **THEN** the call SHALL include the same `gateway: { id }` parameter and the gateway log SHALL show the request with the configured gateway id

#### Scenario: Missing gateway id falls back to direct binding

- **WHEN** runtime config `aiGateway.id` is empty or undefined
- **THEN** the AI binding SHALL be invoked without the `gateway` parameter and the request MUST still complete successfully against Workers AI directly

---

### Requirement: Gateway Identifier Comes From Runtime Configuration

The system SHALL read the gateway identifier from `runtimeConfig.knowledge.aiGateway.id`, populated from the `NUXT_KNOWLEDGE_AI_GATEWAY_ID` environment variable injected at build time and surfaced through the existing `createKnowledgeRuntimeConfig` schema. The identifier MUST NOT be hard-coded in any source file, MUST NOT be read from `process.env` at request time inside handlers, and MUST be unique per deployment environment (preview, staging, production).

#### Scenario: Gateway id loaded into runtime config

- **WHEN** `pnpm build` runs with `NUXT_KNOWLEDGE_AI_GATEWAY_ID=agentic-rag-production` set
- **THEN** `runtimeConfig.knowledge.aiGateway.id` SHALL equal `"agentic-rag-production"` at runtime

#### Scenario: Production and staging use distinct gateways

- **WHEN** the production deployment uses `NUXT_KNOWLEDGE_AI_GATEWAY_ID=agentic-rag-production` and the staging deployment uses `NUXT_KNOWLEDGE_AI_GATEWAY_ID=agentic-rag-staging`
- **THEN** AI calls from each environment SHALL appear only in the corresponding gateway's logs and the two MUST NOT mix

---

### Requirement: Cache Skipping For Admin Operations

The system SHALL allow individual call sites to bypass gateway-level caching by passing `skipCache: true` in the `gateway` parameter. Calls originating from admin write paths (document re-index, content republish) MUST set `skipCache: true`. Calls from chat and MCP read paths MUST NOT set `skipCache` so that gateway-level caching can be applied.

#### Scenario: Admin reindex skips cache

- **WHEN** an admin triggers document re-index that invokes Workers AI for a fresh embedding
- **THEN** the AI call SHALL include `gateway: { id, skipCache: true }` and the gateway dashboard MUST show this request as a cache miss

#### Scenario: Chat retrieval allows cache

- **WHEN** the same `/api/chat` query is repeated within the configured cache TTL
- **THEN** the second call SHALL include `gateway: { id }` (no `skipCache`) and the gateway dashboard SHALL register a cache hit

---

### Requirement: Gateway Routing Failures Surface To Caller

The system SHALL NOT silently swallow Cloudflare AI Gateway errors. If the gateway returns a non-success response, the existing error handling in chat / MCP endpoints SHALL surface the error to the caller with the original status code, and MUST NOT silently retry by bypassing the gateway, because bypassing would create observability gaps in usage logs.

#### Scenario: Gateway 5xx surfaces to chat client

- **WHEN** the AI Gateway returns a 502 for a `/api/chat` invocation
- **THEN** the chat handler SHALL respond with a 5xx status to the client and the failure MUST be visible in `evlog` request logs
- **AND** the system MUST NOT retry the same call with the `gateway` parameter omitted
