## MODIFIED Requirements

### Requirement: Channel Access Matrix

The system SHALL derive `allowed_access_levels` before the first retrieval step for every Web or MCP request. Web User sessions SHALL receive `['internal']`, Web Admin sessions SHALL receive `['internal', 'restricted']`, remote MCP principals without `knowledge.restricted.read` SHALL receive `['internal']`, and remote MCP principals with `knowledge.restricted.read` SHALL receive `['internal', 'restricted']` only when the resolved local user is eligible for restricted access under the existing role model. Legacy MCP tokens SHALL remain supported only during migration, and they SHALL be normalized into the same principal context before retrieval and replay checks run. Unauthenticated users SHALL NOT access chat, admin, or MCP token management surfaces.

#### Scenario: Web user cannot retrieve restricted evidence

- **WHEN** a Web User submits a query whose relevant evidence exists only in `restricted` documents
- **THEN** the retrieval filters only include `internal`
- **AND** the response does not expose restricted evidence

#### Scenario: Eligible MCP principal widens visible access levels

- **WHEN** a remote MCP request resolves to a local principal that both carries `knowledge.restricted.read` and is eligible for restricted access under the application's role rules
- **THEN** the derived `allowed_access_levels` include both `internal` and `restricted`
- **AND** downstream retrieval and replay checks use that expanded visibility set

#### Scenario: Ineligible MCP principal cannot escalate with scope alone

- **WHEN** a remote MCP request resolves to a local principal that requests or carries `knowledge.restricted.read` but is not eligible for restricted access under the application's role rules
- **THEN** the derived `allowed_access_levels` remain `['internal']`
- **AND** the response does not expose restricted evidence
