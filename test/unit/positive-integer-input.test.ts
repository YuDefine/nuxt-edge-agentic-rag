import { describe, expect, it } from 'vitest'

import {
  isBlockedPositiveIntegerInputKey,
  normalizePositiveIntegerInputValue,
  parseOptionalPositiveIntegerInput,
} from '../../app/utils/positive-integer-input'

describe('positive integer input helpers', () => {
  it('keeps form state string based even when UI input emits numbers', () => {
    expect(normalizePositiveIntegerInputValue(30)).toBe('30')
    expect(normalizePositiveIntegerInputValue('30')).toBe('30')
  })

  it('removes harmless unsupported characters from pasted text', () => {
    expect(normalizePositiveIntegerInputValue('30 days')).toBe('30')
  })

  it('rejects pasted numeric formats that would change meaning if stripped', () => {
    expect(normalizePositiveIntegerInputValue('1.5')).toBe('')
    expect(normalizePositiveIntegerInputValue('1e3')).toBe('')
    expect(normalizePositiveIntegerInputValue('+30')).toBe('')
  })

  it('blocks negative values before they enter form state', () => {
    expect(normalizePositiveIntegerInputValue(-1)).toBe('')
    expect(normalizePositiveIntegerInputValue('-30')).toBe('')
    expect(isBlockedPositiveIntegerInputKey('-')).toBe(true)
  })

  it('parses optional positive integers for API payloads', () => {
    expect(parseOptionalPositiveIntegerInput('')).toBeUndefined()
    expect(parseOptionalPositiveIntegerInput('0')).toBeUndefined()
    expect(parseOptionalPositiveIntegerInput('30')).toBe(30)
  })
})
