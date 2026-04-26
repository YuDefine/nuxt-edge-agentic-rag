import { useLogger } from 'evlog'

import { getD1Database } from '#server/utils/database'
import { createMcpReplayStore } from '#server/utils/mcp-replay'

defineRouteMeta({
  openAPI: {
    tags: ['citations'],
    summary: '依 citationId 回放單一引用內容',
    description:
      '回傳引用的原始 chunk 內容、來源文件 metadata 與版本。需登入；用於 web chat 點擊【引N】卡片時展開、以及離線重現答辯案例。',
    parameters: [
      {
        in: 'path',
        name: 'citationId',
        required: true,
        schema: { type: 'string' },
        description: '對話流程中產生的引用 ID（短碼）。',
      },
    ],
    responses: {
      '200': {
        description: '引用 chunk 全文與來源 metadata（document title、version、category）。',
      },
      '400': { description: '缺少 citationId。' },
      '401': { description: '未登入。' },
      '404': { description: 'citationId 不存在或已超過保留期限。' },
    },
  },
})

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

    const citation = await replayStore.findWebReplayableCitationById(citationId)

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
        documentId: citation.documentId,
        documentTitle: citation.documentTitle,
        isCurrentVersion: citation.isCurrentVersion,
        versionNumber: citation.versionNumber,
        ...(isAdmin
          ? {
              admin: {
                documentVersionId: citation.documentVersionId,
                expiresAt: citation.expiresAt,
                queryLogId: citation.queryLogId,
                sourceChunkId: citation.sourceChunkId,
              },
            }
          : {}),
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
