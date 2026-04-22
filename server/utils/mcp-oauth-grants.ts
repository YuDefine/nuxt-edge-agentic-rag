import { randomBytes } from 'node:crypto'

interface KvLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface AuthorizationCodeRecord {
  clientId: string
  consumedAt: string | null
  expiresAt: string
  redirectUri: string
  scopes: string[]
  userId: string
}

interface AccessTokenRecord {
  clientId: string
  expiresAt: string
  scopes: string[]
  tokenId: string
  userId: string
}

export interface McpOauthAccessTokenExchange {
  accessToken: string
  clientId: string
  expiresIn: number
  scope: string
  tokenType: 'Bearer'
  userId: string
}

export class McpOauthGrantError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'McpOauthGrantError'
  }
}

export function createMcpOauthGrantStore(input: {
  accessTokenTtlSeconds: number
  authorizationCodeTtlSeconds: number
  kv: KvLike
  now?: () => number
}) {
  const now = input.now ?? Date.now

  return {
    async issueAuthorizationCode(payload: {
      clientId: string
      redirectUri: string
      scopes: string[]
      userId: string
    }): Promise<string> {
      const code = createOpaqueToken()
      const expiresAt = new Date(now() + input.authorizationCodeTtlSeconds * 1000).toISOString()
      const record: AuthorizationCodeRecord = {
        clientId: payload.clientId,
        consumedAt: null,
        expiresAt,
        redirectUri: payload.redirectUri,
        scopes: payload.scopes,
        userId: payload.userId,
      }

      await input.kv.put(grantKey(code), JSON.stringify(record), {
        expirationTtl: input.authorizationCodeTtlSeconds,
      })

      return code
    },

    async exchangeAuthorizationCode(payload: {
      clientId: string
      code: string
      redirectUri: string
    }): Promise<McpOauthAccessTokenExchange> {
      const rawGrant = await input.kv.get(grantKey(payload.code))

      if (!rawGrant) {
        throw new McpOauthGrantError('Authorization code is invalid or expired', 400)
      }

      const grant = JSON.parse(rawGrant) as AuthorizationCodeRecord
      const currentTime = now()

      if (Date.parse(grant.expiresAt) <= currentTime) {
        throw new McpOauthGrantError('Authorization code is invalid or expired', 400)
      }

      if (grant.consumedAt) {
        throw new McpOauthGrantError('Authorization code has already been consumed', 400)
      }

      if (grant.clientId !== payload.clientId) {
        throw new McpOauthGrantError('Authorization code client mismatch', 400)
      }

      if (grant.redirectUri !== payload.redirectUri) {
        throw new McpOauthGrantError('Authorization code redirect URI mismatch', 400)
      }

      const consumedGrant: AuthorizationCodeRecord = {
        ...grant,
        consumedAt: new Date(currentTime).toISOString(),
      }
      const remainingGrantTtlSeconds = Math.max(
        1,
        Math.ceil((Date.parse(grant.expiresAt) - currentTime) / 1000),
      )

      await input.kv.put(grantKey(payload.code), JSON.stringify(consumedGrant), {
        expirationTtl: remainingGrantTtlSeconds,
      })

      const accessToken = createOpaqueToken()
      const tokenId = createOpaqueToken()
      const expiresAt = new Date(currentTime + input.accessTokenTtlSeconds * 1000).toISOString()
      const accessRecord: AccessTokenRecord = {
        clientId: grant.clientId,
        expiresAt,
        scopes: grant.scopes,
        tokenId,
        userId: grant.userId,
      }

      await input.kv.put(accessTokenKey(accessToken), JSON.stringify(accessRecord), {
        expirationTtl: input.accessTokenTtlSeconds,
      })

      return {
        accessToken,
        clientId: grant.clientId,
        expiresIn: input.accessTokenTtlSeconds,
        scope: grant.scopes.join(' '),
        tokenType: 'Bearer',
        userId: grant.userId,
      }
    },

    async getAccessTokenRecord(accessToken: string): Promise<AccessTokenRecord | null> {
      return getMcpOauthAccessTokenRecord({
        accessToken,
        kv: input.kv,
        now,
      })
    },
  }
}

export async function getMcpOauthAccessTokenRecord(input: {
  accessToken: string
  kv: KvLike
  now?: () => number
}): Promise<AccessTokenRecord | null> {
  const rawRecord = await input.kv.get(accessTokenKey(input.accessToken))

  if (!rawRecord) {
    return null
  }

  const record = JSON.parse(rawRecord) as AccessTokenRecord

  if (Date.parse(record.expiresAt) <= (input.now ?? Date.now)()) {
    return null
  }

  return record
}

function createOpaqueToken(): string {
  return randomBytes(24).toString('base64url')
}

function grantKey(code: string): string {
  return `mcp:oauth:grant:${code}`
}

function accessTokenKey(accessToken: string): string {
  return `mcp:oauth:access:${accessToken}`
}
