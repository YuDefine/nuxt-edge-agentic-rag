import { shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { createChatConversationHistory } from '~/composables/create-chat-conversation-history'
import type { ChatConversationSummary } from '~/types/chat'

function createToastStub() {
  return { add: vi.fn() }
}

function createSummary(id: string): ChatConversationSummary {
  return {
    id,
    title: `對話 ${id}`,
    accessLevel: 'internal',
    createdAt: '2026-04-23T08:00:00.000Z',
    updatedAt: '2026-04-23T08:10:00.000Z',
    userProfileId: 'user-1',
  }
}

function createCsrfFetch(handler: (url: string, init?: { method?: string }) => unknown) {
  return ((url: string, init?: { method?: string }) => {
    const result = handler(url, init)
    return Promise.resolve(result)
  }) as unknown as typeof $fetch
}

describe('createChatConversationHistory · refreshAndReconcile', () => {
  it('leaves active selection untouched when it is still present after refresh', async () => {
    const summaries = [createSummary('conv-a'), createSummary('conv-b')]
    const csrfFetch = vi.fn(
      createCsrfFetch((url) => {
        if (url === '/api/conversations') {
          return { data: summaries }
        }
        throw new Error(`unexpected url: ${url}`)
      }),
    )
    const onConversationCleared = vi.fn()
    const selectedConversationId = shallowRef<string | null>('conv-a')

    const instance = createChatConversationHistory(csrfFetch, createToastStub(), {
      onConversationSelected: vi.fn(),
      onConversationCleared,
      selectedConversationId,
    })

    await instance.refreshAndReconcile('conv-a')

    expect(csrfFetch).toHaveBeenCalledTimes(1)
    expect(csrfFetch).toHaveBeenCalledWith('/api/conversations')
    expect(onConversationCleared).not.toHaveBeenCalled()
  })

  it('fetches detail once and keeps selection when active id is missing but still loadable', async () => {
    const summaries = [createSummary('conv-b')]
    const csrfFetch = vi.fn(
      createCsrfFetch((url) => {
        if (url === '/api/conversations') {
          return { data: summaries }
        }
        if (url === '/api/conversations/conv-a') {
          return {
            data: {
              ...createSummary('conv-a'),
              messages: [],
            },
          }
        }
        throw new Error(`unexpected url: ${url}`)
      }),
    )
    const onConversationCleared = vi.fn()
    const selectedConversationId = shallowRef<string | null>('conv-a')

    const instance = createChatConversationHistory(csrfFetch, createToastStub(), {
      onConversationSelected: vi.fn(),
      onConversationCleared,
      selectedConversationId,
    })

    await instance.refreshAndReconcile('conv-a')

    expect(csrfFetch).toHaveBeenCalledTimes(2)
    expect(csrfFetch).toHaveBeenNthCalledWith(1, '/api/conversations')
    expect(csrfFetch).toHaveBeenNthCalledWith(2, '/api/conversations/conv-a')
    expect(onConversationCleared).not.toHaveBeenCalled()
  })

  it('emits conversation-cleared exactly once when active id is missing and detail returns 404', async () => {
    const summaries = [createSummary('conv-b')]
    const csrfFetch = vi.fn((url: string) => {
      if (url === '/api/conversations') {
        return Promise.resolve({ data: summaries })
      }
      if (url === '/api/conversations/conv-a') {
        return Promise.reject(Object.assign(new Error('not found'), { status: 404 }))
      }
      return Promise.reject(new Error(`unexpected url: ${url}`))
    }) as unknown as typeof $fetch
    const onConversationCleared = vi.fn()
    const selectedConversationId = shallowRef<string | null>('conv-a')

    const instance = createChatConversationHistory(csrfFetch, createToastStub(), {
      onConversationSelected: vi.fn(),
      onConversationCleared,
      selectedConversationId,
    })

    await instance.refreshAndReconcile('conv-a')

    expect(onConversationCleared).toHaveBeenCalledTimes(1)
  })

  it('does not issue detail fetch nor emit cleared when there is no active conversation', async () => {
    const summaries = [createSummary('conv-a')]
    const csrfFetch = vi.fn(
      createCsrfFetch((url) => {
        if (url === '/api/conversations') {
          return { data: summaries }
        }
        throw new Error(`unexpected url: ${url}`)
      }),
    )
    const onConversationCleared = vi.fn()
    const selectedConversationId = shallowRef<string | null>(null)

    const instance = createChatConversationHistory(csrfFetch, createToastStub(), {
      onConversationSelected: vi.fn(),
      onConversationCleared,
      selectedConversationId,
    })

    await instance.refreshAndReconcile(null)

    expect(csrfFetch).toHaveBeenCalledTimes(1)
    expect(csrfFetch).toHaveBeenCalledWith('/api/conversations')
    expect(onConversationCleared).not.toHaveBeenCalled()
  })
})

describe('createChatConversationHistory · default toast fallbacks', () => {
  it('falls back to default delete/refresh toast when onHistoryError is omitted', async () => {
    const csrfFetch = vi.fn((url: string) => {
      if (url === '/api/conversations') {
        return Promise.reject(new Error('boom'))
      }
      return Promise.reject(new Error(`unexpected url: ${url}`))
    }) as unknown as typeof $fetch
    const toast = createToastStub()
    const selectedConversationId = shallowRef<string | null>(null)

    const instance = createChatConversationHistory(csrfFetch, toast, {
      onConversationSelected: vi.fn(),
      onConversationCleared: vi.fn(),
      selectedConversationId,
    })

    await instance.api.refresh()

    expect(toast.add).toHaveBeenCalledTimes(1)
    expect(toast.add).toHaveBeenCalledWith({
      title: '無法更新對話列表',
      description: '請稍後再試。',
      color: 'error',
      icon: 'i-lucide-alert-circle',
    })
  })

  it('falls back to default load-error toast when onConversationLoadError is omitted', async () => {
    const csrfFetch = vi.fn((url: string) => {
      if (url === '/api/conversations/conv-a') {
        return Promise.reject(Object.assign(new Error('server error'), { status: 500 }))
      }
      return Promise.reject(new Error(`unexpected url: ${url}`))
    }) as unknown as typeof $fetch
    const toast = createToastStub()
    const selectedConversationId = shallowRef<string | null>(null)

    const instance = createChatConversationHistory(csrfFetch, toast, {
      onConversationSelected: vi.fn(),
      onConversationCleared: vi.fn(),
      selectedConversationId,
    })

    await instance.api.selectConversation('conv-a')

    expect(toast.add).toHaveBeenCalledTimes(1)
    expect(toast.add).toHaveBeenCalledWith({
      title: '無法載入對話',
      description: '請稍後再試。',
      color: 'error',
      icon: 'i-lucide-alert-circle',
    })
  })
})
