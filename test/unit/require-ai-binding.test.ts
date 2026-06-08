import type { H3Event } from 'h3'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// cloudflare-bindings.ts relies on Nitro's auto-imported `createError`.
// Under plain vitest (no Nitro runtime) we polyfill it so the 503 path is
// observable — same shape used by test/integration/helpers/nuxt-route.ts.
beforeAll(() => {
  vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
    Object.assign(new Error(input.message ?? 'error'), input),
  )
})

import { requireAiBinding, requireAiSearchBinding } from '#server/utils/ai-binding'

function makeEvent(env: Record<string, unknown>): H3Event {
  return { context: { cloudflare: { env } } } as unknown as H3Event
}

async function captureThrown(fn: () => unknown): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err
  }
}

const runStub = () => Promise.resolve()

describe('requireAiBinding (Workers AI)', () => {
  it('returns the binding when env.AI exists and the requested method is a function', () => {
    const event = makeEvent({ AI: { run: runStub } })
    const binding = requireAiBinding<{ run: () => Promise<void> }>(event, {
      method: 'run',
      message: 'AI missing',
    })
    expect(binding.run).toBe(runStub)
  })

  it('throws 503 with the provided message when env.AI is missing', async () => {
    const event = makeEvent({})
    const err = await captureThrown(() =>
      requireAiBinding(event, { method: 'run', message: 'AI missing' }),
    )
    expect(err).toMatchObject({ statusCode: 503, message: 'AI missing' })
  })

  it('throws 503 when env has no cloudflare context at all', async () => {
    const err = await captureThrown(() =>
      requireAiBinding({ context: {} } as unknown as H3Event, {
        method: 'run',
        message: 'AI missing',
      }),
    )
    expect(err).toMatchObject({ statusCode: 503, message: 'AI missing' })
  })

  it('throws 503 when env.AI is present but the method value is not a function', async () => {
    const event = makeEvent({ AI: { run: 'not-a-function' } })
    const err = await captureThrown(() =>
      requireAiBinding(event, { method: 'run', message: 'run not fn' }),
    )
    expect(err).toMatchObject({ statusCode: 503, message: 'run not fn' })
  })

  it('throws 503 when env.AI is present but the requested method key is absent', async () => {
    const event = makeEvent({ AI: { somethingElse: () => undefined } })
    const err = await captureThrown(() =>
      requireAiBinding(event, { method: 'run', message: 'run missing' }),
    )
    expect(err).toMatchObject({ statusCode: 503, message: 'run missing' })
  })
})

describe('requireAiSearchBinding (AI Search namespace)', () => {
  it('returns the binding when env.AI_SEARCH exists and has .get function', () => {
    const getStub = () => ({ search: async () => ({}) })
    const event = makeEvent({ AI_SEARCH: { get: getStub } })
    const binding = requireAiSearchBinding<{ get: typeof getStub }>(event)
    expect(binding.get).toBe(getStub)
  })

  it('throws 503 when env.AI_SEARCH is missing', async () => {
    const event = makeEvent({})
    const err = await captureThrown(() => requireAiSearchBinding(event))
    expect(err).toMatchObject({
      statusCode: 503,
      message: 'Cloudflare AI Search binding "AI_SEARCH" is not available',
    })
  })

  it('throws 503 when env.AI_SEARCH has no .get method', async () => {
    const event = makeEvent({ AI_SEARCH: { noGet: true } })
    const err = await captureThrown(() => requireAiSearchBinding(event))
    expect(err).toMatchObject({
      statusCode: 503,
      message: 'Cloudflare AI Search binding "AI_SEARCH" is not available',
    })
  })

  it('throws 503 when env.AI_SEARCH.get is not a function', async () => {
    const event = makeEvent({ AI_SEARCH: { get: 'not-a-function' } })
    const err = await captureThrown(() => requireAiSearchBinding(event))
    expect(err).toMatchObject({
      statusCode: 503,
      message: 'Cloudflare AI Search binding "AI_SEARCH" is not available',
    })
  })

  it('does not interfere with Workers AI binding on env.AI', () => {
    const event = makeEvent({
      AI: { run: runStub },
      AI_SEARCH: { get: () => ({ search: async () => ({}) }) },
    })
    const aiBinding = requireAiBinding<{ run: typeof runStub }>(event, {
      method: 'run',
      message: 'AI missing',
    })
    expect(aiBinding.run).toBe(runStub)

    const searchBinding = requireAiSearchBinding<{ get: () => unknown }>(event)
    expect(typeof searchBinding.get).toBe('function')
  })
})
