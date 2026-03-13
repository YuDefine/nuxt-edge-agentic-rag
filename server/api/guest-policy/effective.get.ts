import { useLogger } from 'evlog'

import { getGuestPolicy } from '#server/utils/guest-policy'

/**
 * B16 §8 — Effective guest policy for any signed-in user.
 *
 * The admin endpoint at `/api/admin/settings/guest-policy` requires admin
 * privileges because it exposes the setting for editing. End-users (Member
 * / Guest) also need to know the *effective* policy so the `GuestAccessGate`
 * composable can branch between `full` / `browse_only` / `no_access` visual
 * states without requiring admin session.
 *
 * This endpoint is intentionally read-only and only reveals the single
 * enum value — it does not expose `updatedAt` / `updatedBy` metadata.
 */
export default defineEventHandler(async function getEffectiveGuestPolicyHandler(event) {
  const log = useLogger(event)

  await requireUserSession(event)
  const value = await getGuestPolicy(event)

  log.set({
    operation: 'guest-policy-effective-read',
    table: 'system_settings',
    result: { value },
  })

  return { data: { value } }
})
