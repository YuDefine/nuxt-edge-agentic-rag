<script setup lang="ts">
  import { toRef } from 'vue'

  import type { ChatConversationSummary, ChatMessage } from '~/types/chat'
  import { useChatConversationHistory } from '~/composables/useChatConversationHistory'
  import type { ConversationRecencyBucket } from '~/utils/conversation-grouping'
  import { loadChatConversationDetail } from '~/utils/chat-conversation-loader'
  import { groupConversationsByRecency } from '~/utils/conversation-grouping'

  interface Props {
    collapsed?: boolean
    disabled?: boolean
    onExpandRequest?: () => void
    refreshKey?: number
    selectedConversationId?: string | null
  }

  const props = withDefaults(defineProps<Props>(), {
    collapsed: false,
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
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return '時間未知'
    }

    return new Intl.DateTimeFormat('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  }

  function isSelected(conversationId: string): boolean {
    return props.selectedConversationId === conversationId
  }

  function requestExpand(): void {
    props.onExpandRequest?.()
  }

  const bucketOpenState = ref<Record<ConversationRecencyBucket, boolean>>({
    today: true,
    yesterday: true,
    thisWeek: true,
    thisMonth: false,
    earlier: false,
  })
  const conversations = computed(() => history.conversations.value)
  const groupedConversations = computed(() =>
    groupConversationsByRecency(conversations.value, new Date()),
  )
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
  <div v-if="props.collapsed" class="flex h-full min-h-0 flex-col items-center px-1 py-3">
    <button
      data-testid="conversation-history-rail"
      type="button"
      class="flex w-full cursor-pointer flex-col items-center gap-2 rounded-md p-1.5 text-muted transition hover:bg-accented hover:text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none motion-reduce:transition-none"
      aria-label="展開對話記錄"
      @click="requestExpand"
    >
      <UIcon name="i-lucide-history" class="size-5" aria-hidden="true" />
      <UBadge
        v-if="conversations.length > 0"
        color="neutral"
        variant="subtle"
        size="xs"
        class="min-w-5 justify-center px-1"
      >
        {{ conversations.length }}
      </UBadge>
    </button>

    <UButton
      icon="i-lucide-plus"
      variant="ghost"
      color="neutral"
      size="xs"
      aria-label="新增對話"
      class="mt-2"
      @click="requestExpand"
    />
  </div>

  <div v-else class="flex h-full min-h-0 flex-col p-4">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-xs font-semibold tracking-wider text-muted uppercase">對話記錄</h2>
      <div class="flex items-center gap-1">
        <span v-if="isLoading" class="text-[11px] text-muted">載入中</span>
        <slot name="header-action" />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="conversations.length === 0 && !isLoading"
        class="rounded-lg border border-dashed border-default bg-accented/40 p-3 text-sm text-muted"
      >
        尚無已保存對話。送出第一個問題後，這裡會出現對話歷史。
      </div>

      <div v-else class="flex flex-col gap-2">
        <UCollapsible
          v-for="group in groupedConversations"
          :key="group.bucket"
          :open="bucketOpenState[group.bucket]"
          :unmount-on-hide="true"
          @update:open="bucketOpenState[group.bucket] = $event"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted transition hover:bg-accented hover:text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 transition-transform duration-200"
              :class="bucketOpenState[group.bucket] ? 'rotate-90' : ''"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate">{{ group.label }}</span>
            <UBadge color="neutral" variant="subtle" size="xs">
              {{ group.conversations.length }}
            </UBadge>
          </button>

          <template #content>
            <div class="mt-1 flex flex-col gap-2">
              <div
                v-for="conversation in group.conversations"
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
                  data-testid="conversation-row-button"
                  class="min-w-0 flex-1 rounded-md p-1 text-left"
                  :disabled="props.disabled"
                  @click="history.selectConversation(conversation.id)"
                >
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-default">
                      {{ conversation.title }}
                    </p>
                    <p class="mt-1 text-xs text-toned">
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
                      deleteInFlightId === conversation.id
                        ? 'i-lucide-loader-circle'
                        : 'i-lucide-trash-2'
                    "
                    class="size-4"
                    :class="deleteInFlightId === conversation.id ? 'animate-spin' : ''"
                  />
                </button>
              </div>
            </div>
          </template>
        </UCollapsible>
      </div>
    </div>
  </div>
</template>
