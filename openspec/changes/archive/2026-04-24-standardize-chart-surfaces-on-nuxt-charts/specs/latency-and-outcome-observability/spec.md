## ADDED Requirements

### Requirement: Outcome Breakdown Uses Standard Chart Components

The observability surface SHALL render per-channel outcome aggregates with `nuxt-charts` using only the existing redaction-safe counts for `answered`, `refused`, `forbidden`, and `error`. The chart MUST preserve all governed outcome categories in a stable order, MUST support zero-count categories without removing them from the comparison, and MUST NOT request or display raw prompts, raw payloads, or per-request identifiers.

#### Scenario: Admin reviews outcome distribution for a channel

- **WHEN** an authorized Admin opens the latency observability surface and a channel summary includes outcome aggregates
- **THEN** the page SHALL render a `nuxt-charts` categorical chart for that channel's `answered`, `refused`, `forbidden`, and `error` counts
- **AND** the chart SHALL present the four governed outcome categories as a comparison within the same surface

##### Example: zero-count categories stay visible

| Answered | Refused | Forbidden | Error | Expected categories                 |
| -------- | ------- | --------- | ----- | ----------------------------------- |
| 12       | 3       | 0         | 1     | answered, refused, forbidden, error |
| 0        | 0       | 0         | 5     | answered, refused, forbidden, error |

#### Scenario: Outcome chart remains redaction-safe

- **WHEN** the chart is rendered from aggregated query-log data
- **THEN** it SHALL use only aggregate labels and counts
- **AND** it SHALL NOT expose raw query content, raw refusal text, or any record-level identifier in the chart surface
