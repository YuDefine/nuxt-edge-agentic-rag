import { describe, expect, it, vi } from 'vitest'

import {
  buildConversationSessionStorageKey,
  clearConversationSessionStorage,
} from '~/utils/chat-conversation-state'

function createStorageMock(initial = new Map<string, string>()) {
  return {
    getItem: vi.fn((key: string) => initial.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      initial.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      initial.set(key, value)
    }),
  }
}

describe('clearConversationSessionStorage', () => {
  it('removes the active-conversation key for the given user', () => {
    const initial = new Map<string, string>([
      ['web-chat:active-conversation:user-1', 'conv-1'],
      ['web-chat:active-conversation:user-2', 'conv-2'],
      ['unrelated-key', 'keep-me'],
    ])
    const storage = createStorageMock(initial)

    clearConversationSessionStorage('user-1', storage)

    expect(storage.removeItem).toHaveBeenCalledTimes(1)
    expect(storage.removeItem).toHaveBeenCalledWith(buildConversationSessionStorageKey('user-1'))
    expect(initial.has('web-chat:active-conversation:user-1')).toBe(false)
    expect(initial.get('web-chat:active-conversation:user-2')).toBe('conv-2')
    expect(initial.get('unrelated-key')).toBe('keep-me')
  })

  it('silently swallows storage errors (Safari private mode QuotaExceededError)', () => {
    const storage = {
      getItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError')
      }),
      setItem: vi.fn(),
    }

    expect(() => {
      clearConversationSessionStorage('user-1', storage)
    }).not.toThrow()
    expect(storage.removeItem).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when storage is null (SSR / DOM Storage disabled)', () => {
    expect(() => {
      clearConversationSessionStorage('user-1', null)
    }).not.toThrow()
  })

  it('is a no-op when userId is null (no signed-in user)', () => {
    const storage = createStorageMock()

    clearConversationSessionStorage(null, storage)

    expect(storage.removeItem).not.toHaveBeenCalled()
  })
})
