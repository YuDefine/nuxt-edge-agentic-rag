import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { setGuestPolicy } from '#server/utils/guest-policy'
import { guestPolicySchema } from '#shared/types/auth'

/**
 * B16 §5.4 — Write a new guest policy.
 *
 * The handler validates the body against `guestPolicySchema` (re-used from
 * `shared/types/auth`) before delegating to `setGuestPolicy`, which
 * handles the D1 write + KV version stamp invalidation in the correct
 * order (D1 first, KV second — see helper module for rationale).
 */

const bodySchema = z.object({
  value: guestPolicySchema,
})

export default defineEventHandler(async function patchGuestPolicyHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  log.set({
    operation: 'admin-guest-policy-update',
    table: 'system_settings',
    user: { id: session.user.id ?? null },
    result: { value: body.value },
  })

  try {
    await setGuestPolicy(event, {
      value: body.value,
      changedBy: session.user.id ?? 'unknown-admin',
    })
  } catch (error) {
    log.error(error as Error, { step: 'set-guest-policy' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法更新訪客政策，請稍後再試',
    })
  }

  return { data: { value: body.value } }
})
