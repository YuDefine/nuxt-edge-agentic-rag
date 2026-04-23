import { describe, expect, it } from 'vitest'

import {
  classifyChatError,
  readChatErrorStatus,
  STATUS_TO_KIND,
} from '~/utils/chat-error-classification'

describe('chat error classification (TD-018)', () => {
  describe('readChatErrorStatus', () => {
    it('returns statusCode when the error exposes one', () => {
      expect(readChatErrorStatus({ statusCode: 404 })).toBe(404)
    })

    it('returns status when the error exposes that variant instead', () => {
      expect(readChatErrorStatus({ status: 500 })).toBe(500)
    })

    it('prefers statusCode over status when both are present', () => {
      expect(readChatErrorStatus({ statusCode: 401, status: 500 })).toBe(401)
    })

    it('ignores non-numeric statusCode values', () => {
      expect(readChatErrorStatus({ statusCode: '500' })).toBeUndefined()
      expect(readChatErrorStatus({ statusCode: null })).toBeUndefined()
    })

    it('returns undefined for primitives and null', () => {
      expect(readChatErrorStatus(null)).toBeUndefined()
      expect(readChatErrorStatus(undefined)).toBeUndefined()
      expect(readChatErrorStatus('boom')).toBeUndefined()
      expect(readChatErrorStatus(42)).toBeUndefined()
    })
  })

  describe('STATUS_TO_KIND lookup', () => {
    it('maps known status codes', () => {
      expect(STATUS_TO_KIND[401]).toBe('unauthorized')
      expect(STATUS_TO_KIND[429]).toBe('rate_limit')
      expect(STATUS_TO_KIND[504]).toBe('timeout')
    })
  })

  describe('classifyChatError', () => {
    it('returns "abort" for DOMException with name AbortError', () => {
      const err = new DOMException('aborted', 'AbortError')
      expect(classifyChatError(err)).toBe('abort')
    })

    it('returns "abort" for any object whose name === "AbortError"', () => {
      expect(classifyChatError({ name: 'AbortError' })).toBe('abort')
    })

    it.each([
      { status: 401, expected: 'unauthorized' as const },
      { status: 429, expected: 'rate_limit' as const },
      { status: 504, expected: 'timeout' as const },
    ])('maps status $status → $expected via lookup', ({ status, expected }) => {
      expect(classifyChatError({ statusCode: status })).toBe(expected)
    })

    it.each([{ status: 500 }, { status: 502 }, { status: 503 }, { status: 599 }])(
      'maps 5xx status $status → "network"',
      ({ status }) => {
        expect(classifyChatError({ statusCode: status })).toBe('network')
      },
    )

    it('returns "unknown" for 4xx status codes without specific mapping', () => {
      expect(classifyChatError({ statusCode: 403 })).toBe('unknown')
      expect(classifyChatError({ statusCode: 404 })).toBe('unknown')
    })

    it('returns "network" for plain TypeError (fetch-style connection failure)', () => {
      expect(classifyChatError(new TypeError('fetch failed'))).toBe('network')
    })

    it('returns "unknown" for primitive / null / miscellaneous values', () => {
      expect(classifyChatError(null)).toBe('unknown')
      expect(classifyChatError(undefined)).toBe('unknown')
      expect(classifyChatError('some message')).toBe('unknown')
      expect(classifyChatError(new Error('plain'))).toBe('unknown')
    })

    it('reads status from { status } variant when statusCode is absent', () => {
      expect(classifyChatError({ status: 429 })).toBe('rate_limit')
    })

    it('prefers abort detection over any status-based mapping', () => {
      // An aborted fetch may surface as a DOMException with name 'AbortError'
      // even if a status-like field is present; abort takes priority.
      const abortLike = Object.assign(new Error('aborted'), {
        name: 'AbortError',
        statusCode: 500,
      })
      expect(classifyChatError(abortLike)).toBe('abort')
    })
  })
})
