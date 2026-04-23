## ADDED Requirements

### Requirement: Credentials And Member List Endpoints Use Portable ORM Layer

The DB read paths for `GET /api/auth/me/credentials` and `GET /api/admin/members` SHALL use the drizzle query builder (`db.select(...).from(...).where(...)` and related chain methods) for every SQL operation. These endpoints SHALL NOT use the D1-dialect-specific `db.all(sql\`...\`)` tagged-template API, because that API is not supported by the local-dev libsql driver and causes every request to return HTTP 500 in local development.

This requirement SHALL apply to every query the handler issues, including count queries, list queries, aggregation queries, and any per-page lookup queries. The handler SHALL be allowed to use `drizzle-orm` helpers such as `count()`, `eq()`, `and()`, `inArray()`, `max()`, `desc()`, `asc()`, and `groupBy()` because these build portable SQL through the same query builder.

#### Scenario: Credentials endpoint works in local dev

- **WHEN** a developer runs `pnpm dev` locally and an authenticated user requests `GET /api/auth/me/credentials`
- **THEN** the endpoint SHALL respond with HTTP 200
- **AND** the response body SHALL contain `{ data: { email, displayName, hasGoogle, passkeys } }` with values matching the user's better-auth records
- **AND** the handler SHALL NOT throw `TypeError: db.all is not a function` or equivalent driver incompatibility errors

#### Scenario: Admin member list works in local dev

- **WHEN** a developer runs `pnpm dev` locally and an admin requests `GET /api/admin/members`
- **THEN** the endpoint SHALL respond with HTTP 200
- **AND** the response body SHALL contain `{ data: AdminMemberRow[], pagination: { page, pageSize, total } }` with paginated user rows
- **AND** each row SHALL include `displayName`, `credentialTypes`, `registeredAt`, and `lastActivityAt` with the same shape as the production response
- **AND** the handler SHALL NOT throw `TypeError: db.all is not a function` or equivalent driver incompatibility errors

#### Scenario: Production D1 response shape unchanged

- **WHEN** the same endpoints are called against production Cloudflare D1
- **THEN** the response shape, field names, field types, status codes, and error messages SHALL be byte-for-byte identical to the pre-refactor behavior
- **AND** existing integration tests `test/integration/admin-members-list.spec.ts` and `test/integration/admin-members-passkey-columns.spec.ts` (rewritten to mock the drizzle query builder chain) SHALL all pass

#### Scenario: Handler returns 404 when user row missing

- **WHEN** an authenticated session references a `userId` that no longer exists in the `user` table
- **AND** the client requests `GET /api/auth/me/credentials`
- **THEN** the endpoint SHALL respond with HTTP 404
- **AND** the response SHALL NOT leak raw SQL, driver stack, or internal error details
- **AND** the handler SHALL NOT call `log.error` (404 is an expected branch, not a system anomaly)

#### Scenario: Handler returns 500 with friendly message on unexpected DB error

- **WHEN** the drizzle query builder throws an unexpected error (connection failure, schema mismatch, etc.)
- **THEN** the endpoint SHALL respond with HTTP 500
- **AND** the response body SHALL contain a user-facing message such as `暫時無法載入帳號資訊，請稍後再試` (credentials endpoint) or `暫時無法載入會員清單，請稍後再試` (member list endpoint)
- **AND** the handler SHALL call `log.error(error, { step })` exactly once per error path
- **AND** the response SHALL NOT expose the raw SQL, stack trace, or provider-specific error details
