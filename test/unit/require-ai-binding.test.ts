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

import { requireAiBinding } from '#server/utils/ai-binding'

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

const autoragStub = () => Promise.resolve()

describe('requireAiBinding (TD-017)', () => {
  it('returns the binding when env.AI exists and the requested method is a function', () => {
    const event = makeEvent({ AI: { autorag: autoragStub } })
    const binding = requireAiBinding<{ autorag: () => Promise<void> }>(event, {
      method: 'autorag',
      message: 'AI missing',
    })
    expect(binding.autorag).toBe(autoragStub)
  })

  it('throws 503 with the provided message when env.AI is missing', async () => {
    const event = makeEvent({})
    const err = await captureThrown(() =>
      requireAiBinding(event, { method: 'autorag', message: 'AI missing' }),
    )
    expect(err).toMatchObject({ statusCode: 503, message: 'AI missing' })
  })

  it('throws 503 when env has no cloudflare context at all', async () => {
    const err = await captureThrown(() =>
      requireAiBinding({ context: {} } as unknown as H3Event, {
        method: 'autorag',
        message: 'AI missing',
      }),
    )
    expect(err).toMatchObject({ statusCode: 503, message: 'AI missing' })
  })

  it('throws 503 when env.AI is present but the method value is not a function', async () => {
    const event = makeEvent({ AI: { autorag: 'not-a-function' } })
    const err = await captureThrown(() =>
      requireAiBinding(event, { method: 'autorag', message: 'autorag not fn' }),
    )
    expect(err).toMatchObject({ statusCode: 503, message: 'autorag not fn' })
  })

  it('throws 503 when env.AI is present but the requested method key is absent', async () => {
    const event = makeEvent({ AI: { run: () => undefined } })
    const err = await captureThrown(() =>
      requireAiBinding(event, { method: 'autorag', message: 'autorag missing' }),
    )
    expect(err).toMatchObject({ statusCode: 503, message: 'autorag missing' })
  })

  it('validates independently for different methods on the same binding', async () => {
    const binding = { run: () => 'run-ok' }
    const event = makeEvent({ AI: binding })

    const got = requireAiBinding<typeof binding>(event, { method: 'run', message: 'run missing' })
    expect(got).toBe(binding)

    const err = await captureThrown(() =>
      requireAiBinding(event, { method: 'autorag', message: 'autorag missing' }),
    )
    expect(err).toMatchObject({ statusCode: 503, message: 'autorag missing' })
  })
})
