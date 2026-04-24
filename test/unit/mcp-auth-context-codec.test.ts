import { describe, expect, it } from 'vitest'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

const signingKey = '0123456789abcdef0123456789abcdef'
const issuedAt = 1_000_000

const auth: McpAuthContext = {
  principal: {
    authSource: 'legacy_token',
    userId: 'admin-1',
  },
  scopes: ['knowledge.ask', 'knowledge.search'],
  tokenId: 'token-1',
}

function decodeEnvelope(header: string) {
  return JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
    payload: string
    signature: string
  }
}

function encodeEnvelope(envelope: { payload: string; signature: string }) {
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')
}

describe('mcp auth context codec', () => {
  it('round-trips a signed auth context envelope', async () => {
    const { signAuthContext, verifyAuthContext } =
      await import('#server/utils/mcp-auth-context-codec')

    const header = await signAuthContext(auth, signingKey, issuedAt)

    await expect(verifyAuthContext(header, signingKey, issuedAt + 1000)).resolves.toEqual(auth)
  })

  it('rejects a tampered payload', async () => {
    const { signAuthContext, verifyAuthContext } =
      await import('#server/utils/mcp-auth-context-codec')

    const header = await signAuthContext(auth, signingKey, issuedAt)
    const envelope = decodeEnvelope(header)
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'))
    payload.auth.scopes = ['knowledge.ask', 'knowledge.search', 'knowledge.admin']
    const tamperedHeader = encodeEnvelope({
      ...envelope,
      payload: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    })

    await expect(verifyAuthContext(tamperedHeader, signingKey, issuedAt + 1000)).resolves.toBeNull()
  })

  it('rejects an envelope older than sixty seconds even when the signature is valid', async () => {
    const { signAuthContext, verifyAuthContext } =
      await import('#server/utils/mcp-auth-context-codec')

    const header = await signAuthContext(auth, signingKey, issuedAt)

    await expect(verifyAuthContext(header, signingKey, issuedAt + 60_001)).resolves.toBeNull()
  })

  it('rejects malformed Base64URL input', async () => {
    const { verifyAuthContext } = await import('#server/utils/mcp-auth-context-codec')

    await expect(
      verifyAuthContext('not valid base64url!', signingKey, issuedAt),
    ).resolves.toBeNull()
  })

  it('rejects a missing header', async () => {
    const { verifyAuthContext } = await import('#server/utils/mcp-auth-context-codec')

    await expect(verifyAuthContext(null, signingKey, issuedAt)).resolves.toBeNull()
  })

  it('rejects missing production signing keys loudly', async () => {
    const { resolveMcpAuthSigningKey } = await import('#server/utils/mcp-auth-context-codec')

    expect(() => resolveMcpAuthSigningKey('')).toThrow(
      'NUXT_MCP_AUTH_SIGNING_KEY must be configured',
    )
  })

  it('rejects short signing keys loudly', async () => {
    const { resolveMcpAuthSigningKey } = await import('#server/utils/mcp-auth-context-codec')

    expect(() => resolveMcpAuthSigningKey('short')).toThrow(
      'NUXT_MCP_AUTH_SIGNING_KEY must be at least 32 bytes',
    )
  })
})
