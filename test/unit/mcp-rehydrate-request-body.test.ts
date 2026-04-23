import type { H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import { rehydrateMcpRequestBody } from '#server/utils/mcp-rehydrate-request-body'

// Stub `h3` so `readBody(event)` returns whatever we expose via `event._body`,
// mimicking the H3 cache behaviour used by the real runtime after
// `tagEvlogContext` / `extractToolNames` have already drained the Worker
// `Request`. The helper under test must NOT touch the original `Request`
// body stream — it must rehydrate from the cached parse.
vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    readBody: async (event: H3Event) => {
      return (event as unknown as { _body?: unknown })._body
    },
  }
})

function makeEvent(opts: {
  method?: string
  url?: string
  headers?: HeadersInit
  cachedBody?: unknown
}): H3Event {
  const method = opts.method ?? 'POST'
  const url = opts.url ?? 'https://worker.test/mcp'

  // The real Worker-native Request has its body stream already drained at
  // this point (simulated by passing no body to the Request ctor — its
  // bodyUsed is vacuous, but calling `.text()` would yield '').
  const originalRequest = new Request(url, {
    method,
    headers: opts.headers ?? {},
  })

  return {
    _body: opts.cachedBody,
    web: {
      request: originalRequest,
    },
  } as unknown as H3Event
}

describe('rehydrateMcpRequestBody', () => {
  it('replaces event.web.request with a new Request whose body can be read', async () => {
    const event = makeEvent({
      method: 'POST',
      cachedBody: { jsonrpc: '2.0', method: 'initialize', id: 0, params: {} },
    })
    const originalRequest = (event as unknown as { web: { request: Request } }).web.request

    await rehydrateMcpRequestBody(event)

    const rehydrated = (event as unknown as { web: { request: Request } }).web.request
    expect(rehydrated).not.toBe(originalRequest)
    expect(rehydrated.method).toBe('POST')
    expect(rehydrated.url).toBe('https://worker.test/mcp')

    const text = await rehydrated.text()
    expect(JSON.parse(text)).toEqual({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 0,
      params: {},
    })
  })

  it('preserves the string body when the cached parse is already a string', async () => {
    const event = makeEvent({
      method: 'POST',
      cachedBody: '{"raw":"payload"}',
    })

    await rehydrateMcpRequestBody(event)

    const text = await (event as unknown as { web: { request: Request } }).web.request.text()
    expect(text).toBe('{"raw":"payload"}')
  })

  it('writes an empty body when the cached parse is undefined or null', async () => {
    for (const cached of [undefined, null]) {
      const event = makeEvent({ method: 'POST', cachedBody: cached })
      await rehydrateMcpRequestBody(event)
      const text = await (event as unknown as { web: { request: Request } }).web.request.text()
      expect(text).toBe('')
    }
  })

  it('skips rehydration for GET requests', async () => {
    const event = makeEvent({ method: 'GET', cachedBody: undefined })
    const original = (event as unknown as { web: { request: Request } }).web.request

    await rehydrateMcpRequestBody(event)

    expect((event as unknown as { web: { request: Request } }).web.request).toBe(original)
  })

  it('skips rehydration for HEAD requests', async () => {
    const event = makeEvent({ method: 'HEAD', cachedBody: undefined })
    const original = (event as unknown as { web: { request: Request } }).web.request

    await rehydrateMcpRequestBody(event)

    expect((event as unknown as { web: { request: Request } }).web.request).toBe(original)
  })

  it('is a no-op when event.web is missing', async () => {
    const event = { _body: { foo: 'bar' } } as unknown as H3Event
    await expect(rehydrateMcpRequestBody(event)).resolves.toBeUndefined()
  })

  it('carries forward request headers on the replay Request', async () => {
    const event = makeEvent({
      method: 'POST',
      headers: {
        authorization: 'Bearer xyz',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      cachedBody: { hello: 'world' },
    })

    await rehydrateMcpRequestBody(event)

    const replay = (event as unknown as { web: { request: Request } }).web.request
    expect(replay.headers.get('authorization')).toBe('Bearer xyz')
    expect(replay.headers.get('content-type')).toBe('application/json')
    expect(replay.headers.get('accept')).toBe('application/json, text/event-stream')
  })
})
