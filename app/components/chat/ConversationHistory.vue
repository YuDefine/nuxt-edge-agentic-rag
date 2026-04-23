<script setup lang="ts">
  import { toRef } from 'vue'

  import type { ChatConversationSummary, ChatMessage } from '~/types/chat'
  import { useChatConversationHistory } from '~/composables/useChatConversationHistory'
  import { loadChatConversationDetail } from '~/utils/chat-conversation-loader'

  interface Props {
    disabled?: boolean
    refreshKey?: number
    selectedConversationId?: string | null
  }

  const props = withDefaults(defineProps<Props>(), {
    disabled: false,
    refreshKey: 0,
    selectedConversationId: null,
  })

  const emit = defineEmits<{
    'conversation-cleared': []
    'conversation-selected': [
      payload: {
        conversationId: string
        messages: ChatMessage[]
      },
    ]
  }>()

  const { $csrfFetch } = useNuxtApp() as unknown as {
    $csrfFetch: typeof $fetch
  }
  const toast = useToast()

  const history = useChatConversationHistory({
    deleteConversation: async (conversationId) => {
      await $csrfFetch(`/api/conversations/${conversationId}`, { method: 'DELETE' })
    },
    listConversations: async () => {
      const response = await $csrfFetch<{ data: ChatConversationSummary[] }>('/api/conversations')
      return response.data
    },
    loadConversation: (conversationId) => loadChatConversationDetail($csrfFetch, conversationId),
    onConversationCleared: () => emit('conversation-cleared'),
    onHistoryError: ({ action }) => {
      toast.add({
        title: action === 'delete' ? '無法刪除對話' : '無法更新對話列表',
        description: '請稍後再試。',
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
    },
    onConversationLoadError: () => {
      toast.add({
        title: '無法載入對話',
        description: '請稍後再試。',
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
    },
    onConversationSelected: (payload) => emit('conversation-selected', payload),
    selectedConversationId: toRef(props, 'selectedConversationId'),
  })

  async function refreshHistory(): Promise<void> {
    const didRefresh = await history.refresh()
    if (!didRefresh) {
      return
    }

    if (!props.selectedConversationId) {
      return
    }

    const exists = history.conversations.value.some(
      (conversation) => conversation.id === props.selectedConversationId,
    )
    if (exists) {
      return
    }

    const detailResult = await loadChatConversationDetail($csrfFetch, props.selectedConversationId)
    if (detailResult.status === 'missing') {
      emit('conversation-cleared')
    }
  }

  function formatUpdatedAt(value: string): string {
    return new Intl.DateTimeFormat('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value))
  }

  function isSelected(conversationId: string): boolean {
    return props.selectedConversationId === conversationId
  }

  const conversations = computed(() => history.conversations.value)
  const isLoading = computed(() => history.isLoading.value)
  const deleteInFlightId = computed(() => history.deleteInFlightId.value)

  watch(
    () => props.refreshKey,
    async () => {
      await refreshHistory()
    },
    { immediate: true },
  )
</script>

<template>
  <div class="flex h-full min-h-0 flex-col p-4">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-xs font-semibold tracking-wider text-muted uppercase">對話記錄</h2>
      <span v-if="isLoading" class="text-[11px] text-muted">載入中</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="conversations.length === 0 && !isLoading"
        class="rounded-lg border border-dashed border-default bg-accented/40 p-3 text-sm text-muted"
      >
        尚無已保存對話。送出第一個問題後，這裡會出現對話歷史。
      </div>

      <div v-else class="flex flex-col gap-2">
        <div
          v-for="conversation in conversations"
          :key="conversation.id"
          class="flex items-start gap-2 rounded-lg border p-2 transition"
          :class="
            isSelected(conversation.id)
              ? 'border-primary bg-primary/8 shadow-xs'
              : 'border-default bg-accented hover:border-primary/40 hover:bg-elevated'
          "
        >
          <button
            type="button"
            class="min-w-0 flex-1 rounded-md p-1 text-left"
            :disabled="props.disabled"
            @click="history.selectConversation(conversation.id)"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-default">
                {{ conversation.title }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ formatUpdatedAt(conversation.updatedAt) }}
              </p>
            </div>
          </button>

          <button
            type="button"
            class="shrink-0 rounded-md p-2 text-muted transition hover:bg-error/10 hover:text-error"
            :disabled="props.disabled || deleteInFlightId === conversation.id"
            :aria-label="`刪除對話 ${conversation.title}`"
            @click="history.deleteConversationById(conversation.id)"
          >
            <UIcon
              :name="
                deleteInFlightId === conversation.id ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'
              "
              class="size-4"
              :class="deleteInFlightId === conversation.id ? 'animate-spin' : ''"
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
