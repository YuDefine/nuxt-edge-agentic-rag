import { shallowRef } from 'vue'
import type { Ref } from 'vue'

import type { ChatConversationLoadResult, ChatMessage } from '~/types/chat'
import {
  buildConversationSessionStorageKey,
  mapConversationDetailToChatMessages,
} from '~/utils/chat-conversation-state'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function useChatConversationSession(input: {
  userId: Ref<string | null>
  loadConversation: (conversationId: string) => Promise<ChatConversationLoadResult>
  storage?: StorageLike | null
}) {
  const activeConversationId = shallowRef<string | null>(null)
  const persistedMessages = shallowRef<ChatMessage[]>([])
  let restoreVersion = 0

  function getStorageKey(): string | null {
    if (!input.userId.value) {
      return null
    }

    return buildConversationSessionStorageKey(input.userId.value)
  }

  function clearPersistedSelection(storageKey = getStorageKey()): void {
    if (storageKey && input.storage) {
      input.storage.removeItem(storageKey)
    }
  }

  function applyActiveConversation(inputValue: {
    conversationId: string | null
    messages: ChatMessage[]
  }): void {
    activeConversationId.value = inputValue.conversationId
    persistedMessages.value = [...inputValue.messages]

    const storageKey = getStorageKey()
    if (!storageKey || !input.storage) {
      return
    }

    if (!inputValue.conversationId) {
      input.storage.removeItem(storageKey)
      return
    }

    input.storage.setItem(storageKey, inputValue.conversationId)
  }

  function setActiveConversation(inputValue: {
    conversationId: string | null
    messages: ChatMessage[]
  }): void {
    restoreVersion += 1
    applyActiveConversation(inputValue)
  }

  async function restoreActiveConversation(): Promise<void> {
    const currentRestoreVersion = ++restoreVersion
    const storageKey = getStorageKey()
    if (!storageKey || !input.storage) {
      applyActiveConversation({ conversationId: null, messages: [] })
      return
    }

    const storedConversationId = input.storage.getItem(storageKey)
    if (!storedConversationId) {
      applyActiveConversation({ conversationId: null, messages: [] })
      return
    }

    const result = await input.loadConversation(storedConversationId)
    if (currentRestoreVersion !== restoreVersion) {
      return
    }

    if (result.status === 'missing') {
      clearPersistedSelection(storageKey)
      applyActiveConversation({ conversationId: null, messages: [] })
      return
    }

    if (result.status === 'error') {
      activeConversationId.value = null
      persistedMessages.value = []
      return
    }

    applyActiveConversation({
      conversationId: result.detail.id,
      messages: mapConversationDetailToChatMessages(result.detail),
    })
  }

  return {
    activeConversationId,
    persistedMessages,
    restoreActiveConversation,
    setActiveConversation,
  }
}
