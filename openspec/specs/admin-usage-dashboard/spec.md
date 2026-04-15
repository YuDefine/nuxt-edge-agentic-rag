# admin-usage-dashboard Specification

## Purpose

TBD - created by archiving change 'add-ai-gateway-usage-tracking'. Update Purpose after archive.

## Requirements

### Requirement: Admin Usage Dashboard Page

The system SHALL provide an admin-only page at `/admin/usage` that displays current and historical AI Gateway usage metrics for the configured production gateway. The page MUST be reachable from the admin navigation, MUST NOT be reachable for users whose session email is not in `ADMIN_EMAIL_ALLOWLIST`, and MUST present an unauthorized state when a non-admin attempts access.

#### Scenario: Admin reaches dashboard from navigation

- **WHEN** an admin user opens the admin layout
- **THEN** the navigation SHALL show a "Usage" entry that links to `/admin/usage`
- **AND** clicking it SHALL load the dashboard page

#### Scenario: Non-admin user blocked

- **WHEN** an authenticated non-admin user navigates directly to `/admin/usage`
- **THEN** the system SHALL respond with a 403 server-side check and the page SHALL render an unauthorized state without leaking usage data

#### Scenario: Unauthenticated user redirected

- **WHEN** an unauthenticated visitor navigates to `/admin/usage`
- **THEN** the system SHALL redirect to the login flow consistent with other admin routes

---
### Requirement: Admin Usage Endpoint Aggregates Server-Side

The system SHALL expose a `GET /api/admin/usage` endpoint that accepts a `range` query parameter with allowed values `today`, `7d`, `30d` (default `today`), invokes the Cloudflare Analytics API server-side using the `CLOUDFLARE_API_TOKEN_ANALYTICS` secret and `CLOUDFLARE_ACCOUNT_ID`, aggregates the results, and returns a normalized JSON shape `{ data: { tokens: { input, output, total }, neurons: { used, freeQuotaPerDay, remaining }, requests: { total, cached, cacheHitRate }, timeline: Array<{ timestamp, tokens, requests, cacheHits }>, lastUpdatedAt } }`. The endpoint MUST require admin authority via `ADMIN_EMAIL_ALLOWLIST` re-check, MUST NOT expose the Analytics API token to the client, MUST NOT return raw upstream response bodies, and MUST validate the `range` parameter via Zod.

#### Scenario: Admin requests today's usage

- **WHEN** an admin sends `GET /api/admin/usage?range=today`
- **THEN** the response status SHALL be 200 and the body SHALL match the normalized shape
- **AND** `data.neurons.freeQuotaPerDay` SHALL equal `10000`

#### Scenario: Non-admin gets 403

- **WHEN** an authenticated non-admin sends `GET /api/admin/usage`
- **THEN** the response status SHALL be 403 and no upstream call SHALL be made

#### Scenario: Invalid range rejected

- **WHEN** the request includes `range=foo`
- **THEN** the response status SHALL be 400 with a Zod validation error message and no upstream call SHALL be made

#### Scenario: Upstream Analytics API failure

- **WHEN** the Cloudflare Analytics API returns a non-success status
- **THEN** the endpoint SHALL respond with a 503 status and a user-friendly message
- **AND** the original upstream error MUST NOT appear in the response body
- **AND** the failure MUST be logged via `evlog` at `error` level

---
### Requirement: Dashboard Free-Quota Visualization

The dashboard SHALL display a progress indicator for the daily Workers AI free quota (10,000 Neurons per day). The indicator MUST show the consumed amount, the remaining amount, and a percentage. When consumption reaches or exceeds 80 percent of the daily quota, the indicator MUST visually signal a warning (color or icon change) so the admin can react before the quota is exhausted.

#### Scenario: Below warning threshold

- **WHEN** today's Neurons consumption is 5000 (50 percent)
- **THEN** the progress indicator SHALL show 50 percent in the default color and no warning visual

#### Scenario: At warning threshold

- **WHEN** today's Neurons consumption reaches 8000 (80 percent)
- **THEN** the progress indicator SHALL switch to the warning color and SHALL display a textual hint

#### Scenario: Quota exhausted

- **WHEN** today's Neurons consumption reaches 10000 (100 percent)
- **THEN** the progress indicator SHALL show "quota exhausted" state visually and the remaining value SHALL display `0`

---
### Requirement: Dashboard Auto Refresh And Manual Refetch

The dashboard SHALL automatically refetch usage data every 60 seconds while the page is visible, SHALL stop polling when the page is hidden, and SHALL provide a manual refresh control that triggers an immediate refetch bypassing client-side stale-time. The dashboard MUST display a "last updated" relative timestamp so the admin understands the data freshness, because the upstream Cloudflare Analytics API has a 1-2 minute ingestion delay.

#### Scenario: Auto refresh while visible

- **WHEN** the admin keeps `/admin/usage` open and the page is visible for over 60 seconds
- **THEN** the system SHALL re-invoke `GET /api/admin/usage` and update the displayed values

#### Scenario: Manual refresh button

- **WHEN** the admin clicks the "Refresh" button
- **THEN** the system SHALL trigger an immediate refetch via Pinia Colada `refetch()` regardless of stale-time

#### Scenario: Last updated timestamp visible

- **WHEN** usage data has been loaded
- **THEN** the page SHALL show a "Last updated: N seconds ago" indicator that updates as time passes

---
### Requirement: Dashboard Empty And Error States

The dashboard SHALL render four distinct UI states: loading (initial fetch in progress), success (data displayed), empty (gateway exists but no usage logs in the requested range), and error (upstream failure or network error). Each state MUST provide an actionable affordance: loading shows a skeleton, empty explains that no AI calls were made in the range and offers a range switcher, error shows a retry button.

#### Scenario: Initial loading

- **WHEN** the page is first opened and the API call is in flight
- **THEN** the dashboard SHALL render skeleton placeholders for each metric card

#### Scenario: Empty range

- **WHEN** the API returns zero requests for the selected range
- **THEN** the dashboard SHALL show an empty state explaining no calls happened and SHALL offer a range switcher to try a longer window

#### Scenario: Upstream error displays retry

- **WHEN** the endpoint responds with 503
- **THEN** the dashboard SHALL display an error state with a "Retry" button that triggers `refetch()`
