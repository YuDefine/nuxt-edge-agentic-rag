## ADDED Requirements

### Requirement: Display Name Is Required, Unique, And Immutable

The `user` table SHALL include a `display_name` column of type `TEXT NOT NULL UNIQUE`. Every `user` row SHALL carry a non-empty `display_name`. No application code path SHALL permit updates to `display_name` after the row is created.

#### Scenario: Inserting a user without display_name fails at DB layer

- **WHEN** any code path attempts to insert a `user` row with `display_name = NULL` or `display_name = ''`
- **THEN** the DB SHALL reject the insert with a NOT NULL or CHECK constraint violation

#### Scenario: Application layer rejects display_name updates

- **WHEN** any authenticated caller (including Admin) issues a request that would set `user.display_name` to a different value for an existing row
- **THEN** the server SHALL respond with HTTP 403 and the row SHALL NOT be modified
- **AND** the error body SHALL state that `display_name` is immutable by design

#### Scenario: Two users cannot share the same display_name

- **WHEN** a user attempts to register with a `display_name` that already exists on another `user` row (case-insensitive comparison)
- **THEN** the server SHALL respond with HTTP 409 before starting the WebAuthn registration ceremony

---

### Requirement: Pre-Registration Nickname Availability Check

The system SHALL expose `GET /api/auth/nickname/check?nickname=<value>` that returns the availability of the requested nickname without creating any persistent state. This endpoint SHALL be callable by anonymous visitors. The check SHALL be case-insensitive.

#### Scenario: Available nickname returns available=true

- **WHEN** an anonymous visitor calls `GET /api/auth/nickname/check?nickname=alice` and no `user` row has `LOWER(display_name) = 'alice'`
- **THEN** the response SHALL be HTTP 200 with body `{ available: true }`

#### Scenario: Taken nickname returns available=false

- **WHEN** an anonymous visitor calls `GET /api/auth/nickname/check?nickname=Alice` and a `user` row exists with `LOWER(display_name) = 'alice'`
- **THEN** the response SHALL be HTTP 200 with body `{ available: false }`
- **AND** the response SHALL NOT disclose the existing user's id, email, or role

#### Scenario: Invalid nickname format returns 400

- **WHEN** an anonymous visitor calls the endpoint with an empty, whitespace-only, or over-length nickname
- **THEN** the response SHALL be HTTP 400 with a body identifying the validation failure

---

### Requirement: Existing Users Are Backfilled With Display Name During Migration

The schema migration that introduces `display_name` SHALL backfill every existing `user` row with a non-empty value, preserving UNIQUE without requiring downtime for signed-in users.

#### Scenario: User with existing name field gets display_name copied

- **WHEN** the migration runs on a `user` row where `name` is non-NULL and not already taken as a display_name by another row
- **THEN** `display_name` SHALL be set to that `name` value

#### Scenario: User with NULL name gets a generated display_name

- **WHEN** the migration runs on a `user` row where `name` is NULL or empty
- **THEN** `display_name` SHALL be set to `'user_' || substr(id, 1, 8)` or a longer suffix if that value collides with an existing row

#### Scenario: Collision across users is resolved deterministically

- **WHEN** two users happen to have the same `name` value prior to migration
- **THEN** the first in `createdAt` order SHALL keep that name as `display_name`
- **AND** the later one SHALL be assigned `<name>_<short id>` such that UNIQUE holds
