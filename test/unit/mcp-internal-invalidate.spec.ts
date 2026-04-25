import { describe, expect, it } from 'vitest'

const secret = '0123456789abcdef0123456789abcdef'
const sessionId = 'sess-abc-123'
const issuedAt = 1_700_000_000_000

describe('mcp internal invalidate header codec', () => {
  it('signs with format `v1.<sessionId>.<timestampMs>.<hex>`', async () => {
    const { signInvalidateHeader } = await import('#server/utils/mcp-internal-invalidate')

    const header = await signInvalidateHeader({ sessionId, secret, now: issuedAt })

    const match = header.match(/^v1\.([^.]+)\.(\d+)\.([0-9a-f]+)$/)
    expect(match, `header should match shape, got: ${header}`).not.toBeNull()
    expect(match![1]).toBe(sessionId)
    expect(match![2]).toBe(String(issuedAt))
    expect(match![3]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifies a freshly signed header', async () => {
    const { signInvalidateHeader, verifyInvalidateHeader } =
      await import('#server/utils/mcp-internal-invalidate')

    const header = await signInvalidateHeader({ sessionId, secret, now: issuedAt })

    await expect(
      verifyInvalidateHeader(header, { sessionId, secret, now: issuedAt + 1000 }),
    ).resolves.toBe(true)
  })

  it('rejects when the sessionId binding does not match', async () => {
    const { signInvalidateHeader, verifyInvalidateHeader } =
      await import('#server/utils/mcp-internal-invalidate')

    const header = await signInvalidateHeader({ sessionId, secret, now: issuedAt })

    await expect(
      verifyInvalidateHeader(header, { sessionId: 'sess-different', secret, now: issuedAt }),
    ).resolves.toBe(false)
  })

  it('rejects when the timestamp has been tampered', async () => {
    const { signInvalidateHeader, verifyInvalidateHeader } =
      await import('#server/utils/mcp-internal-invalidate')

    const header = await signInvalidateHeader({ sessionId, secret, now: issuedAt })
    const parts = header.split('.')
    parts[2] = String(issuedAt + 1)
    const tampered = parts.join('.')

    await expect(
      verifyInvalidateHeader(tampered, { sessionId, secret, now: issuedAt + 1 }),
    ).resolves.toBe(false)
  })

  it('rejects when the signature has been tampered', async () => {
    const { signInvalidateHeader, verifyInvalidateHeader } =
      await import('#server/utils/mcp-internal-invalidate')

    const header = await signInvalidateHeader({ sessionId, secret, now: issuedAt })
    const parts = header.split('.')
    const sigBytes = parts[3]!.split('')
    sigBytes[0] = sigBytes[0] === '0' ? '1' : '0'
    parts[3] = sigBytes.join('')
    const tampered = parts.join('.')

    await expect(
      verifyInvalidateHeader(tampered, { sessionId, secret, now: issuedAt }),
    ).resolves.toBe(false)
  })

  it('rejects when timestamp skew exceeds default 60s window', async () => {
    const { signInvalidateHeader, verifyInvalidateHeader } =
      await import('#server/utils/mcp-internal-invalidate')

    const header = await signInvalidateHeader({ sessionId, secret, now: issuedAt })

    await expect(
      verifyInvalidateHeader(header, { sessionId, secret, now: issuedAt + 60_001 }),
    ).resolves.toBe(false)
  })

  it('rejects future timestamps that exceed the skew window', async () => {
    const { signInvalidateHeader, verifyInvalidateHeader } =
      await import('#server/utils/mcp-internal-invalidate')

    const header = await signInvalidateHeader({ sessionId, secret, now: issuedAt + 60_001 })

    await expect(
      verifyInvalidateHeader(header, { sessionId, secret, now: issuedAt }),
    ).resolves.toBe(false)
  })

  it('honours an explicit maxSkewMs override', async () => {
    const { signInvalidateHeader, verifyInvalidateHeader } =
      await import('#server/utils/mcp-internal-invalidate')

    const header = await signInvalidateHeader({ sessionId, secret, now: issuedAt })

    await expect(
      verifyInvalidateHeader(header, {
        sessionId,
        secret,
        now: issuedAt + 5000,
        maxSkewMs: 1000,
      }),
    ).resolves.toBe(false)
  })

  it('rejects when verification uses a different secret', async () => {
    const { signInvalidateHeader, verifyInvalidateHeader } =
      await import('#server/utils/mcp-internal-invalidate')

    const header = await signInvalidateHeader({ sessionId, secret, now: issuedAt })

    await expect(
      verifyInvalidateHeader(header, {
        sessionId,
        secret: 'different-secret-different-secret',
        now: issuedAt,
      }),
    ).resolves.toBe(false)
  })

  it('rejects empty / nullish header values', async () => {
    const { verifyInvalidateHeader } = await import('#server/utils/mcp-internal-invalidate')

    await expect(verifyInvalidateHeader(null, { sessionId, secret })).resolves.toBe(false)
    await expect(verifyInvalidateHeader(undefined, { sessionId, secret })).resolves.toBe(false)
    await expect(verifyInvalidateHeader('', { sessionId, secret })).resolves.toBe(false)
  })

  it('rejects malformed headers (wrong segment count, wrong version, non-hex sig)', async () => {
    const { verifyInvalidateHeader } = await import('#server/utils/mcp-internal-invalidate')

    await expect(
      verifyInvalidateHeader('v1.sess.123', { sessionId, secret, now: issuedAt }),
    ).resolves.toBe(false)
    await expect(
      verifyInvalidateHeader(`v2.${sessionId}.${issuedAt}.deadbeef`, {
        sessionId,
        secret,
        now: issuedAt,
      }),
    ).resolves.toBe(false)
    await expect(
      verifyInvalidateHeader(`v1.${sessionId}.${issuedAt}.NOTHEX!!`, {
        sessionId,
        secret,
        now: issuedAt,
      }),
    ).resolves.toBe(false)
    await expect(
      verifyInvalidateHeader(`v1.${sessionId}.notanumber.deadbeef`, {
        sessionId,
        secret,
        now: issuedAt,
      }),
    ).resolves.toBe(false)
  })

  it('signInvalidateHeader throws when sessionId is empty', async () => {
    const { signInvalidateHeader } = await import('#server/utils/mcp-internal-invalidate')

    await expect(signInvalidateHeader({ sessionId: '', secret, now: issuedAt })).rejects.toThrow(
      /sessionId/,
    )
  })
})
