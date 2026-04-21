import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { buildProvisionedMcpToken, createMcpTokenStore } from '#server/utils/mcp-token-store'

const bodySchema = z.object({
  name: z.string().min(1, 'Token name is required'),
  scopes: z.array(z.string()).min(1, 'At least one scope is required'),
  expiresInDays: z.number().int().positive().optional(),
})

const VALID_SCOPES = [
  'knowledge.search',
  'knowledge.ask',
  'knowledge.citation.read',
  'knowledge.category.list',
  'knowledge.restricted.read',
] as const

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const runtimeConfig = useRuntimeConfig()

  const session = await requireRuntimeAdminSession(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  // Validate scopes
  const invalidScopes = body.scopes.filter(
    (s) => !VALID_SCOPES.includes(s as (typeof VALID_SCOPES)[number]),
  )
  if (invalidScopes.length > 0) {
    throw createError({
      statusCode: 400,
      message: `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${VALID_SCOPES.join(', ')}`,
    })
  }

  const tokenStore = createMcpTokenStore()

  const environment = runtimeConfig.knowledge.environment ?? 'production'
  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null

  const { plaintextToken, record } = buildProvisionedMcpToken({
    createdByUserId: session.user.id,
    environment,
    expiresAt,
    name: body.name,
    scopes: body.scopes,
  })

  try {
    await tokenStore.createToken(record)
  } catch (error) {
    log.error(error as Error, { step: 'create-mcp-token' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法建立 MCP token，請稍後再試',
    })
  }

  log.set({
    operation: 'mcp_token_create',
    result: { id: record.id, name: record.name, scopes: body.scopes },
    table: 'mcp_tokens',
    user: { id: session.user.id ?? null },
  })

  return {
    id: record.id,
    name: record.name,
    scopes: body.scopes,
    environment,
    expiresAt,
    createdAt: record.createdAt,
    // Only return the plaintext token once at creation
    token: plaintextToken,
  }
})
