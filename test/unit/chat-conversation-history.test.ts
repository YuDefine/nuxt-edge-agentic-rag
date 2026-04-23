import { shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useChatConversationHistory } from '~/composables/useChatConversationHistory'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

describe('useChatConversationHistory', () => {
  it('loads persisted conversation summaries from the server', async () => {
    const listConversations = vi.fn().mockResolvedValue([
      {
        id: 'conv-2',
        title: '第二段對話',
        accessLevel: 'internal',
        createdAt: '2026-04-23T08:00:00.000Z',
        updatedAt: '2026-04-23T08:10:00.000Z',
        userProfileId: 'user-1',
      },
    ])

    const history = useChatConversationHistory({
      deleteConversation: vi.fn(),
      listConversations,
      loadConversation: vi.fn(),
      selectedConversationId: shallowRef<string | null>(null),
    })

    await history.refresh()

    expect(listConversations).toHaveBeenCalledTimes(1)
    expect(history.conversations.value.map((conversation) => conversation.id)).toEqual(['conv-2'])
  })

  it('loads persisted messages when a conversation is selected', async () => {
    const onConversationSelected = vi.fn()
    const history = useChatConversationHistory({
      deleteConversation: vi.fn(),
      listConversations: vi.fn().mockResolvedValue([]),
      loadConversation: vi.fn().mockResolvedValue({
        status: 'found',
        detail: {
          id: 'conv-1',
          title: '採購流程',
          accessLevel: 'internal',
          createdAt: '2026-04-23T08:00:00.000Z',
          updatedAt: '2026-04-23T08:10:00.000Z',
          userProfileId: 'user-1',
          messages: [
            {
              id: 'msg-1',
              role: 'assistant',
              contentRedacted: '先建立請購單。',
              contentText: '先建立請購單。',
              citationsJson: '[{"citationId":"cit-1","sourceChunkId":"chunk-1"}]',
              createdAt: '2026-04-23T08:00:05.000Z',
            },
          ],
        },
      }),
      onConversationSelected,
      selectedConversationId: shallowRef<string | null>(null),
    })

    await history.selectConversation('conv-1')

    expect(onConversationSelected).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          content: '先建立請購單。',
          citations: [{ citationId: 'cit-1', sourceChunkId: 'chunk-1' }],
          createdAt: '2026-04-23T08:00:05.000Z',
        },
      ],
    })
  })

  it('clears the active selection when the selected conversation is deleted', async () => {
    const onConversationCleared = vi.fn()
    const selectedConversationId = shallowRef<string | null>('conv-1')
    const history = useChatConversationHistory({
      deleteConversation: vi.fn().mockResolvedValue(undefined),
      listConversations: vi.fn().mockResolvedValue([]),
      loadConversation: vi.fn(),
      onConversationCleared,
      selectedConversationId,
    })

    await history.deleteConversationById('conv-1')

    expect(onConversationCleared).toHaveBeenCalledTimes(1)
    expect(history.conversations.value).toEqual([])
  })

  it('does not clear or overwrite the active selection when loading a conversation fails transiently', async () => {
    const onConversationCleared = vi.fn()
    const onConversationSelected = vi.fn()
    const history = useChatConversationHistory({
      deleteConversation: vi.fn(),
      listConversations: vi.fn().mockResolvedValue([]),
      loadConversation: vi.fn().mockResolvedValue({ status: 'error' }),
      onConversationCleared,
      onConversationSelected,
      selectedConversationId: shallowRef<string | null>('conv-err'),
    })

    await history.selectConversation('conv-err')

    expect(onConversationCleared).not.toHaveBeenCalled()
    expect(onConversationSelected).not.toHaveBeenCalled()
  })

  it('keeps the latest clicked conversation when detail responses resolve out of order', async () => {
    const onConversationSelected = vi.fn()
    const deferredA = createDeferred<{
      detail: {
        id: string
        title: string
        accessLevel: string
        createdAt: string
        updatedAt: string
        userProfileId: string | null
        messages: Array<{
          id: string
          role: 'assistant'
          contentRedacted: string
          contentText: string | null
          citationsJson: string
          createdAt: string
        }>
      }
      status: 'found'
    }>()
    const deferredB = createDeferred<{
      detail: {
        id: string
        title: string
        accessLevel: string
        createdAt: string
        updatedAt: string
        userProfileId: string | null
        messages: Array<{
          id: string
          role: 'assistant'
          contentRedacted: string
          contentText: string | null
          citationsJson: string
          createdAt: string
        }>
      }
      status: 'found'
    }>()
    const loadConversation = vi.fn((conversationId: string) =>
      conversationId === 'conv-a' ? deferredA.promise : deferredB.promise,
    )
    const history = useChatConversationHistory({
      deleteConversation: vi.fn(),
      listConversations: vi.fn().mockResolvedValue([]),
      loadConversation,
      onConversationSelected,
      selectedConversationId: shallowRef<string | null>(null),
    })

    const firstSelection = history.selectConversation('conv-a')
    const secondSelection = history.selectConversation('conv-b')

    deferredB.resolve({
      status: 'found',
      detail: {
        id: 'conv-b',
        title: '對話 B',
        accessLevel: 'internal',
        createdAt: '2026-04-23T08:00:00.000Z',
        updatedAt: '2026-04-23T08:10:00.000Z',
        userProfileId: 'user-1',
        messages: [],
      },
    })
    await secondSelection

    deferredA.resolve({
      status: 'found',
      detail: {
        id: 'conv-a',
        title: '對話 A',
        accessLevel: 'internal',
        createdAt: '2026-04-23T08:00:00.000Z',
        updatedAt: '2026-04-23T08:10:00.000Z',
        userProfileId: 'user-1',
        messages: [],
      },
    })
    await firstSelection

    expect(onConversationSelected).toHaveBeenCalledTimes(1)
    expect(onConversationSelected).toHaveBeenCalledWith({
      conversationId: 'conv-b',
      messages: [],
    })
  })

  it('surfaces refresh failures without throwing', async () => {
    const onHistoryError = vi.fn()
    const history = useChatConversationHistory({
      deleteConversation: vi.fn(),
      listConversations: vi.fn().mockRejectedValue(new Error('refresh failed')),
      loadConversation: vi.fn(),
      onHistoryError,
      selectedConversationId: shallowRef<string | null>(null),
    })

    await expect(history.refresh()).resolves.toBe(false)

    expect(onHistoryError).toHaveBeenCalledWith({ action: 'refresh' })
    expect(history.isLoading.value).toBe(false)
  })

  it('surfaces delete failures without throwing or clearing selection', async () => {
    const onConversationCleared = vi.fn()
    const onHistoryError = vi.fn()
    const history = useChatConversationHistory({
      deleteConversation: vi.fn().mockRejectedValue(new Error('delete failed')),
      listConversations: vi.fn().mockResolvedValue([]),
      loadConversation: vi.fn(),
      onConversationCleared,
      onHistoryError,
      selectedConversationId: shallowRef<string | null>('conv-1'),
    })

    await expect(history.deleteConversationById('conv-1')).resolves.toBe(false)

    expect(onConversationCleared).not.toHaveBeenCalled()
    expect(onHistoryError).toHaveBeenCalledWith({ action: 'delete' })
    expect(history.deleteInFlightId.value).toBeNull()
  })
})
