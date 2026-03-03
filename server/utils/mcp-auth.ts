import { createHash } from 'node:crypto'

import type { McpTokenRecord } from '#shared/types/knowledge'
import { parseStringArrayJson } from '#shared/utils/parse-string-array'

export class McpAuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'McpAuthError'
  }
}

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function requireMcpBearerToken(
  event: {
    headers: Record<string, string | undefined>
  },
  options: {
    environment: string
    store: {
      findUsableTokenByHash(tokenHash: string, environment: string): Promise<McpTokenRecord | null>
      touchLastUsedAt(tokenId: string, usedAt: string): Promise<void>
    }
  }
): Promise<{
  scopes: string[]
  token: McpTokenRecord
  tokenId: string
}> {
  const header = event.headers.authorization ?? event.headers.Authorization
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()

  if (!token) {
    throw new McpAuthError('A valid Bearer token is required', 401)
  }

  const tokenRecord = await options.store.findUsableTokenByHash(
    hashMcpToken(token),
    options.environment
  )

  if (!tokenRecord) {
    throw new McpAuthError('A valid Bearer token is required', 401)
  }

  const usedAt = new Date().toISOString()

  await options.store.touchLastUsedAt(tokenRecord.id, usedAt)

  return {
    scopes: parseStringArrayJson(tokenRecord.scopesJson),
    token: tokenRecord,
    tokenId: tokenRecord.id,
  }
}

export function requireMcpScope(
  auth: {
    scopes: string[]
    tokenId: string
  },
  scope: string
): true {
  if (!auth.scopes.includes(scope)) {
    throw new McpAuthError(`The MCP token is missing required scope: ${scope}`, 403)
  }

  return true
}
