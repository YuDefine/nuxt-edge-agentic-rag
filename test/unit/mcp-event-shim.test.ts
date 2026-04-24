import { useLogger } from 'evlog'
import { describe, expect, it, vi } from 'vitest'

import { getRequiredD1Binding, getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { requireAiBinding } from '#server/utils/ai-binding'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

const auth: McpAuthContext = {
  principal: {
    authSource: 'oauth_access_token',
    userId: 'user-1',
  },
  scopes: ['knowledge.ask'],
  tokenId: 'oauth:token-1',
}

function createDoEnv() {
  return {
    AI: {
      autorag: vi.fn(),
      run: vi.fn(),
    },
    DB: {
      batch: vi.fn(),
      prepare: vi.fn(),
    },
    KV: {
      get: vi.fn(),
      put: vi.fn(),
    },
  }
}

describe('mcp event shim', () => {
  it('creates a minimal H3Event shape for Durable Object tool handlers', async () => {
    const { createDoMcpEventShim } = await import('#server/durable-objects/mcp-event-shim')
    const request = new Request('https://do.test/mcp', { method: 'POST' })
    const doEnv = createDoEnv()

    const event = createDoMcpEventShim({ auth, doEnv, request })

    expect(event.context.cloudflare.env).toBe(doEnv)
    expect(event.context.mcpAuth).toBe(auth)
    expect(event.web?.request).toBe(request)
    expect(event.node.req).toBeDefined()
  })

  it('makes getCurrentMcpEvent resolve the shim inside async execution', async () => {
    const { createDoMcpEventShim, runWithDoMcpEventShim } =
      await import('#server/durable-objects/mcp-event-shim')
    const { getCurrentMcpEvent } = await import('#server/utils/current-mcp-event')
    const event = createDoMcpEventShim({
      auth,
      doEnv: createDoEnv(),
      request: new Request('https://do.test/mcp', { method: 'POST' }),
    })

    const resolved = await runWithDoMcpEventShim(event, () => getCurrentMcpEvent())

    expect(resolved).toBe(event)
  })

  it('resolves binding helpers and evlog logger with the shim event', async () => {
    const { createDoMcpEventShim } = await import('#server/durable-objects/mcp-event-shim')
    const doEnv = createDoEnv()
    const event = createDoMcpEventShim({
      auth,
      doEnv,
      request: new Request('https://do.test/mcp', { method: 'POST' }),
    })

    expect(getRequiredD1Binding(event, 'DB')).toBe(doEnv.DB)
    expect(getRequiredKvBinding(event, 'KV')).toBe(doEnv.KV)
    expect(requireAiBinding(event, { method: 'run', message: 'missing' })).toBe(doEnv.AI)
    expect(requireAiBinding(event, { method: 'autorag', message: 'missing' })).toBe(doEnv.AI)
    expect(() => useLogger(event as Parameters<typeof useLogger>[0])).not.toThrow()
  })

  it('installs an enumerable-safe global env without reflecting over the DO env proxy', async () => {
    const { installEnumerableSafeDoEnv } = await import('#server/durable-objects/mcp-event-shim')
    const doEnv = new Proxy(createDoEnv(), {
      ownKeys() {
        throw new TypeError('ownKeys trap failed')
      },
    })

    expect(() => Reflect.ownKeys(doEnv)).toThrow(TypeError)
    expect(() => installEnumerableSafeDoEnv(doEnv)).not.toThrow()
    expect((globalThis as { __env__?: Record<string, unknown> }).__env__?.DB).toBe(doEnv.DB)
  })
})
