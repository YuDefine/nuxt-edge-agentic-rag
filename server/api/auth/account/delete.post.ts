import { useLogger } from 'evlog'
import { eq } from 'drizzle-orm'

import { recordRoleChange, ROLE_CHANGE_SYSTEM_ACTOR } from '#server/utils/member-role-changes'
import { normaliseRole } from '#shared/types/auth'

/**
 * passkey-authentication / Decision 6 — Passkey-only account self-deletion.
 *
 * POST /api/auth/account/delete
 *
 * Flow:
 *   1. Require an authenticated session.
 *   2. Require the session to be "fresh" — created within the last 5
 *      minutes. This is the reauth guarantee: the UI flow asks the user
 *      to walk through a passkey / Google ceremony immediately before
 *      invoking this endpoint, which in better-auth produces a fresh
 *      session row.
 *   3. Write a final audit row to `member_role_changes` with
 *      `reason = 'self-deletion'` BEFORE deleting anything — this row
 *      outlives the user (history table retains the reference) and gives
 *      compliance a tamper-evident trail.
 *   4. Delete `user_profiles` (no cascade from `user` — the table is
 *      application-owned with FK references).
 *   5. Delete the `user` row. Migration 0009 set up `ON DELETE CASCADE`
 *      on `account`, `session`, `passkey`, so those rows evaporate
 *      automatically. `member_role_changes.user_id` has no cascade
 *      (audit preservation), so the rows including the final audit
 *      survive as orphan references to the now-gone userId.
 *
 * 403 is returned when the session is older than 5 minutes — the UI
 * should catch this and re-prompt for reauth.
 */

const REAUTH_WINDOW_MS = 5 * 60 * 1000

export default defineEventHandler(async function deleteAccountHandler(event) {
  const log = useLogger(event)

  const session = await requireUserSession(event)

  const userId = session.user.id
  if (!userId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: '未登入',
    })
  }

  log.set({
    operation: 'auth-account-self-delete',
    table: 'user',
    user: { id: userId },
  })

  // Reauth check — the CURRENT session (the one carrying this request)
  // must have been minted within `REAUTH_WINDOW_MS`. The UI flow asks the
  // user to complete a passkey / Google ceremony immediately before this
  // endpoint, which rotates `session.token` + resets `createdAt`.
  //
  // `session.session.createdAt` comes from better-auth's session store
  // (primary DB or KV secondary storage) and is already hydrated on the
  // event — no secondary DB lookup needed and no dependency on whether
  // the `session` SQL table is populated (with `secondaryStorage: true`,
  // sessions may live in KV only).
  const sessionCreatedAt = session.session?.createdAt
  const sessionAgeMs = (() => {
    if (!sessionCreatedAt) return Number.POSITIVE_INFINITY
    const asNumber =
      sessionCreatedAt instanceof Date
        ? sessionCreatedAt.getTime()
        : typeof sessionCreatedAt === 'number'
          ? sessionCreatedAt
          : new Date(sessionCreatedAt).getTime()
    if (!Number.isFinite(asNumber)) return Number.POSITIVE_INFINITY
    return Date.now() - asNumber
  })()

  if (sessionAgeMs > REAUTH_WINDOW_MS) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '刪除帳號需要在 5 分鐘內完成認證，請重新以 passkey 或 Google 登入後再試',
    })
  }

  const { db, schema } = await import('hub:db')

  // Fetch current role for the audit row.
  let existingUser
  try {
    ;[existingUser] = await db
      .select({ role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1)
  } catch (error) {
    log.error(error as Error, { step: 'fetch-user-role' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入帳號資訊，請稍後再試',
    })
  }

  if (!existingUser) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: '找不到此帳號',
    })
  }

  const currentRole = normaliseRole(existingUser.role)

  // Write the final audit row FIRST — if the following delete fails, we
  // still have a record of intent. If the audit write fails, we bail
  // before touching any user data.
  try {
    await recordRoleChange(
      { db, schema },
      {
        userId,
        fromRole: currentRole,
        toRole: currentRole,
        changedBy: ROLE_CHANGE_SYSTEM_ACTOR,
        reason: 'self-deletion',
      },
    )
  } catch (error) {
    log.error(error as Error, { step: 'audit-self-deletion' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '無法寫入刪除紀錄，請稍後再試',
    })
  }

  // Delete user_profiles manually (no cascade from user).
  try {
    await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, userId))
  } catch (error) {
    log.error(error as Error, { step: 'delete-user-profiles' })
    // Continue — user row delete is the source of truth.
  }

  // Delete user row; account / session / passkey cascade away.
  try {
    await db.delete(schema.user).where(eq(schema.user.id, userId))
  } catch (error) {
    log.error(error as Error, { step: 'delete-user' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '無法刪除帳號，請稍後再試',
    })
  }

  log.set({ result: { deletedUserId: userId } })

  return {
    data: {
      deleted: true,
    },
  }
})
