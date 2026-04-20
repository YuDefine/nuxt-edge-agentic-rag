import { useLogger } from 'evlog'
import { z } from 'zod'

import { nicknameSchema } from '#shared/schemas/nickname'

/**
 * passkey-authentication / nickname-identity-anchor — real-time nickname
 * availability check.
 *
 * GET /api/auth/nickname/check?nickname=<raw>
 *   → 200 { data: { available: true } }
 *   → 200 { data: { available: false } }
 *   → 400 on invalid format (Zod catches)
 *
 * This endpoint is PUBLIC (no session required) by design — users
 * checking a nickname to pick for passkey-first registration are
 * anonymous. There is no PII leak: an attacker can already enumerate
 * nicknames by attempting to register, so the check endpoint gives the
 * same information faster but doesn't expose anything new.
 *
 * Case-insensitive match via `lower(display_name)` SQL expression so
 * "Alice" and "ALICE" cannot both exist even though the index is on the
 * lowered value. The DB unique index
 * `user_display_name_unique_ci ON "user"(lower(display_name))`
 * provides the final guard when the subsequent register write happens.
 *
 * NOTE: Uses raw SQL (`sql\`\``) on `display_name` because the better-auth
 * drizzle generator names the field `displayName` (JS side) while the
 * migration SQL column is `display_name` (snake_case). See
 * `## Found During Apply` in tasks.md for the schema/migration mismatch
 * follow-up.
 */
const querySchema = z.object({
  nickname: nicknameSchema,
})

export default defineEventHandler(async function checkNicknameHandler(event) {
  const log = useLogger(event)

  const { nickname } = await getValidatedQuery(event, querySchema.parse)

  log.set({
    operation: 'auth-nickname-check',
    table: 'user',
  })

  const { db } = await import('hub:db')
  const { sql } = await import('drizzle-orm')

  // `lower()` on both sides ensures case-insensitive lookup regardless
  // of how the row was originally inserted.
  let rows: Array<{ hit: number }>
  try {
    rows = (await db.all(
      sql`SELECT 1 AS hit FROM "user" WHERE lower(display_name) = lower(${nickname}) LIMIT 1`,
    )) as Array<{ hit: number }>
  } catch (error) {
    log.error(error as Error, { step: 'check-nickname' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法檢查暱稱，請稍後再試',
    })
  }

  const taken = rows.length > 0

  return {
    data: {
      available: !taken,
    },
  }
})
