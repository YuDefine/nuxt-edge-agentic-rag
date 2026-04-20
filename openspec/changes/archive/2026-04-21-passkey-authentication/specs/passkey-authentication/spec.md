## ADDED Requirements

### Requirement: Passkey Plugin Is Gated By Feature Flag

The system SHALL register the better-auth `passkey` plugin on the server if and only if `runtimeConfig.knowledge.features.passkey` is `true`. When the flag is `false`, the server SHALL NOT expose any `/api/auth/passkey/*` endpoint, and the client UI SHALL NOT render passkey-related buttons.

#### Scenario: Server does not register passkey plugin when flag is false

- **WHEN** the server boots with `NUXT_KNOWLEDGE_FEATURE_PASSKEY=false`
- **THEN** `GET /api/auth/passkey/generate-registration-options` SHALL respond with HTTP 404
- **AND** the page at `/` SHALL NOT render any element with `data-testid="passkey-register-button"` or `data-testid="passkey-login-button"`

#### Scenario: Server registers passkey plugin when flag is true

- **WHEN** the server boots with `NUXT_KNOWLEDGE_FEATURE_PASSKEY=true` AND `NUXT_PASSKEY_RP_ID` AND `NUXT_PASSKEY_RP_NAME` are set
- **THEN** `POST /api/auth/passkey/generate-registration-options` SHALL respond with HTTP 200 for authenticated callers and HTTP 200 with a challenge body for unauthenticated passkey-first registration
- **AND** the page at `/` SHALL render the passkey login button when the user is signed out

#### Scenario: Missing RP config fails fast at boot when flag is true

- **WHEN** the server boots with `NUXT_KNOWLEDGE_FEATURE_PASSKEY=true` but `NUXT_PASSKEY_RP_ID` is unset
- **THEN** the server SHALL log a critical startup error identifying the missing env var
- **AND** the server SHALL NOT register the passkey plugin, and `/api/auth/passkey/*` SHALL respond with HTTP 404

---

### Requirement: Passkey-First Registration Creates Guest User Without Email

The system SHALL allow a user with no prior account to register solely via a WebAuthn ceremony preceded by a nickname input. The resulting `user` row SHALL have `email = NULL`, `display_name = <nickname>`, `role = 'guest'`, and one row in the `passkey` table owned by that user id.

#### Scenario: Anonymous user registers via passkey with nickname only

- **WHEN** an anonymous visitor enters a valid unique nickname and completes a WebAuthn registration ceremony at `/`
- **THEN** the system creates a `user` row with `email = NULL`, `display_name` equal to the entered nickname, and `role = 'guest'`
- **AND** the system inserts one `passkey` row referencing that `user.id`
- **AND** the system records a `member_role_changes` row with `from_role = 'guest'`, `to_role = 'guest'`, `changed_by = 'system'`, and `reason = 'passkey-first-registration'`
- **AND** the resulting session contains `user.id` and the UI shows the signed-in state

#### Scenario: Registration with missing nickname is rejected

- **WHEN** an anonymous visitor attempts to initiate the WebAuthn registration ceremony without providing a nickname
- **THEN** the server SHALL respond with HTTP 400 before starting the ceremony
- **AND** the error body SHALL identify `display_name` as the missing field

---

### Requirement: Passkey Authentication Logs Existing User In

The system SHALL allow a user with at least one registered passkey to authenticate by selecting the passkey option at `/` and completing a WebAuthn authentication ceremony. The resulting session SHALL reference the `user.id` bound to the selected credential.

#### Scenario: Returning passkey-only user logs in successfully

- **WHEN** a user whose `user` row has `email = NULL` completes a WebAuthn authentication ceremony on a device holding their registered passkey
- **THEN** the system creates a session for that `user.id`
- **AND** the response SHALL NOT disclose any credential ids the user does not possess

#### Scenario: Authentication with a revoked credential fails

- **WHEN** a user attempts to authenticate with a passkey whose row has been deleted from the `passkey` table
- **THEN** the server SHALL respond with HTTP 401 and the session SHALL NOT be created

---

### Requirement: Bidirectional Credential Binding Under Authenticated Session

The system SHALL allow any authenticated user to add a second credential type to their existing `user.id`: a Google-first user SHALL be able to register a passkey, and a passkey-first user SHALL be able to link a Google account. The system SHALL NOT auto-merge accounts across different `user.id` values.

#### Scenario: Google-first user adds a passkey

- **WHEN** an authenticated user whose `user.email` is non-NULL and has no `passkey` row completes a WebAuthn registration ceremony at the account settings page
- **THEN** the system inserts a `passkey` row bound to the current `user.id`
- **AND** the user's subsequent logins SHALL succeed via either Google OAuth or passkey

#### Scenario: Passkey-first user binds Google and email gets populated

- **WHEN** an authenticated user whose `user.email = NULL` completes a Google OAuth link flow at the account settings page AND the returned Google email is not already present in any other `user` row
- **THEN** the system updates the current `user` row with `email = <google email>`
- **AND** on the next session refresh the `session.create.before` reconciliation SHALL evaluate `ADMIN_EMAIL_ALLOWLIST` against the newly populated email
- **AND** if the email is in the allowlist the user SHALL be promoted to `admin` and the transition SHALL be audited with `reason = 'allowlist-seed'`

#### Scenario: Google link is blocked when the Google email belongs to another user

- **WHEN** an authenticated passkey-first user attempts to link a Google account whose email already exists as `user.email` on a different `user.id`
- **THEN** the server SHALL respond with HTTP 409 and the email SHALL NOT be written to the current `user` row
- **AND** the error body SHALL instruct the caller to sign out and log in to the existing Google account, then add a passkey there

---

### Requirement: Passkey-Only Account Self-Deletion Requires Reauth

The system SHALL provide an authenticated endpoint that deletes the current user's account, and SHALL require a successful WebAuthn authentication ceremony (or Google reauth if the account has a linked Google credential) immediately before committing the deletion. Deletion SHALL cascade across `user`, `user_profiles`, `passkey`, `account`, and `session`, and SHALL leave one final audit row in `member_role_changes` with `reason = 'self-deletion'`.

#### Scenario: Passkey-only user deletes their account after reauth

- **WHEN** an authenticated user whose only credential is a passkey clicks "Delete account" and completes a WebAuthn authentication ceremony
- **THEN** the system deletes their rows from `user`, `user_profiles`, `passkey`, `account`, and `session`
- **AND** the system inserts a final `member_role_changes` row with `from_role = <previous role>`, `to_role = 'guest'`, `changed_by = <user id>`, `reason = 'self-deletion'`
- **AND** the response redirects the client to `/` with no active session

#### Scenario: Deletion without reauth is refused

- **WHEN** a client calls the delete-account endpoint without a fresh (within 5 minutes) reauth ceremony
- **THEN** the server SHALL respond with HTTP 401 and no rows SHALL be deleted

---

### Requirement: RP Configuration Sources From Runtime Env

The WebAuthn Relying Party parameters SHALL derive from runtime environment variables `NUXT_PASSKEY_RP_ID` (rpID) and `NUXT_PASSKEY_RP_NAME` (human-readable name). The `origin` passed to better-auth SHALL be computed per-request from the incoming `Host` header, not hard-coded.

#### Scenario: rpID is read from env at boot

- **WHEN** the server boots with `NUXT_PASSKEY_RP_ID=example.com`
- **THEN** registration options returned by `/api/auth/passkey/generate-registration-options` SHALL contain `rp.id = 'example.com'`

#### Scenario: Per-request origin matches Host header

- **WHEN** a request arrives with `Host: app.example.com`
- **THEN** the origin passed to the WebAuthn verification SHALL be `https://app.example.com` in production OR `http://localhost:<port>` when the host is `localhost`
