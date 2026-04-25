import { describe, expect, it } from 'vitest'

import { createAbortError, isAbortError } from '#shared/utils/abort'

describe('shared/utils/abort', () => {
  describe('isAbortError', () => {
    it('returns true for a DOMException whose name is "AbortError"', () => {
      const error = new DOMException('aborted', 'AbortError')
      expect(isAbortError(error)).toBe(true)
    })

    it('returns true for a plain object whose name is "AbortError" (duck typing)', () => {
      expect(isAbortError({ name: 'AbortError' })).toBe(true)
    })

    it('returns false for a generic Error', () => {
      expect(isAbortError(new Error('something else'))).toBe(false)
    })

    it('returns false for null', () => {
      expect(isAbortError(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isAbortError(undefined)).toBe(false)
    })

    it('returns false for a string', () => {
      expect(isAbortError('AbortError')).toBe(false)
    })

    it('returns false for a number', () => {
      expect(isAbortError(123)).toBe(false)
    })

    it('returns false for an object whose name is not AbortError', () => {
      expect(isAbortError({ name: 'TypeError' })).toBe(false)
    })

    it('returns false for an object without a name property', () => {
      expect(isAbortError({ message: 'aborted' })).toBe(false)
    })
  })

  describe('createAbortError', () => {
    it('returns a DOMException instance', () => {
      const error = createAbortError()
      expect(error).toBeInstanceOf(DOMException)
    })

    it('has name "AbortError"', () => {
      expect(createAbortError().name).toBe('AbortError')
    })

    it('produces a value that isAbortError recognises', () => {
      expect(isAbortError(createAbortError())).toBe(true)
    })
  })
})
