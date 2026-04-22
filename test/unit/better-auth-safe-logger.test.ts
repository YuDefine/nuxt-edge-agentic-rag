import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  createBetterAuthSafeLogger,
  serializeBetterAuthLogArg,
} from '../../server/utils/better-auth-safe-logger'

function createBrokenOwnKeysValue(): object {
  return new Proxy(
    {},
    {
      ownKeys: () => 1 as never,
    },
  )
}

describe('better-auth safe logger', () => {
  it('disables Better Auth color probing for worker safety', () => {
    const logger = createBetterAuthSafeLogger()

    expect(logger.disableColors).toBe(true)
    expect(logger.level).toBe('warn')
  })

  it('coerces broken proxy arguments into strings before forwarding them', () => {
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const logger = createBetterAuthSafeLogger(sink)
    const badValue = createBrokenOwnKeysValue()

    expect(() => logger.log?.('error', 'Failed to verify authentication', badValue)).not.toThrow()
    expect(sink.error).toHaveBeenCalledTimes(1)

    const [message, forwardedArg] = sink.error.mock.calls[0] ?? []
    expect(message).toBe('Failed to verify authentication')
    expect(typeof forwardedArg).toBe('string')
    expect(forwardedArg).not.toBe(badValue)
  })

  it('swallows sink failures so auth errors are not converted into 500s by logging', () => {
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(() => {
        throw new TypeError('a14.ownKeys is not a function or its return value is not iterable')
      }),
    }
    const logger = createBetterAuthSafeLogger(sink)

    expect(() =>
      logger.log?.('error', 'Failed to verify authentication', new Error('AUTHENTICATION_FAILED')),
    ).not.toThrow()
  })

  it('renders unserializable values without throwing', () => {
    expect(() => serializeBetterAuthLogArg(createBrokenOwnKeysValue())).not.toThrow()
    expect(typeof serializeBetterAuthLogArg(createBrokenOwnKeysValue())).toBe('string')
  })

  it('uses a plain console-backed default sink without throwing', () => {
    const logger = createBetterAuthSafeLogger()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      logger.log?.('error', 'Failed to verify authentication', createBrokenOwnKeysValue()),
    ).not.toThrow()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('wires the safe logger into Better Auth server config', () => {
    const authConfigSource = readFileSync(resolve('server/auth.config.ts'), 'utf8')

    expect(authConfigSource).toContain('logger: createBetterAuthSafeLogger()')
  })
})
