## ADDED Requirements

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
