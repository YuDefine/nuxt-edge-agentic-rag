import { describe, expect, it } from 'vitest'

import {
  NICKNAME_ALLOWED_PATTERN,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  nicknameSchema,
  normaliseNicknameForCompare,
} from '../../shared/schemas/nickname'

/**
 * passkey-authentication §9.4 — Nickname input validation surface.
 *
 * Tests the shared schema + normalisation helpers rather than the Vue
 * component rendering. The component's template behaviour (status icon,
 * help text, debounced fetch) is validated by the e2e spec (§10.3) and
 * the nickname-check integration test (§3.4); this spec guards the
 * contract of the validation itself so the component and the server
 * endpoint stay in lock-step.
 */

describe('nicknameSchema — format validation', () => {
  it('rejects empty string', () => {
    const result = nicknameSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only string (after trim)', () => {
    const result = nicknameSchema.safeParse('   ')
    expect(result.success).toBe(false)
  })

  it('rejects single-character nickname (below min length)', () => {
    const result = nicknameSchema.safeParse('A')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(String(NICKNAME_MIN_LENGTH))
    }
  })

  it('rejects nickname longer than NICKNAME_MAX_LENGTH', () => {
    const tooLong = 'A'.repeat(NICKNAME_MAX_LENGTH + 1)
    const result = nicknameSchema.safeParse(tooLong)
    expect(result.success).toBe(false)
  })

  it('accepts exact min and max length boundaries', () => {
    const atMin = 'A'.repeat(NICKNAME_MIN_LENGTH)
    const atMax = 'A'.repeat(NICKNAME_MAX_LENGTH)
    expect(nicknameSchema.safeParse(atMin).success).toBe(true)
    expect(nicknameSchema.safeParse(atMax).success).toBe(true)
  })

  it('accepts CJK characters', () => {
    expect(nicknameSchema.safeParse('小明').success).toBe(true)
    expect(nicknameSchema.safeParse('張三豐').success).toBe(true)
  })

  it('accepts ASCII letters, digits, underscore, hyphen, space', () => {
    expect(nicknameSchema.safeParse('John_Smith-2').success).toBe(true)
    expect(nicknameSchema.safeParse('Alice  Doe').success).toBe(true)
  })

  it('rejects emoji and special punctuation', () => {
    expect(nicknameSchema.safeParse('Alice 😀').success).toBe(false)
    expect(nicknameSchema.safeParse('Bob!').success).toBe(false)
    expect(nicknameSchema.safeParse('Cheng@home').success).toBe(false)
    expect(nicknameSchema.safeParse('Dan/Ellen').success).toBe(false)
  })

  it('trims leading and trailing whitespace before validation', () => {
    const result = nicknameSchema.safeParse('  Alice  ')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('Alice')
    }
  })
})

describe('normaliseNicknameForCompare', () => {
  it('lowercases input for case-insensitive comparison', () => {
    expect(normaliseNicknameForCompare('Alice')).toBe('alice')
    expect(normaliseNicknameForCompare('ALICE')).toBe('alice')
    expect(normaliseNicknameForCompare('alice')).toBe('alice')
  })

  it('trims surrounding whitespace', () => {
    expect(normaliseNicknameForCompare('  Alice  ')).toBe('alice')
  })

  it('leaves CJK characters unchanged (no case)', () => {
    expect(normaliseNicknameForCompare('小明')).toBe('小明')
  })

  it('preserves internal spacing (compare should handle identical internal spacing)', () => {
    expect(normaliseNicknameForCompare('Alice Wong')).toBe('alice wong')
  })
})

describe('NICKNAME_ALLOWED_PATTERN direct regex check', () => {
  it('matches exactly the set the schema accepts', () => {
    expect(NICKNAME_ALLOWED_PATTERN.test('abc')).toBe(true)
    expect(NICKNAME_ALLOWED_PATTERN.test('小明')).toBe(true)
    expect(NICKNAME_ALLOWED_PATTERN.test('a_b-c 2')).toBe(true)
    expect(NICKNAME_ALLOWED_PATTERN.test('a.b')).toBe(false)
    expect(NICKNAME_ALLOWED_PATTERN.test('a#b')).toBe(false)
  })
})
