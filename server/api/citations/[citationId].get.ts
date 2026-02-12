import { useLogger } from 'evlog'

import { getD1Database } from '#server/utils/database'
import { createMcpReplayStore } from '#server/utils/mcp-replay'

export default defineEventHandler(async function getCitationHandler(event) {
  const log = useLogger(event)

  try {
    const session = await requireUserSession(event)
    const citationId = getRouterParam(event, 'citationId')

    if (!citationId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'citationId is required',
      })
    }

    const database = await getD1Database()
    const replayStore = createMcpReplayStore(database)

    const citation = await replayStore.findReplayableCitationById(citationId)

    if (!citation) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: 'The requested citation was not found or has expired',
      })
    }

    const isAdmin = getRuntimeAdminAccess(session.user.email ?? null)
    const allowedAccessLevels = isAdmin ? ['internal', 'restricted'] : ['internal']

    if (!allowedAccessLevels.includes(citation.accessLevel)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: 'You do not have permission to view this citation',
      })
    }

    return {
      data: {
        chunkText: citation.chunkTextSnapshot,
        citationId: citation.citationId,
        citationLocator: citation.citationLocator,
      },
    }
  } catch (error) {
    if (isHttpError(error)) {
      throw error
    }

    log.error(error as Error, { operation: 'web-citation-replay' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Citation replay failed',
    })
  }
})

function isHttpError(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}
