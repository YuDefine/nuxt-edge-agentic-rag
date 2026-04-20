import { z } from 'zod'

/**
 * passkey-authentication / nickname-identity-anchor.
 *
 * Shared Zod schema for `user.display_name` validation. Used by:
 *
 *   - Client NicknameInput component (real-time format feedback)
 *   - Server `/api/auth/nickname/check` (availability endpoint)
 *   - Server passkey-first registration hook (final guard)
 *
 * Format rules:
 *
 *   - Trimmed on input (no leading/trailing whitespace)
 *   - 2..32 characters (DB column is `TEXT NOT NULL`, length is an
 *     application-level contract)
 *   - Allows Unicode letters (`\p{L}`), numbers (`\p{N}`), underscore,
 *     hyphen, and internal spaces. Rejects punctuation / emoji / control
 *     chars so admin can identify users by display name without encoding
 *     weirdness in the UI.
 *   - Case-insensitive uniqueness is enforced at the DB layer
 *     (`CREATE UNIQUE INDEX user_display_name_unique_ci ON "user"(lower(display_name))`).
 *
 * Immutability: Enforced application-side by
 * `server/utils/display-name-guard.ts`. DB does not provide a column-level
 * lock; the guard is the single choke point before `UPDATE user SET
 * display_name = ...` is allowed to run.
 */
export const NICKNAME_MIN_LENGTH = 2
export const NICKNAME_MAX_LENGTH = 32

/**
 * Unicode-aware allow-list for nickname characters.
 *
 * - `\p{L}` — any Unicode letter (Latin, CJK, etc.)
 * - `\p{N}` — any Unicode number
 * - `_`, `-`, space — the only punctuation permitted
 *
 * Rejects: emoji, control chars, zero-width joiners, most symbols.
 */
export const NICKNAME_ALLOWED_PATTERN = /^[\p{L}\p{N}_\-\s]+$/u

export const nicknameSchema = z
  .string()
  .trim()
  .min(NICKNAME_MIN_LENGTH, `暱稱至少需要 ${NICKNAME_MIN_LENGTH} 個字`)
  .max(NICKNAME_MAX_LENGTH, `暱稱不可超過 ${NICKNAME_MAX_LENGTH} 個字`)
  .regex(NICKNAME_ALLOWED_PATTERN, '暱稱只能包含中英文字、數字、底線、連字號與空白')

export type Nickname = z.infer<typeof nicknameSchema>

/**
 * Normalise a nickname for case-insensitive comparison. Used by both
 * the availability endpoint and the passkey-first registration hook
 * so "Alice" / "alice" / "ALICE" collapse to the same key.
 */
export function normaliseNicknameForCompare(raw: string): string {
  return raw.trim().toLowerCase()
}
