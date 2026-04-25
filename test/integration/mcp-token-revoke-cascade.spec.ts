/**
 * Token revoke cascade cleanup — happy path / DO unreachable / KV miss.
 *
 * Spec: `oauth-remote-mcp-auth` requirement "Token revocation SHALL
 * cascade-invalidate active session Durable Object storage within bounded
 * time" (added by this change).
 *
 * The scenario: admin revokes a token; the endpoint reads the KV index for
 * active sessions, fans HMAC-signed `__invalidate` requests at each DO, then
 * clears the index. Failures must be swallowed (DO TTL alarm is the safety
 * net) and never block the main revoke flow.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

import {
  MCP_INVALIDATE_HEADER,
  verifyInvalidateHeader,
} from '#server/utils/mcp-internal-invalidate'
import { appendSessionId, readSessionIds } from '#server/utils/mcp-token-session-index'

import type { KvBindingLike } from '#server/utils/cloudflare-bindings'

const SIGNING_KEY = '0123456789abcdef0123456789abcdef'
const TOKEN_ID = 'tok-cascade-test'
const SESSION_A = 'sess-aaaa'
const SESSION_B = 'sess-bbbb'

const mocks = vi.hoisted(() => ({
  revokeTokenById: vi.fn(),
  requireRuntimeAdminSession: vi.fn().mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com' },
  }),
  getValidatedRouterParams: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
    warn: mocks.warn,
  }),
}))

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/admin-session', () => ({
  requireRuntimeAdminSession: mocks.requireRuntimeAdminSession,
}))

vi.mock('../../server/utils/mcp-token-store', () => ({
  createMcpTokenAdminStore: () => ({
    revokeTokenById: mocks.revokeTokenById,
  }),
}))

vi.mock('../../server/utils/knowledge-runtime', () => ({
  getKnowledgeRuntimeConfig: () => ({
    bindings: { rateLimitKv: 'KV' },
  }),
}))

installNuxtRouteTestGlobals()

interface InMemoryKv extends KvBindingLike {
  _store: Map<string, string>
}

function createInMemoryKv(): InMemoryKv {
  const store = new Map<string, string>()
  return {
    _store: store,
    async delete(key: string) {
      store.delete(key)
    },
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
  }
}

interface FakeDoNamespace {
  fetch: ReturnType<typeof vi.fn>
  idFromName: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  invalidatedSessions: Array<{ sessionId: string; header: string }>
}

function createDoNamespace(
  opts: {
    responder?: (sessionId: string) => Response | Promise<Response>
    throwOnFetch?: boolean
  } = {},
): FakeDoNamespace {
  const invalidatedSessions: Array<{ sessionId: string; header: string }> = []
  const fetch = vi.fn(async (request: Request) => {
    if (opts.throwOnFetch) {
      throw new Error('DO unreachable')
    }
    const sessionId = request.headers.get('Mcp-Session-Id') ?? ''
    const header = request.headers.get(MCP_INVALIDATE_HEADER) ?? ''
    invalidatedSessions.push({ sessionId, header })
    if (opts.responder) {
      return opts.responder(sessionId)
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })
  const idFromName = vi.fn((name: string) => ({ toString: () => name, name }))
  const get = vi.fn(() => ({ fetch }))
  return {
    fetch,
    idFromName,
    get,
    invalidatedSessions,
  }
}

function buildEvent(kv: KvBindingLike, namespace: FakeDoNamespace | null) {
  return createRouteEvent({
    context: {
      params: { id: TOKEN_ID },
      cloudflare: {
        env: {
          KV: kv,
          NUXT_MCP_AUTH_SIGNING_KEY: SIGNING_KEY,
          ...(namespace ? { MCP_SESSION: namespace } : {}),
        },
      },
    },
  })
}

describe('admin token revoke cascade cleanup', () => {
  beforeEach(() => {
    vi.stubGlobal('getValidatedRouterParams', mocks.getValidatedRouterParams)
    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    mocks.getValidatedRouterParams.mockResolvedValue({ id: TOKEN_ID })
    mocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
    mocks.warn.mockReset()
    mocks.revokeTokenById.mockResolvedValue({
      outcome: 'revoked',
      token: { id: TOKEN_ID, status: 'revoked', revokedAt: '2026-04-26T00:00:00.000Z' },
    })
  })

  it('happy path: invalidates each active session and clears KV index', async () => {
    const kv = createInMemoryKv()
    await appendSessionId(kv, TOKEN_ID, SESSION_A)
    await appendSessionId(kv, TOKEN_ID, SESSION_B)

    const namespace = createDoNamespace()
    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')

    const result = (await handler(buildEvent(kv, namespace))) as { data: { id: string } }
    expect(result.data.id).toBe(TOKEN_ID)

    // Both sessions invalidated
    const invalidatedIds = namespace.invalidatedSessions.map((entry) => entry.sessionId).toSorted()
    expect(invalidatedIds).toEqual([SESSION_A, SESSION_B])

    // Each invalidate header is HMAC-valid for its bound sessionId
    for (const { sessionId, header } of namespace.invalidatedSessions) {
      const ok = await verifyInvalidateHeader(header, { sessionId, secret: SIGNING_KEY })
      expect(ok, `header should verify for ${sessionId}`).toBe(true)
    }

    // KV index cleared
    expect(await readSessionIds(kv, TOKEN_ID)).toEqual([])
  })

  it('DO unreachable: revoke main flow still returns success + warning logged', async () => {
    const kv = createInMemoryKv()
    await appendSessionId(kv, TOKEN_ID, SESSION_A)

    const namespace = createDoNamespace({ throwOnFetch: true })
    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')

    const result = (await handler(buildEvent(kv, namespace))) as { data: { id: string } }
    expect(result.data.id).toBe(TOKEN_ID)

    // Cleanup attempted
    expect(namespace.fetch).toHaveBeenCalledTimes(1)
    // KV index still cleared (cascade is best-effort but the index itself is cleared
    // unconditionally so the next revoke does not try the same dead sessions)
    expect(await readSessionIds(kv, TOKEN_ID)).toEqual([])
    // Warning was logged
    expect(mocks.warn).toHaveBeenCalled()
    const warnCalls = mocks.warn.mock.calls.map((args) => String(args[0] ?? ''))
    expect(warnCalls.some((msg) => msg.includes('DO invalidate threw'))).toBe(true)
  })

  it('DO returns non-2xx: revoke success + warning logged + index cleared', async () => {
    const kv = createInMemoryKv()
    await appendSessionId(kv, TOKEN_ID, SESSION_A)

    const namespace = createDoNamespace({
      responder: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    })
    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')

    const result = (await handler(buildEvent(kv, namespace))) as { data: { id: string } }
    expect(result.data.id).toBe(TOKEN_ID)

    expect(await readSessionIds(kv, TOKEN_ID)).toEqual([])
    const warnCalls = mocks.warn.mock.calls.map((args) => String(args[0] ?? ''))
    expect(warnCalls.some((msg) => msg.includes('DO invalidate non-2xx'))).toBe(true)
  })

  it('KV miss (no active sessions): revoke success and no DO fetch attempted', async () => {
    const kv = createInMemoryKv()
    const namespace = createDoNamespace()
    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')

    const result = (await handler(buildEvent(kv, namespace))) as { data: { id: string } }
    expect(result.data.id).toBe(TOKEN_ID)

    expect(namespace.fetch).not.toHaveBeenCalled()
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it('MCP_SESSION binding missing: revoke success + warning logged + index still cleared', async () => {
    const kv = createInMemoryKv()
    await appendSessionId(kv, TOKEN_ID, SESSION_A)

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')

    const result = (await handler(buildEvent(kv, null))) as { data: { id: string } }
    expect(result.data.id).toBe(TOKEN_ID)

    expect(await readSessionIds(kv, TOKEN_ID)).toEqual([])
    const warnCalls = mocks.warn.mock.calls.map((args) => String(args[0] ?? ''))
    expect(warnCalls.some((msg) => msg.includes('MCP_SESSION binding unavailable'))).toBe(true)
  })

  it('already-revoked outcome still triggers cascade cleanup', async () => {
    mocks.revokeTokenById.mockResolvedValue({
      outcome: 'already-revoked',
      token: { id: TOKEN_ID, status: 'revoked', revokedAt: '2026-04-10T00:00:00.000Z' },
    })

    const kv = createInMemoryKv()
    await appendSessionId(kv, TOKEN_ID, SESSION_A)
    const namespace = createDoNamespace()

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')
    const result = (await handler(buildEvent(kv, namespace))) as {
      data: { alreadyRevoked: boolean }
    }
    expect(result.data.alreadyRevoked).toBe(true)

    expect(namespace.fetch).toHaveBeenCalledTimes(1)
    expect(await readSessionIds(kv, TOKEN_ID)).toEqual([])
  })

  it('not-found outcome: skips cascade entirely (404 thrown before cleanup)', async () => {
    mocks.revokeTokenById.mockResolvedValue({ outcome: 'not-found' })

    const kv = createInMemoryKv()
    await appendSessionId(kv, TOKEN_ID, SESSION_A)
    const namespace = createDoNamespace()

    const { default: handler } = await import('../../server/api/admin/mcp-tokens/[id].delete')

    await expect(handler(buildEvent(kv, namespace))).rejects.toMatchObject({ statusCode: 404 })
    expect(namespace.fetch).not.toHaveBeenCalled()
    // KV index NOT cleared because revoke flow never reached cascade
    expect(await readSessionIds(kv, TOKEN_ID)).toEqual([SESSION_A])
  })
})
