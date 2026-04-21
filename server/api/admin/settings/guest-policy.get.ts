import { useLogger } from 'evlog'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { getGuestPolicy } from '#server/utils/guest-policy'

/**
 * B16 §5.3 — Read the current guest policy.
 *
 * Thin wrapper over `getGuestPolicy`. The read path does all the caching
 * / KV-version-stamp dance; handler stays a no-logic delegate so the
 * admin UI doesn't reimplement the fallback behaviour.
 */
export default defineEventHandler(async function getGuestPolicyHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)
  let value
  try {
    value = await getGuestPolicy(event)
  } catch (error) {
    log.error(error as Error, { step: 'get-guest-policy' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入訪客政策，請稍後再試',
    })
  }

  log.set({
    operation: 'admin-guest-policy-read',
    table: 'system_settings',
    user: { id: session.user.id ?? null },
    result: { value },
  })

  return { data: { value } }
})
