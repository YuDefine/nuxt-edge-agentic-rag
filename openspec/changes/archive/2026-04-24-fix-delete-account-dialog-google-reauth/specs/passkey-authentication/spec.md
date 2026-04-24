## ADDED Requirements

### Requirement: Account Self-Deletion UI Flow Survives Cross-Origin Reauth

The `/account/settings` self-deletion UI SHALL survive a cross-origin reauth redirect without losing flow state. When the user chooses Google reauth from the deletion dialog, the OAuth provider's post-auth redirect SHALL return the user to `/account/settings` (not to `/`), and the deletion dialog SHALL automatically reopen on the reauth-complete step so the user only needs to press the confirm button once they return.

The automatic reopen SHALL be gated on a short-lived client-side signal captured immediately before the OAuth hop, and the signal SHALL expire within the same five-minute reauth window the server enforces. The signal is a UX hint only; the server endpoint for account deletion SHALL NOT trust it as proof of reauth. A failed, missing, or expired signal SHALL leave the user on `/account/settings` with the dialog closed and no skipping of the reauth requirement.

The `?open-delete=1` query parameter used to signal resume SHALL be cleared from the URL as soon as it is read, so that reloads and shared links do not reopen the dialog.

The passkey reauth flow SHALL be unchanged: because it does not leave the origin, the dialog component stays mounted and the existing in-component `reauthComplete` state continues to drive the UI.

#### Scenario: Google reauth completes and dialog resumes on confirm step

- **WHEN** a signed-in user with a linked Google credential opens the deletion dialog on `/account/settings` and chooses Google reauth
- **AND** completes the Google OAuth flow successfully within five minutes
- **THEN** the browser lands on `/account/settings` (not `/`) after the OAuth hop
- **AND** the deletion dialog automatically reopens with its reauth step marked complete, so the confirm button is immediately enabled
- **AND** the URL no longer contains the `open-delete` query parameter

#### Scenario: Direct access to resume URL without a valid signal does not bypass reauth

- **WHEN** any user navigates directly to `/account/settings?open-delete=1` without a recent, valid pending-delete-reauth signal in session storage
- **THEN** the deletion dialog does not automatically open
- **AND** the `open-delete` query parameter is cleared from the URL
- **AND** if the user then manually opens the dialog, they are required to complete a fresh reauth before the confirm button is enabled

#### Scenario: Expired pending-delete-reauth signal is treated as invalid

- **WHEN** the pending-delete-reauth signal exists in session storage but its recorded timestamp is older than five minutes at the time `/account/settings` reads it
- **THEN** the signal is treated as absent
- **AND** the dialog does not automatically open
- **AND** the stale signal is cleared from session storage

#### Scenario: Server reauth enforcement is not weakened

- **WHEN** a request to delete the account is made without a real server-observable reauth in the last five minutes, regardless of any client-side UX state
- **THEN** the server refuses the deletion with HTTP 403 and no rows are deleted
- **AND** the refusal occurs even if the client sent the request immediately after the dialog displayed its confirm step

#### Scenario: Passkey reauth path is not affected

- **WHEN** a signed-in user chooses passkey reauth in the deletion dialog
- **THEN** the WebAuthn ceremony completes in the same origin without a cross-origin redirect
- **AND** the dialog remains mounted throughout, the in-component reauth-complete state flips on success, and no pending-delete-reauth signal is written to session storage
- **AND** the confirm button becomes enabled through the same in-component state machine that existed before this change
