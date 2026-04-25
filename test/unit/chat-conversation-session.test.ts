import { shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useChatConversationSession } from '~/composables/useChatConversationSession'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

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

describe('useChatConversationSession', () => {
  it('restores the stored conversation for the current user', async () => {
    const storage = createStorageMock(new Map([['web-chat:active-conversation:user-1', 'conv-1']]))
    const userId = shallowRef('user-1')
    const loadConversation = vi.fn().mockResolvedValue({
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
            citationsJson: '[]',
            createdAt: '2026-04-23T08:00:05.000Z',
          },
        ],
      },
    })

    const session = useChatConversationSession({
      loadConversation,
      storage,
      userId,
    })

    await session.restoreActiveConversation()

    expect(loadConversation).toHaveBeenCalledWith('conv-1')
    expect(session.activeConversationId.value).toBe('conv-1')
    expect(session.persistedMessages.value).toEqual([
      {
        id: 'msg-1',
        role: 'assistant',
        content: '先建立請購單。',
        createdAt: '2026-04-23T08:00:05.000Z',
      },
    ])
  })

  it('removes stale stored conversation ids when the conversation is no longer visible', async () => {
    const storage = createStorageMock(
      new Map([['web-chat:active-conversation:user-2', 'conv-missing']]),
    )
    const userId = shallowRef('user-2')
    const loadConversation = vi.fn().mockResolvedValue({ status: 'missing' })

    const session = useChatConversationSession({
      loadConversation,
      storage,
      userId,
    })

    await session.restoreActiveConversation()

    expect(storage.removeItem).toHaveBeenCalledWith('web-chat:active-conversation:user-2')
    expect(session.activeConversationId.value).toBeNull()
    expect(session.persistedMessages.value).toEqual([])
  })

  it('keeps the stored selection when restoring hits a transient load error', async () => {
    const storage = createStorageMock(
      new Map([['web-chat:active-conversation:user-4', 'conv-error']]),
    )
    const userId = shallowRef('user-4')
    const loadConversation = vi.fn().mockResolvedValue({ status: 'error' })

    const session = useChatConversationSession({
      loadConversation,
      storage,
      userId,
    })

    await session.restoreActiveConversation()

    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(session.activeConversationId.value).toBeNull()
    expect(session.persistedMessages.value).toEqual([])
  })

  it('ignores stale restore results after a newer state change', async () => {
    const storage = createStorageMock(new Map([['web-chat:active-conversation:user-5', 'conv-5']]))
    const userId = shallowRef('user-5')
    const deferred = createDeferred<{
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
    const session = useChatConversationSession({
      loadConversation: vi.fn().mockImplementation(() => deferred.promise),
      storage,
      userId,
    })

    const restorePromise = session.restoreActiveConversation()
    session.setActiveConversation({
      conversationId: null,
      messages: [],
    })

    deferred.resolve({
      status: 'found',
      detail: {
        id: 'conv-5',
        title: '舊對話',
        accessLevel: 'internal',
        createdAt: '2026-04-23T08:00:00.000Z',
        updatedAt: '2026-04-23T08:10:00.000Z',
        userProfileId: 'user-5',
        messages: [
          {
            id: 'msg-5',
            role: 'assistant',
            contentRedacted: '這是舊 restore 結果',
            contentText: '這是舊 restore 結果',
            citationsJson: '[]',
            createdAt: '2026-04-23T08:00:05.000Z',
          },
        ],
      },
    })

    await restorePromise

    expect(session.activeConversationId.value).toBeNull()
    expect(session.persistedMessages.value).toEqual([])
  })

  it('persists the active conversation id for the current user', () => {
    const storage = createStorageMock()
    const userId = shallowRef('user-3')
    const session = useChatConversationSession({
      loadConversation: vi.fn(),
      storage,
      userId,
    })

    session.setActiveConversation({
      conversationId: 'conv-3',
      messages: [],
    })

    expect(storage.setItem).toHaveBeenCalledWith('web-chat:active-conversation:user-3', 'conv-3')
    expect(session.activeConversationId.value).toBe('conv-3')
  })

  // Persisted Conversation Session Continuity — reload 折衷邏輯
  it('does not auto-restore when sessionStorage key is absent (post explicit new conversation)', async () => {
    const storage = createStorageMock()
    const userId = shallowRef('user-6')
    const loadConversation = vi.fn()

    const session = useChatConversationSession({
      loadConversation,
      storage,
      userId,
    })

    await session.restoreActiveConversation()

    // 點過新對話按鈕後 sessionStorage 對應 key 已被 clearConversationSessionStorage 清掉，
    // 此時 reload 不應呼叫 loadConversation 也不應 auto-restore 任何舊對話。
    expect(loadConversation).not.toHaveBeenCalled()
    expect(session.activeConversationId.value).toBeNull()
    expect(session.persistedMessages.value).toEqual([])
  })

  // Persisted Conversation Session Continuity — 重度使用者 reload 不退步
  it('still auto-restores when sessionStorage key is present (heavy user not regressed)', async () => {
    const storage = createStorageMock(new Map([['web-chat:active-conversation:user-7', 'conv-7']]))
    const userId = shallowRef('user-7')
    const loadConversation = vi.fn().mockResolvedValue({
      status: 'found',
      detail: {
        id: 'conv-7',
        title: '上一個對話',
        accessLevel: 'internal',
        createdAt: '2026-04-25T01:00:00.000Z',
        updatedAt: '2026-04-25T01:10:00.000Z',
        userProfileId: 'user-7',
        messages: [],
      },
    })

    const session = useChatConversationSession({
      loadConversation,
      storage,
      userId,
    })

    await session.restoreActiveConversation()

    // 沒點過新對話 → key 還在 → reload 仍 auto-restore conv-7
    expect(loadConversation).toHaveBeenCalledWith('conv-7')
    expect(session.activeConversationId.value).toBe('conv-7')
  })
})
