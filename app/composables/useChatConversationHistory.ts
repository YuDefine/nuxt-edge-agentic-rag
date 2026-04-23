import { shallowRef } from 'vue'
import type { InjectionKey, Ref } from 'vue'

import type { ChatConversationLoadResult, ChatConversationSummary, ChatMessage } from '~/types/chat'
import { mapConversationDetailToChatMessages } from '~/utils/chat-conversation-state'

export type ChatConversationHistoryApi = ReturnType<typeof useChatConversationHistory>

export const ChatConversationHistoryInjectionKey = Symbol(
  'ChatConversationHistory',
) as InjectionKey<ChatConversationHistoryApi>

export function useChatConversationHistory(input: {
  listConversations: () => Promise<ChatConversationSummary[]>
  loadConversation: (conversationId: string) => Promise<ChatConversationLoadResult>
  deleteConversation: (conversationId: string) => Promise<void>
  selectedConversationId: Ref<string | null>
  onConversationSelected?: (payload: { conversationId: string; messages: ChatMessage[] }) => void
  onConversationCleared?: () => void
  onHistoryError?: (payload: { action: 'delete' | 'refresh' }) => void
  onConversationLoadError?: () => void
}) {
  const conversations = shallowRef<ChatConversationSummary[]>([])
  const isLoading = shallowRef(false)
  const deleteInFlightId = shallowRef<string | null>(null)
  let selectionVersion = 0

  async function refresh(): Promise<boolean> {
    isLoading.value = true
    try {
      conversations.value = await input.listConversations()
      return true
    } catch {
      input.onHistoryError?.({ action: 'refresh' })
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function selectConversation(conversationId: string): Promise<void> {
    const currentSelectionVersion = ++selectionVersion
    const result = await input.loadConversation(conversationId)
    if (currentSelectionVersion !== selectionVersion) {
      return
    }

    if (result.status === 'missing') {
      if (input.selectedConversationId.value === conversationId) {
        input.onConversationCleared?.()
      }
      return
    }

    if (result.status === 'error') {
      input.onConversationLoadError?.()
      return
    }

    input.onConversationSelected?.({
      conversationId: result.detail.id,
      messages: mapConversationDetailToChatMessages(result.detail),
    })
  }

  async function deleteConversationById(conversationId: string): Promise<boolean> {
    deleteInFlightId.value = conversationId
    try {
      await input.deleteConversation(conversationId)
      const didRefresh = await refresh()
      if (!didRefresh) {
        return false
      }

      if (input.selectedConversationId.value === conversationId) {
        input.onConversationCleared?.()
      }
      return true
    } catch {
      input.onHistoryError?.({ action: 'delete' })
      return false
    } finally {
      deleteInFlightId.value = null
    }
  }

  return {
    conversations,
    deleteConversationById,
    deleteInFlightId,
    isLoading,
    refresh,
    selectConversation,
  }
}
