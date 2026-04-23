import { describe, expect, it } from 'vitest'

import { createMcpOauthGrantStore, McpOauthGrantError } from '#server/utils/mcp-oauth-grants'

function createKvStub() {
  const store = new Map<string, string>()

  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
  }
}

describe('mcp oauth grants', () => {
  it('issues an authorization code and exchanges it into an access token', async () => {
    const kv = createKvStub()
    const grants = createMcpOauthGrantStore({
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 120,
      kv,
      now: () => 1_700_000_000_000,
    })

    const code = await grants.issueAuthorizationCode({
      codeChallenge: 'iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ',
      codeChallengeMethod: 'S256',
      clientId: 'claude-remote',
      redirectUri: 'https://claude.example/callback',
      scopes: ['knowledge.ask', 'knowledge.search'],
      userId: 'user-1',
    })

    const token = await grants.exchangeAuthorizationCode({
      clientId: 'claude-remote',
      code,
      codeVerifier: 'verifier',
      redirectUri: 'https://claude.example/callback',
    })

    expect(token).toMatchObject({
      clientId: 'claude-remote',
      expiresIn: 600,
      scope: 'knowledge.ask knowledge.search',
      tokenType: 'Bearer',
      userId: 'user-1',
    })

    const principal = await grants.getAccessTokenRecord(token.accessToken)

    expect(principal).toMatchObject({
      clientId: 'claude-remote',
      scopes: ['knowledge.ask', 'knowledge.search'],
      userId: 'user-1',
    })
  })

  it('rejects reusing an authorization code after it has been exchanged once', async () => {
    const kv = createKvStub()
    const grants = createMcpOauthGrantStore({
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 120,
      kv,
      now: () => 1_700_000_000_000,
    })

    const code = await grants.issueAuthorizationCode({
      clientId: 'claude-remote',
      redirectUri: 'https://claude.example/callback',
      scopes: ['knowledge.ask'],
      userId: 'user-1',
    })

    await grants.exchangeAuthorizationCode({
      clientId: 'claude-remote',
      code,
      redirectUri: 'https://claude.example/callback',
    })

    await expect(
      grants.exchangeAuthorizationCode({
        clientId: 'claude-remote',
        code,
        redirectUri: 'https://claude.example/callback',
      }),
    ).rejects.toThrowError(
      new McpOauthGrantError('Authorization code has already been consumed', 400),
    )
  })

  it('rejects PKCE verifier mismatches for challenged authorization codes', async () => {
    const kv = createKvStub()
    const grants = createMcpOauthGrantStore({
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 120,
      kv,
      now: () => 1_700_000_000_000,
    })

    const code = await grants.issueAuthorizationCode({
      codeChallenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      codeChallengeMethod: 'S256',
      clientId: 'claude-remote',
      redirectUri: 'https://claude.example/callback',
      scopes: ['knowledge.ask'],
      userId: 'user-1',
    })

    await expect(
      grants.exchangeAuthorizationCode({
        clientId: 'claude-remote',
        code,
        codeVerifier: 'wrong-verifier',
        redirectUri: 'https://claude.example/callback',
      }),
    ).rejects.toThrowError(new McpOauthGrantError('Authorization code PKCE mismatch', 400))
  })
})
