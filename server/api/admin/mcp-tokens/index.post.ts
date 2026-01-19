import { z } from 'zod'
import { getRequiredD1Binding } from '../../../utils/cloudflare-bindings'
import { buildProvisionedMcpToken, createMcpTokenStore } from '../../../utils/mcp-token-store'
import { requireRuntimeAdminSession } from '../../../utils/admin-session'

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

  // Require admin access
  await requireRuntimeAdminSession(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  // Validate scopes
  const invalidScopes = body.scopes.filter(
    (s) => !VALID_SCOPES.includes(s as (typeof VALID_SCOPES)[number])
  )
  if (invalidScopes.length > 0) {
    throw createError({
      statusCode: 400,
      message: `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${VALID_SCOPES.join(', ')}`,
    })
  }

  const database = getRequiredD1Binding(event, runtimeConfig.knowledge.bindings.d1Database)
  const tokenStore = createMcpTokenStore(database)

  const environment = runtimeConfig.knowledge.environment ?? 'production'
  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null

  const { plaintextToken, record } = buildProvisionedMcpToken({
    name: body.name,
    scopes: body.scopes,
    environment,
    expiresAt,
  })

  await tokenStore.createToken(record)

  log.set({
    operation: 'mcp_token_create',
    result: { id: record.id, name: record.name, scopes: body.scopes },
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
