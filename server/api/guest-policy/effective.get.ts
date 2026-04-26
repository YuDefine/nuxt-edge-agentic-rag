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
defineRouteMeta({
  openAPI: {
    tags: ['guest-policy'],
    summary: '取得當前生效的訪客政策',
    description:
      '回傳 same_as_member / browse_only / no_access 三選一 enum。任何已登入使用者皆可呼叫，UI 用此值決定 GuestAccessGate 的視覺與互動狀態。Admin 編輯端點為 /api/admin/settings/guest-policy。',
    responses: {
      '200': {
        description: '回傳 { data: { value: "same_as_member" | "browse_only" | "no_access" } }。',
      },
      '401': { description: '未登入。' },
      '500': { description: '系統設定讀取失敗。' },
    },
  },
})

export default defineEventHandler(async function getEffectiveGuestPolicyHandler(event) {
  const log = useLogger(event)

  await requireUserSession(event)
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
    operation: 'guest-policy-effective-read',
    table: 'system_settings',
    result: { value },
  })

  return { data: { value } }
})
