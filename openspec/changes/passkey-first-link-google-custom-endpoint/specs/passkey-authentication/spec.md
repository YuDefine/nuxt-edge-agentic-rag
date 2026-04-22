## MODIFIED Requirements

### Requirement: Bidirectional Credential Binding Under Authenticated Session

The system SHALL allow any authenticated user to add a second credential type to their existing `user.id`: a Google-first user SHALL be able to register a passkey via the better-auth `passkey` plugin, and a passkey-first user SHALL be able to link a Google account via the custom endpoint pair `POST /api/auth/account/link-google-for-passkey-first` and `GET /api/auth/account/link-google-for-passkey-first/callback`. The system SHALL NOT auto-merge accounts across different `user.id` values. The system SHALL NOT route passkey-first Google linking through the better-auth `linkSocial` endpoint because better-auth's `parseGenericState` requires `link.email` to be a non-null string and rejects passkey-first users whose `user.email IS NULL`.

#### Scenario: Google-first user adds a passkey

- **WHEN** an authenticated user whose `user.email` is non-NULL and has no `passkey` row completes a WebAuthn registration ceremony at the account settings page
- **THEN** the system inserts a `passkey` row bound to the current `user.id`
- **AND** the user's subsequent logins SHALL succeed via either Google OAuth or passkey

#### Scenario: Passkey-first user binds Google via custom endpoint and email gets populated

- **WHEN** an authenticated user whose `user.email = NULL` clicks the "Link Google account" button at `/account/settings`
- **THEN** the client SHALL redirect to `POST /api/auth/account/link-google-for-passkey-first`
- **AND** that endpoint SHALL issue a one-time OAuth state token, persist it in KV under `oauth-link-state:<token>` with a TTL of 600 seconds and a payload containing the current `session.user.id`, set a `__Host-oauth-link-state` HttpOnly cookie with the same token, and redirect the user agent to the Google authorization URL
- **AND** after the user authorizes Google, the callback `GET /api/auth/account/link-google-for-passkey-first/callback` SHALL verify the cookie matches the `state` query parameter, verify the KV entry exists and its `userId` matches the current `session.user.id`, delete the KV entry, exchange the authorization code for an id_token against `https://oauth2.googleapis.com/token`, verify the id_token `iss` equals `https://accounts.google.com` and `aud` equals the configured Google client id, read `email`, `email_verified`, `name`, and `picture` from the id_token payload, confirm no other `user` row holds the returned email, and atomically UPDATE the current `user` row with `email` and `image` and INSERT a corresponding `account` row with `providerId='google'`, `accountId` equal to the id_token `sub`, and the returned tokens via a single D1 `batch` call
- **AND** on the next session refresh the `session.create.before` reconciliation SHALL evaluate `ADMIN_EMAIL_ALLOWLIST` against the newly populated email
- **AND** if the email is in the allowlist the user SHALL be promoted to `admin` and the transition SHALL be audited with `reason = 'allowlist-seed'`
- **AND** the callback SHALL redirect the user agent to `/account/settings?linked=google`

#### Scenario: Google link is blocked via custom endpoint when the Google email belongs to another user

- **WHEN** an authenticated passkey-first user completes Google authorization and the id_token email already exists as `user.email` on a different `user.id`
- **THEN** the callback SHALL delete the KV state entry, SHALL NOT write any row to `user` or `account`, and SHALL redirect the user agent to `/account/settings?linkError=EMAIL_ALREADY_LINKED`
- **AND** the settings page SHALL render an error toast instructing the user to sign out and log in to the existing Google account before adding a passkey there

#### Scenario: Custom endpoint rejects unauthenticated or already-linked callers

- **WHEN** an unauthenticated caller requests `POST /api/auth/account/link-google-for-passkey-first`
- **THEN** the endpoint SHALL respond with HTTP 401 and SHALL NOT initiate any OAuth flow

- **WHEN** an authenticated caller whose `session.user.email` is non-NULL requests `POST /api/auth/account/link-google-for-passkey-first`
- **THEN** the endpoint SHALL respond with HTTP 400 with `statusMessage = 'INVALID_ENTRY_STATE'` and SHALL NOT initiate any OAuth flow

#### Scenario: Custom endpoint rejects state mismatch or replay

- **WHEN** the callback `GET /api/auth/account/link-google-for-passkey-first/callback` receives a request where the cookie `__Host-oauth-link-state` is absent or does not equal the `state` query parameter
- **THEN** the callback SHALL respond with HTTP 401 with `statusMessage = 'STATE_MISMATCH'` and SHALL NOT exchange any authorization code

- **WHEN** the callback receives a request whose `state` token has no corresponding KV entry (expired or already consumed)
- **THEN** the callback SHALL respond with HTTP 401 with `statusMessage = 'STATE_EXPIRED'` and SHALL NOT exchange any authorization code

- **WHEN** the callback receives a request whose KV entry `userId` does not match the current `session.user.id`
- **THEN** the callback SHALL respond with HTTP 401 with `statusMessage = 'SESSION_MISMATCH'` and SHALL NOT exchange any authorization code

#### Scenario: Custom endpoint rejects unverified Google email

- **WHEN** the callback successfully exchanges the authorization code and the id_token payload has `email_verified !== true`
- **THEN** the callback SHALL respond with HTTP 400 with `statusMessage = 'EMAIL_NOT_VERIFIED'` and SHALL NOT write any row to `user` or `account`
