import { useLogger } from 'evlog'
import { z } from 'zod'

import { createConversationStore } from '#server/utils/conversation-store'
import { getD1Database } from '#server/utils/database'
import { requireRole } from '#server/utils/require-role'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export default defineEventHandler(async function getConversationHandler(event) {
  const log = useLogger(event)

  try {
    // B16 §6.1: Member-level gate (see conversations/index.get.ts for
    // the full rationale). `fullSession` carries the full better-auth
    // session so downstream store calls keep their `string` id invariant
    // without a second `requireUserSession` roundtrip.
    const { fullSession: session } = await requireRole(event, 'member')
    const params = await getValidatedRouterParams(event, paramsSchema.parse)

    log.set({
      operation: 'conversations-detail',
      table: 'conversations',
      user: { id: session.user.id ?? null },
      conversationId: params.id,
    })

    const database = await getD1Database()
    const store = createConversationStore(database)

    const conversation = await store.getForUser({
      conversationId: params.id,
      userProfileId: session.user.id,
    })

    if (!conversation) {
      // Either the conversation does not exist, is owned by someone else, or
      // has been soft-deleted. Collapsing the three cases into 404 avoids
      // leaking ownership information.
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '找不到此對話',
      })
    }

    return {
      data: conversation,
    }
  } catch (error) {
    if (isHttpError(error)) {
      throw error
    }

    log.error(error as Error, { operation: 'conversations-detail' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Failed to load conversation',
    })
  }
})

function isHttpError(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}
