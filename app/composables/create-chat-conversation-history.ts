import type { Ref } from 'vue'

import type { ChatConversationSummary, ChatMessage } from '~/types/chat'
import { loadChatConversationDetail } from '~/utils/chat-conversation-loader'
import {
  type ChatConversationHistoryApi,
  useChatConversationHistory,
} from '~/composables/useChatConversationHistory'

type ToastLike = Pick<ReturnType<typeof useToast>, 'add'>

export interface CreateChatConversationHistoryOptions {
  onConversationSelected: (payload: { conversationId: string; messages: ChatMessage[] }) => void
  onConversationCleared: () => void
  selectedConversationId: Ref<string | null>
  onHistoryError?: (ctx: { action: 'delete' | 'refresh' }) => void
  onConversationLoadError?: () => void
}

export interface ChatConversationHistoryInstance {
  api: ChatConversationHistoryApi
  refreshAndReconcile: (selectedId: string | null) => Promise<void>
}

export function createChatConversationHistory(
  $csrfFetch: typeof $fetch,
  toast: ToastLike,
  options: CreateChatConversationHistoryOptions,
): ChatConversationHistoryInstance {
  const onHistoryError =
    options.onHistoryError ??
    (({ action }) => {
      toast.add({
        title: action === 'delete' ? '無法刪除對話' : '無法更新對話列表',
        description: '請稍後再試。',
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
    })

  const onConversationLoadError =
    options.onConversationLoadError ??
    (() => {
      toast.add({
        title: '無法載入對話',
        description: '請稍後再試。',
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
    })

  const api = useChatConversationHistory({
    deleteConversation: async (conversationId) => {
      await $csrfFetch(`/api/conversations/${conversationId}`, { method: 'DELETE' })
    },
    listConversations: async () => {
      const response = await $csrfFetch<{ data: ChatConversationSummary[] }>('/api/conversations')
      return response.data
    },
    loadConversation: (conversationId) => loadChatConversationDetail($csrfFetch, conversationId),
    onConversationCleared: options.onConversationCleared,
    onConversationLoadError,
    onConversationSelected: options.onConversationSelected,
    onHistoryError,
    selectedConversationId: options.selectedConversationId,
  })

  async function refreshAndReconcile(selectedId: string | null): Promise<void> {
    const didRefresh = await api.refresh()
    if (!didRefresh) {
      return
    }

    if (!selectedId) {
      return
    }

    const exists = api.conversations.value.some((conversation) => conversation.id === selectedId)
    if (exists) {
      return
    }

    const detailResult = await loadChatConversationDetail($csrfFetch, selectedId)
    if (detailResult.status === 'missing') {
      options.onConversationCleared()
    }
  }

  return { api, refreshAndReconcile }
}
