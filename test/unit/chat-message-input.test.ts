import { describe, expect, it } from 'vitest'

/**
 * Validate message input before submission
 */
function validateMessageInput(input: string): {
  valid: boolean
  error?: string
} {
  const trimmed = input.trim()

  if (trimmed.length === 0) {
    return { valid: false, error: '請輸入訊息' }
  }

  if (trimmed.length > 4000) {
    return { valid: false, error: '訊息長度超過限制（最多 4000 字）' }
  }

  return { valid: true }
}

/**
 * Determine if Enter key should submit or add newline
 */
function shouldSubmitOnEnter(event: { shiftKey: boolean }): boolean {
  // Shift+Enter = newline, Enter alone = submit
  return !event.shiftKey
}

describe('message input validation', () => {
  it('rejects empty string', () => {
    const result = validateMessageInput('')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('請輸入訊息')
  })

  it('rejects whitespace-only string', () => {
    const result = validateMessageInput('   \n\t  ')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('請輸入訊息')
  })

  it('accepts valid message', () => {
    const result = validateMessageInput('你好')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts message with leading/trailing whitespace (will be trimmed)', () => {
    const result = validateMessageInput('  有效訊息  ')
    expect(result.valid).toBe(true)
  })

  it('rejects message exceeding 4000 characters', () => {
    const longMessage = 'a'.repeat(4001)
    const result = validateMessageInput(longMessage)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('訊息長度超過限制（最多 4000 字）')
  })

  it('accepts message exactly 4000 characters', () => {
    const maxMessage = 'a'.repeat(4000)
    const result = validateMessageInput(maxMessage)
    expect(result.valid).toBe(true)
  })
})

describe('enter key behavior', () => {
  it('submits on Enter without Shift', () => {
    expect(shouldSubmitOnEnter({ shiftKey: false })).toBe(true)
  })

  it('does not submit on Shift+Enter', () => {
    expect(shouldSubmitOnEnter({ shiftKey: true })).toBe(false)
  })
})
