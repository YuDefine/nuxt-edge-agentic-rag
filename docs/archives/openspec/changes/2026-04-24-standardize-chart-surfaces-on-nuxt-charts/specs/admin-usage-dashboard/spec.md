## ADDED Requirements

### Requirement: Usage Timeline Uses Standard Chart Components

The dashboard SHALL render the historical usage timeline with `nuxt-charts` using the existing normalized `timeline` array returned by `GET /api/admin/usage`. The client MUST derive x-axis labels from the returned bucket timestamps for the active `range`, MUST reuse the existing page-level loading, empty, unauthorized, and error states, and MUST NOT trigger any additional analytics request solely to render the chart.

#### Scenario: Admin views usage trend for a populated range

- **WHEN** an admin opens `/admin/usage` and the API returns one or more timeline buckets for the selected range
- **THEN** the dashboard SHALL render a `nuxt-charts` time-series chart for usage history
- **AND** the chart SHALL use labels derived from the returned timestamps rather than a second endpoint or hard-coded labels

##### Example: range-specific labels

| Range   | Bucket timestamp           | Expected label style           |
| ------- | -------------------------- | ------------------------------ |
| `today` | `2026-04-24T08:00:00.000Z` | hourly label such as `08:00`   |
| `7d`    | `2026-04-24T00:00:00.000Z` | calendar label such as `04/24` |
| `30d`   | `2026-04-24T00:00:00.000Z` | calendar label such as `04/24` |

#### Scenario: Empty usage range keeps the existing empty state

- **WHEN** the selected range returns zero requests and an empty `timeline` array
- **THEN** the page SHALL keep the existing empty-state messaging for the dashboard
- **AND** it SHALL NOT render a misleading zero-filled chart in place of that empty state
