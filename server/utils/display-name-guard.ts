/**
 * passkey-authentication / nickname-identity-anchor — display_name
 * immutability guard.
 *
 * `user.display_name` is declared as **immutable** in the spec: once a
 * user is created with a display name, the value cannot change for the
 * lifetime of the account. This removes the risk of admin identifying
 * "Alice" today and finding out tomorrow that "Alice" renamed herself
 * to "Bob" — the role (mutable) was bound to an identity anchor
 * (immutable) on purpose.
 *
 * The DB provides no column-level lock (SQLite lacks
 * `ALTER TABLE ... SET IMMUTABLE`). This guard is the **single
 * application-level choke point** that every `UPDATE user SET
 * display_name = ...` path MUST go through before hitting the DB.
 *
 * If you find yourself writing `db.update(schema.user).set({
 * displayName: ... })` without calling this guard first, you have
 * introduced a bug regardless of what PM / design says — the rule is
 * "no path updates display_name" and the code path must not exist.
 *
 * ## Usage
 *
 * ```ts
 * import { assertDisplayNameImmutable } from '#server/utils/display-name-guard'
 *
 * const [existing] = await db
 *   .select({ displayName: schema.user.displayName })
 *   .from(schema.user)
 *   .where(eq(schema.user.id, userId))
 *   .limit(1)
 *
 * assertDisplayNameImmutable(existing?.displayName, body.displayName)
 * // throw 403 if a change is attempted
 * ```
 */

/**
 * Throws 403 if `attemptedValue` differs from `existingValue` (non-null).
 * No-op if `attemptedValue` matches the existing value, or if there is
 * no existing value yet (first insert path).
 *
 * Why 403 (not 400): the caller is authenticated and the input is
 * syntactically valid; what's being rejected is a policy violation
 * ("you are not allowed to change this field, ever"). 403 makes the
 * semantic intent explicit.
 */
export function assertDisplayNameImmutable(
  existingValue: string | null | undefined,
  attemptedValue: string | null | undefined,
): void {
  // First-time insert path — guard is a no-op, migration / insert hook
  // owns the initial write.
  if (!existingValue) return

  // Caller didn't supply a new value — not an update attempt.
  if (attemptedValue === undefined || attemptedValue === null) return

  // Same value (possibly re-submitted on form save) — no-op.
  if (existingValue === attemptedValue) return

  // Case-insensitive match also counts as "same" — users casing
  // differently isn't a real change of identity but it would still
  // confuse admin. Block it explicitly.
  if (existingValue.toLowerCase() === attemptedValue.toLowerCase()) return

  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'display_name is immutable by design — once assigned at registration it cannot change',
  })
}
