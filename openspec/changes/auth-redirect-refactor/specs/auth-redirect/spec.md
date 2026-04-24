## ADDED Requirements

### Requirement: Login Route Is Independent And Publicly Accessible

The system SHALL expose a dedicated `/login` page that acts as the sole login surface for general web flows. The page SHALL NOT require authentication. The page SHALL host Google OAuth login, Passkey login (when enabled by feature flag), and Passkey registration entry. The home route `/` SHALL NOT render login UI.

#### Scenario: Unauthenticated visitor lands on login page

- **WHEN** an unauthenticated user navigates to `/login`
- **THEN** the page renders with Google login button always visible
- **AND** Passkey buttons render only if `runtimeConfig.public.knowledge.features.passkey === true`
- **AND** the page does not redirect the visitor elsewhere

#### Scenario: Home page does not render login UI

- **WHEN** an unauthenticated user navigates to `/`
- **THEN** the system does not render login controls on `/`
- **AND** the system redirects the user via global middleware

---

### Requirement: Global Auth Middleware Captures Origin Path

The global authentication middleware SHALL redirect unauthenticated users attempting to access pages with `meta.auth !== false` to `/login`. When the origin path is not `/`, the middleware SHALL append a `redirect` query parameter containing the URL-encoded `to.fullPath`. The middleware SHALL NOT append a `redirect` query parameter when the origin path is `/` itself. The middleware SHALL NOT redirect when the origin path is already `/login` to prevent redirect loops.

#### Scenario: Unauthenticated access to admin page captures redirect

- **WHEN** an unauthenticated user navigates to `/admin/documents`
- **THEN** the middleware redirects to `/login?redirect=%2Fadmin%2Fdocuments`

#### Scenario: Unauthenticated access to root does not append redirect

- **WHEN** an unauthenticated user navigates to `/`
- **THEN** the middleware redirects to `/login` without any query parameters

#### Scenario: Unauthenticated access to login page does not loop

- **WHEN** an unauthenticated user navigates directly to `/login`
- **THEN** the middleware does not redirect
- **AND** the login page renders normally

#### Scenario: Public pages with auth false are not intercepted

- **WHEN** an unauthenticated user navigates to a page with `definePageMeta({ auth: false })`
- **THEN** the middleware does not redirect
- **AND** the page renders normally

##### Example: encoded redirect paths

| Origin path             | Resulting login URL                             |
| ----------------------- | ----------------------------------------------- |
| `/admin/documents`      | `/login?redirect=%2Fadmin%2Fdocuments`          |
| `/account/settings`     | `/login?redirect=%2Faccount%2Fsettings`         |
| `/admin/usage?filter=x` | `/login?redirect=%2Fadmin%2Fusage%3Ffilter%3Dx` |
| `/`                     | `/login`                                        |
| `/login`                | (no redirect)                                   |

---

### Requirement: Admin Middleware Unauthenticated Branch Mirrors Global Behavior

When `admin.ts` middleware detects an unauthenticated user, the middleware SHALL redirect to `/login?redirect=<fullPath>` using the same URL composition rules as the global middleware. The unauthorized branch (user is authenticated but lacks admin role) SHALL remain unchanged and is outside the scope of this capability.

#### Scenario: Unauthenticated user hitting admin page gets redirect

- **WHEN** an unauthenticated user navigates to any page protected by `admin` middleware
- **THEN** the middleware redirects to `/login?redirect=<encoded fullPath>`
- **AND** the behavior matches the global middleware for non-admin pages

---

### Requirement: Safe Redirect Validator Blocks Open-Redirect Payloads

The system SHALL provide a `parseSafeRedirect(raw: unknown): string | null` utility. The function SHALL return the input string only when all of the following conditions hold: the input is a non-empty string of at most 2048 characters, starts with `/`, does not start with `//`, and does not match the pattern `^[a-z]+:`. When any condition fails, the function SHALL return `null`. Call sites SHALL treat a `null` return as a fallback signal and navigate to `/` instead.

#### Scenario: Safe relative paths pass validation

- **WHEN** `parseSafeRedirect('/admin/documents')` is called
- **THEN** the function returns `'/admin/documents'`

#### Scenario: Protocol-relative URL is rejected

- **WHEN** `parseSafeRedirect('//evil.com/phish')` is called
- **THEN** the function returns `null`

##### Example: validator truth table

| Input                           | Output                          | Reason                   |
| ------------------------------- | ------------------------------- | ------------------------ |
| `/admin/documents`              | `/admin/documents`              | valid same-origin path   |
| `/account/settings?tab=profile` | `/account/settings?tab=profile` | valid with query         |
| `/`                             | `/`                             | valid root               |
| `//evil.com`                    | `null`                          | protocol-relative        |
| `//evil.com/phish`              | `null`                          | protocol-relative        |
| `http://evil.com`               | `null`                          | absolute URL with scheme |
| `https://evil.com`              | `null`                          | absolute URL with scheme |
| `javascript:alert(1)`           | `null`                          | javascript: scheme       |
| `data:text/html,...`            | `null`                          | data: scheme             |
| `admin/documents`               | `null`                          | missing leading slash    |
| `""`                            | `null`                          | empty string             |
| `null`                          | `null`                          | non-string input         |
| `undefined`                     | `null`                          | non-string input         |
| `"/" + "x".repeat(2048)`        | `null`                          | exceeds 2048 char limit  |

---

### Requirement: Generic Return-To Storage Handles Cross-Domain OAuth

The system SHALL provide `saveGenericReturnTo(path: string): void`, `consumeGenericReturnTo(): string | null`, `peekGenericReturnTo(): string | null`, and `clearGenericReturnTo(): void` helpers backed by `sessionStorage` under a dedicated key. The key SHALL be distinct from the MCP connector return-to key. `consumeGenericReturnTo` SHALL be destructive: after reading a non-null value, the stored value SHALL be cleared. All helpers SHALL be no-ops when `import.meta.client` is false.

#### Scenario: Google OAuth login preserves origin path

- **WHEN** an unauthenticated user clicks "Login with Google" on `/login?redirect=/admin/documents`
- **AND** before the OAuth redirect the page calls `saveGenericReturnTo('/admin/documents')`
- **AND** Google returns the user to `/auth/callback`
- **THEN** the callback page reads `consumeGenericReturnTo()` and receives `'/admin/documents'`
- **AND** subsequent reads of `peekGenericReturnTo()` return `null`

#### Scenario: Server-side calls are no-ops

- **WHEN** `saveGenericReturnTo('/anything')` is invoked during SSR
- **THEN** the function does nothing and does not throw

---

### Requirement: Callback Page Consumes Return-To In Priority Order

The `/auth/callback` page SHALL, after confirming the session is valid, consume return-to values in the following priority order:

1. `consumeMcpConnectorReturnTo()` — if non-null, navigate to that path and stop.
2. `consumeGenericReturnTo()` — if non-null, validate via `parseSafeRedirect`; navigate to the validated path (or `/` if validation fails) and stop.
3. Otherwise, remain on the default post-login path (no navigation beyond the page's own behavior).

The MCP consume MUST occur first to preserve the existing connector double-handshake flow.

#### Scenario: MCP connector flow wins over generic redirect

- **WHEN** both `mcp-connector:return-to` and `auth:return-to` sessionStorage keys are set
- **AND** the callback page executes its consume sequence
- **THEN** the page navigates to the MCP path
- **AND** the generic key is NOT consumed during this navigation

#### Scenario: Generic redirect is validated before navigation

- **WHEN** only the generic return-to key is set with value `'//evil.com'`
- **AND** the callback page executes its consume sequence
- **THEN** `parseSafeRedirect` returns `null`
- **AND** the page falls back to `/` rather than following the unsafe path

---

### Requirement: Passkey Same-Origin Flow Reads Redirect From Query

On `/login`, when Passkey authentication succeeds (no cross-domain hop occurs), the page SHALL read `route.query.redirect`, validate via `parseSafeRedirect`, and navigate with `{ replace: true }` to the validated path or `/` when validation returns `null`. The page SHALL NOT write the redirect value to `sessionStorage` during Passkey flow.

#### Scenario: Passkey login honors query redirect

- **WHEN** a user completes Passkey login on `/login?redirect=/account/settings`
- **THEN** the page navigates to `/account/settings` with `replace: true`

#### Scenario: Passkey login with unsafe redirect falls back

- **WHEN** a user completes Passkey login on `/login?redirect=//evil.com`
- **THEN** the page navigates to `/` with `replace: true`
