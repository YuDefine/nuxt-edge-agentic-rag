import { useLogger } from 'evlog'
import { z } from 'zod'

import { createConversationStore } from '#server/utils/conversation-store'
import { getD1Database } from '#server/utils/database'
import { requireRole } from '#server/utils/require-role'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export default defineEventHandler(async function deleteConversationHandler(event) {
  const log = useLogger(event)

  try {
    // B16 §6.1: Member-level gate. Guest × browse_only / no_access →
    // 403 before the soft-delete runs; we do not want Guests evicting
    // conversations they can no longer see.
    const { fullSession: session } = await requireRole(event, 'member')
    const params = await getValidatedRouterParams(event, paramsSchema.parse)

    log.set({
      operation: 'conversations-delete',
      table: 'conversations',
      user: { id: session.user.id ?? null },
      conversationId: params.id,
    })

    const database = await getD1Database()
    const store = createConversationStore(database)

    const result = await store.softDeleteForUser({
      conversationId: params.id,
      userProfileId: session.user.id,
    })

    if (!result) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '找不到此對話',
      })
    }

    log.set({
      result: {
        conversationId: result.conversationId,
        alreadyDeleted: result.alreadyDeleted,
      },
    })

    return {
      data: {
        conversationId: result.conversationId,
        deletedAt: result.deletedAt,
        alreadyDeleted: result.alreadyDeleted,
      },
    }
  } catch (error) {
    if (isHttpError(error)) {
      throw error
    }

    log.error(error as Error, { operation: 'conversations-delete' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Failed to delete conversation',
    })
  }
})

function isHttpError(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}
