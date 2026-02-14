import { describe, expect, it } from 'vitest'

import { assertNever } from '~/utils/assert-never'

/**
 * Message role types for chat UI
 */
type MessageRole = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  refused?: boolean
  citations?: Array<{ citationId: string; sourceChunkId: string }>
  createdAt: string
}

/**
 * Get message display configuration based on role
 */
function getMessageRoleConfig(role: MessageRole): {
  alignment: 'left' | 'right'
  bgClass: string
  label: string
} {
  switch (role) {
    case 'user':
      return {
        alignment: 'right',
        bgClass: 'bg-primary-50 dark:bg-primary-950',
        label: '您',
      }
    case 'assistant':
      return {
        alignment: 'left',
        bgClass: 'bg-neutral-50 dark:bg-neutral-900',
        label: '助理',
      }
    default:
      return assertNever(role, 'getMessageRoleConfig')
  }
}

/**
 * Check if a message is a refusal
 */
function isRefusalMessage(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.refused === true
}

/**
 * Check if a message has citations
 */
function hasCitations(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    !message.refused &&
    Array.isArray(message.citations) &&
    message.citations.length > 0
  )
}

describe('message role configuration', () => {
  it('returns correct config for user messages', () => {
    const config = getMessageRoleConfig('user')
    expect(config.alignment).toBe('right')
    expect(config.label).toBe('您')
  })

  it('returns correct config for assistant messages', () => {
    const config = getMessageRoleConfig('assistant')
    expect(config.alignment).toBe('left')
    expect(config.label).toBe('助理')
  })
})

describe('refusal detection', () => {
  it('identifies refusal messages', () => {
    const refusalMessage: ChatMessage = {
      id: '1',
      role: 'assistant',
      content: '抱歉，我無法回答這個問題。',
      refused: true,
      createdAt: '2024-01-01T00:00:00Z',
    }
    expect(isRefusalMessage(refusalMessage)).toBe(true)
  })

  it('does not mark successful assistant messages as refusal', () => {
    const successMessage: ChatMessage = {
      id: '2',
      role: 'assistant',
      content: '這是一個正常的回答。',
      refused: false,
      citations: [{ citationId: 'c1', sourceChunkId: 's1' }],
      createdAt: '2024-01-01T00:00:00Z',
    }
    expect(isRefusalMessage(successMessage)).toBe(false)
  })

  it('does not mark user messages as refusal', () => {
    const userMessage: ChatMessage = {
      id: '3',
      role: 'user',
      content: '你好',
      createdAt: '2024-01-01T00:00:00Z',
    }
    expect(isRefusalMessage(userMessage)).toBe(false)
  })
})

describe('citation detection', () => {
  it('detects messages with citations', () => {
    const messageWithCitations: ChatMessage = {
      id: '1',
      role: 'assistant',
      content: '這是回答 [1]',
      refused: false,
      citations: [{ citationId: 'c1', sourceChunkId: 's1' }],
      createdAt: '2024-01-01T00:00:00Z',
    }
    expect(hasCitations(messageWithCitations)).toBe(true)
  })

  it('refusal messages have no citations even if array exists', () => {
    const refusalWithCitations: ChatMessage = {
      id: '2',
      role: 'assistant',
      content: '抱歉',
      refused: true,
      citations: [],
      createdAt: '2024-01-01T00:00:00Z',
    }
    expect(hasCitations(refusalWithCitations)).toBe(false)
  })

  it('user messages never have citations', () => {
    const userMessage: ChatMessage = {
      id: '3',
      role: 'user',
      content: '你好',
      createdAt: '2024-01-01T00:00:00Z',
    }
    expect(hasCitations(userMessage)).toBe(false)
  })

  it('assistant messages without citations array return false', () => {
    const messageNoCitations: ChatMessage = {
      id: '4',
      role: 'assistant',
      content: '回答',
      refused: false,
      createdAt: '2024-01-01T00:00:00Z',
    }
    expect(hasCitations(messageNoCitations)).toBe(false)
  })
})
