import { useLogger } from 'evlog'
import { z } from 'zod'

import { createConversationStore } from '#server/utils/conversation-store'
import { getD1Database } from '#server/utils/database'
import { requireRole } from '#server/utils/require-role'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export default defineEventHandler(async function listConversationMessagesHandler(event) {
  const log = useLogger(event)

  try {
    // B16 §6.1: Member-level gate. Message content is a Member-and-up
    // surface; Guests under browse_only / no_access see a 403 here
    // rather than an empty list, to match the chat.post.ts contract.
    const { fullSession: session } = await requireRole(event, 'member')
    const params = await getValidatedRouterParams(event, paramsSchema.parse)

    log.set({
      operation: 'conversations-messages-list',
      table: 'messages',
      user: { id: session.user.id ?? null },
      conversationId: params.id,
    })

    const database = await getD1Database()
    const store = createConversationStore(database)

    // Reuse the conversation detail path so the `deleted_at IS NULL` filter
    // and ownership check stay DRY; messages belong to the conversation and
    // MUST disappear alongside it the moment it is soft-deleted.
    const conversation = await store.getForUser({
      conversationId: params.id,
      userProfileId: session.user.id,
    })

    if (!conversation) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '找不到此對話',
      })
    }

    return {
      data: conversation.messages,
    }
  } catch (error) {
    if (isHttpError(error)) {
      throw error
    }

    log.error(error as Error, { operation: 'conversations-messages-list' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Failed to load conversation messages',
    })
  }
})

function isHttpError(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}
