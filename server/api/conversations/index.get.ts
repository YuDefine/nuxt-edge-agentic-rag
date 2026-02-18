import { useLogger } from 'evlog'
import { z } from 'zod'

import { createConversationStore } from '#server/utils/conversation-store'
import { getD1Database } from '#server/utils/database'

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict()

export default defineEventHandler(async function listConversationsHandler(event) {
  const log = useLogger(event)

  try {
    const session = await requireUserSession(event)

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
