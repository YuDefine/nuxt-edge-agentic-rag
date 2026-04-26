import { useLogger } from 'evlog'
import { z } from 'zod'

import { createConversationStore } from '#server/utils/conversation-store'
import { getD1Database } from '#server/utils/database'
import { requireRole } from '#server/utils/require-role'

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict()

defineRouteMeta({
  openAPI: {
    tags: ['conversations'],
    summary: '列出當前使用者的對話歷史',
    description:
      '回傳目前使用者的對話清單（依最後活動時間排序）。需 member 權限；browse_only / no_access 訪客回 403。',
    parameters: [
      {
        in: 'query',
        name: 'limit',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 200 },
        description: '單次最多回傳筆數，預設由後端決定。',
      },
    ],
    responses: {
      '200': { description: '對話清單（含 id、title、updated_at）。' },
      '401': { description: '未登入。' },
      '403': { description: '訪客政策不允許瀏覽對話。' },
    },
  },
})

export default defineEventHandler(async function listConversationsHandler(event) {
  const log = useLogger(event)

  try {
    // B16 §6.1: Member-level gate. Admin / Member always pass; Guest
    // passes iff `guest_policy === 'same_as_member'`. Browse-only and
    // no-access Guests get a 403 with the user-facing message from
    // `require-role.ts` — the conversation list is not viewable to
    // Guests under those policies.
    //
    // Destructure `fullSession` (= `Awaited<ReturnType<typeof
    // requireUserSession>>`) so downstream stores get the narrow
    // `AuthUser` shape (`id: string`) without a second `requireUserSession`
    // call. Each `requireUserSession` re-invokes `auth.api.getSession`,
    // so avoiding the duplicate saves one session parse per request.
    const { fullSession: session } = await requireRole(event, 'member')

    log.set({
      operation: 'conversations-list',
      table: 'conversations',
      user: { id: session.user.id ?? null },
    })

    const query = await getValidatedQuery(event, querySchema.parse)
    const database = await getD1Database()
    const store = createConversationStore(database)

    const conversations = await store.listForUser({
      userProfileId: session.user.id,
      limit: query.limit,
    })

    return {
      data: conversations,
    }
  } catch (error) {
    if (isHttpError(error)) {
      throw error
    }

    log.error(error as Error, { operation: 'conversations-list' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Failed to list conversations',
    })
  }
})

function isHttpError(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}
