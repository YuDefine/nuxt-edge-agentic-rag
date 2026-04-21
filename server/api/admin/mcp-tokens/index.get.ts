import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { createMcpTokenAdminStore } from '#server/utils/mcp-token-store'
import { paginateList, paginationQuerySchema } from '#shared/schemas/pagination'

const MCP_TOKEN_STATUS_VALUES = ['active', 'revoked', 'expired'] as const

const querySchema = paginationQuerySchema.extend({
  status: z.enum(MCP_TOKEN_STATUS_VALUES).optional(),
})

export default defineEventHandler(async function listMcpTokensHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)

  const query = await getValidatedQuery(event, querySchema.parse)

  log.set({
    operation: 'admin-mcp-tokens-list',
    table: 'mcp_tokens',
    user: { id: session.user.id ?? null },
  })

  const store = createMcpTokenAdminStore()

  try {
    return await paginateList(
      { page: query.page, pageSize: query.pageSize },
      {
        count: () => store.countTokensForAdmin({ status: query.status }),
        list: ({ limit, offset }) =>
          store.listTokensForAdmin({ limit, offset, status: query.status }),
      },
    )
  } catch (error) {
    log.error(error as Error, { step: 'list-mcp-tokens' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入 MCP token 清單，請稍後再試',
    })
  }
})
