## ADDED Requirements

### Requirement: Tool-Selection Eval Coverage

The project SHALL maintain an LLM-based tool-selection eval harness under `test/evals/` that exercises the published MCP tool surface and produces a score against a hand-curated ground-truth dataset. Coverage SHALL include:

- All four knowledge tools: `askKnowledge`, `searchKnowledge`, `getDocumentChunk`, `listCategories`.
- At least three query patterns per tool: a specific-topic natural-language query, a category-flavored query, and at least one boundary case (e.g., empty / overly generic query or citation-id replay).
- A minimum of 12 ground-truth samples spanning the four tools.

The harness SHALL execute against a running MCP server (dev server or equivalent local instance) over the same transport path used by real clients; it SHALL NOT bypass middleware, auth, or tool registration by importing tool modules directly.

#### Scenario: Harness runs against the real MCP surface

- **WHEN** a developer runs the eval harness entry script
- **THEN** the harness connects to the configured MCP server URL, performs a `tools/list` handshake, and uses the returned tool metadata as the only source of tool descriptions provided to the LLM
- **AND** the harness does not import `server/mcp/tools/*` modules to reconstruct tool descriptions

#### Scenario: Dataset covers all four tools with multiple patterns

- **WHEN** the eval dataset file is loaded
- **THEN** every one of the four tool names appears as the expected tool in at least one sample
- **AND** each tool has at least three samples, of which at least one represents a specific-topic query and at least one represents a category-flavored or boundary query
- **AND** the total sample count is at least 12

### Requirement: Non-Blocking Eval Execution

The eval harness SHALL run as a developer- or nightly-initiated command and SHALL NOT be invoked by the default test, lint, typecheck, or CI gates. A failing eval SHALL NOT block merges or deploys.

#### Scenario: Eval is excluded from default quality gates

- **WHEN** a developer runs the project's default quality gate command (for example, the combined format / lint / typecheck / test task)
- **THEN** the eval harness is not executed and no LLM API call is made

#### Scenario: Eval failure does not block CI

- **WHEN** the eval harness exits with a non-zero status because the score fell below the regression threshold
- **THEN** pull request status checks remain green for the default CI pipeline
- **AND** the failure surfaces through the manual / nightly channel where the harness was run

### Requirement: Regression Threshold Based On Baseline

The eval harness SHALL compare each run against a recorded baseline score stored in the project documentation. A run SHALL be treated as a regression when its overall score falls more than five percentage points below the baseline. Baseline updates SHALL be explicit documentation changes, not silently recomputed on each run.

#### Scenario: Run within tolerance is reported as pass

- **WHEN** the eval harness completes with an overall score within five percentage points of the recorded baseline
- **THEN** the harness exits with status zero
- **AND** the summary report lists pass/fail per sample and the overall score delta versus baseline

#### Scenario: Run below tolerance is reported as regression

- **WHEN** the eval harness completes with an overall score more than five percentage points below the recorded baseline
- **THEN** the harness exits with a non-zero status
- **AND** the summary report identifies which samples drove the regression

#### Scenario: Baseline update requires explicit edit

- **WHEN** a developer wants to update the recorded baseline
- **THEN** the change is made by editing the baseline entry in the eval documentation file
- **AND** the harness does not overwrite the baseline automatically on any successful or failed run

### Requirement: Scored Dimensions

Each sample SHALL be scored on two dimensions whose weighted sum is the per-sample score:

- Tool-name match (weight 60 percent): the tool name the LLM chose SHALL equal the expected tool name for the sample.
- Arguments shape match (weight 40 percent): the arguments the LLM produced SHALL validate against the expected tool's input schema, and any fixture-defined argument-content check SHALL also pass.

Per-sample scores SHALL be aggregated into an overall score as an unweighted mean across samples, expressed as a percentage.

#### Scenario: Sample with correct tool and valid arguments scores 100 percent

- **WHEN** the LLM selects the expected tool name and produces arguments that validate against that tool's input schema and satisfy the fixture's content check
- **THEN** the sample's per-sample score is 100 percent

##### Example: weighted score per sample

| Tool chosen | Matches expected tool? | Args validate & content-check pass? | Per-sample score |
| ----------- | ---------------------- | ----------------------------------- | ---------------- |
| expected    | yes                    | yes                                 | 100%             |
| expected    | yes                    | no                                  | 60%              |
| other       | no                     | n/a                                 | 0%               |

#### Scenario: Sample with wrong tool scores zero regardless of arguments

- **WHEN** the LLM selects a tool name other than the expected tool
- **THEN** the sample's per-sample score is zero percent
- **AND** the arguments-shape dimension is not evaluated for that sample
