import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { createMcpTokenAdminStore } from '#server/utils/mcp-token-store'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async function revokeMcpTokenHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, paramsSchema.parse)

  log.set({
    operation: 'admin-mcp-tokens-revoke',
    table: 'mcp_tokens',
    tokenId: params.id,
    user: { id: session.user.id ?? null },
  })

  const store = createMcpTokenAdminStore()

  const result = await store.revokeTokenById(params.id)

  switch (result.outcome) {
    case 'not-found':
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '找不到此 MCP token',
      })
    case 'revoked':
      return {
        data: {
          alreadyRevoked: false,
          id: result.token.id,
          revokedAt: result.token.revokedAt,
          status: result.token.status,
        },
      }
    case 'already-revoked':
      return {
        data: {
          alreadyRevoked: true,
          id: result.token.id,
          revokedAt: result.token.revokedAt,
          status: result.token.status,
        },
      }
  }
})
