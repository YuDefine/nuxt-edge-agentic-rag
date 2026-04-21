import { useLogger } from 'evlog'

import { getDrizzleDb } from '#server/utils/database'

/**
 * passkey-authentication — Logged-in user's credential summary.
 *
 * GET /api/auth/me/credentials
 *   → 200 { data: { email, displayName, hasGoogle, passkeys } }
 *
 * Consumed by `/account/settings` to render:
 *   - Personal info section (email, display_name immutable)
 *   - Passkey list (name, createdAt, revoke button)
 *   - "Link Google" section (visible only when email IS NULL)
 *
 * Authorisation: session-only — every logged-in user may read their
 * own credentials. No admin gate (admins see OTHER users' credential
 * types via `/admin/members`, not their raw passkey list).
 */

interface PasskeySummary {
  id: string
  name: string | null
  deviceType: string
  backedUp: boolean
  createdAt: string | null
}

export default defineEventHandler(async function meCredentialsHandler(event) {
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
    operation: 'auth-me-credentials',
    table: 'user',
    user: { id: userId },
  })

  const { db, schema } = await getDrizzleDb()
  const { eq, and } = await import('drizzle-orm')

  // TD-010 (2026-04-21): all DB reads go through the drizzle query
  // builder so the handler works on both production D1 and local-dev
  // libsql. The previous version used `db.all(sql\`...\`)` for the user
  // row, which is a D1-dialect-specific API that throws on libsql. See
  // `server/utils/mcp-token-store.ts` for the canonical pattern (TD-001).
  //
  // `schema.user.displayName.fieldName = 'display_name'` (FD-001) aligns
  // the drizzle column binding to the snake_case migration column, so
  // the query emits `SELECT display_name` without a COALESCE fallback.
  //
  // All DB calls are wrapped in try/catch so raw SQL / stack never leaks
  // to the client response body (see `.claude/rules/error-handling.md`).
  let userRow: { email: string | null; displayName: string | null } | undefined
  let hasGoogle = false
  let passkeyRows: Array<{
    id: string
    name: string | null
    deviceType: string
    backedUp: boolean
    createdAt: Date | null
  }> = []

  try {
    const userRows = await db
      .select({
        email: schema.user.email,
        displayName: schema.user.display_name,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1)
    userRow = userRows[0]
  } catch (error) {
    log.error(error as Error, { step: 'fetch-user-row' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入帳號資訊，請稍後再試',
    })
  }

  if (!userRow) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: '找不到此帳號',
    })
  }

  try {
    const [googleAccounts, fetchedPasskeys] = await Promise.all([
      db
        .select({ id: schema.account.id })
        .from(schema.account)
        .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'google')))
        .limit(1),
      db
        .select({
          id: schema.passkey.id,
          name: schema.passkey.name,
          deviceType: schema.passkey.deviceType,
          backedUp: schema.passkey.backedUp,
          createdAt: schema.passkey.createdAt,
        })
        .from(schema.passkey)
        .where(eq(schema.passkey.userId, userId)),
    ])
    hasGoogle = googleAccounts.length > 0
    passkeyRows = fetchedPasskeys
  } catch (error) {
    log.error(error as Error, { step: 'fetch-credentials' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入帳號資訊，請稍後再試',
    })
  }

  const passkeys: PasskeySummary[] = passkeyRows.map((row) => ({
    id: row.id,
    name: row.name ?? null,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
  }))

  return {
    data: {
      email: userRow.email,
      displayName: userRow.displayName,
      hasGoogle,
      passkeys,
    },
  }
})
