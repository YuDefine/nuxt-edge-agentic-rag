<script setup lang="ts">
  import type { ChatMessage } from '~/types/chat'

  import { createChatConversationHistory } from '~/composables/create-chat-conversation-history'
  import { ChatConversationHistoryInjectionKey } from '~/composables/useChatConversationHistory'
  import { useChatConversationSession } from '~/composables/useChatConversationSession'
  import { loadChatConversationDetail } from '~/utils/chat-conversation-loader'
  import { clearConversationSessionStorage } from '~/utils/chat-conversation-state'

  /**
   * Home page — chat UI. Authentication is required; unauthenticated
   * visitors are captured by the global auth middleware and redirected
   * to `/auth/login` (see `auth-redirect` capability).
   */
  definePageMeta({
    layout: 'chat',
  })

  const { user } = useUserSession()
  const { $csrfFetch } = useNuxtApp() as unknown as {
    $csrfFetch: typeof $fetch
  }

  // responsive-and-a11y-foundation §3.3 — chat-history drawer state is
  // shared with the chat layout header toggle via `useLayoutDrawer`.
  const historyDrawer = useLayoutDrawer('chat-history')

  const conversationInteractionLocked = shallowRef(false)
  const historyRefreshKey = shallowRef(0)
  const sidebarCollapsed = useLocalStorage('chat:history-sidebar:collapsed', false, {
    onError: () => {},
  })

  const conversationSession = useChatConversationSession({
    userId: computed(() => user.value?.id ?? null),
    loadConversation: (conversationId) => loadChatConversationDetail($csrfFetch, conversationId),
    storage: import.meta.client ? sessionStorage : null,
  })
  const activeConversationId = computed(() => conversationSession.activeConversationId.value)
  const persistedMessages = computed(() => conversationSession.persistedMessages.value)

  const toast = useToast()

  // Hoist the conversation history composable once at the page level so both
  // the inline sidebar (lg+) and the off-canvas drawer (< lg) read from one
  // state instance and only trigger a single GET /api/conversations on entry.
  const conversationHistory = createChatConversationHistory($csrfFetch, toast, {
    onConversationCleared: () => handleConversationCleared(),
    onConversationSelected: (payload) => handleConversationSelected(payload),
    selectedConversationId: activeConversationId,
  })

  provide(ChatConversationHistoryInjectionKey, conversationHistory.api)

  watch(
    historyRefreshKey,
    async () => {
      await conversationHistory.refreshAndReconcile(activeConversationId.value)
    },
    { immediate: true },
  )

  function handleConversationPersisted(payload: {
    conversationId: string
    conversationCreated: boolean
    messages: ChatMessage[]
  }) {
    conversationSession.setActiveConversation({
      conversationId: payload.conversationId,
      messages: payload.messages,
    })
    if (payload.conversationCreated) {
      historyRefreshKey.value += 1
    }
  }

  function handleConversationSelected(payload: {
    conversationId: string
    messages: ChatMessage[]
  }) {
    conversationSession.setActiveConversation({
      conversationId: payload.conversationId,
      messages: payload.messages,
    })
    historyDrawer.close()
  }

  function handleConversationCleared() {
    conversationSession.setActiveConversation({
      conversationId: null,
      messages: [],
    })
  }

  function handleNewConversationRequest() {
    handleConversationCleared()
    if (import.meta.client) {
      clearConversationSessionStorage(user.value?.id ?? null, sessionStorage)
    }
    historyDrawer.close()
  }

  function handleConversationBusyChange(isBusy: boolean) {
    conversationInteractionLocked.value = isBusy
  }

  function collapseHistorySidebar() {
    sidebarCollapsed.value = true
  }

  function expandHistorySidebar() {
    sidebarCollapsed.value = false
  }

  watch(
    computed(() => user.value?.id ?? null),
    async (userId) => {
      if (!userId) {
        conversationSession.setActiveConversation({
          conversationId: null,
          messages: [],
        })
        return
      }

      await conversationSession.restoreActiveConversation()
    },
    { immediate: true },
  )
</script>

<template>
  <LazyChatGuestAccessGate>
    <template #default="{ canAsk }">
      <!-- responsive-and-a11y-foundation §5.5 — two-column on lg, stacked on < lg.
           `< lg` conversation history is reachable via the chat-layout drawer
           toggle; sidebar is hidden below that breakpoint to keep the chat
           column full-width for phones / small tablets. -->
      <div class="flex h-[calc(100dvh-4rem)] min-h-0 gap-0">
        <aside
          class="hidden shrink-0 border-r border-default transition-[width] duration-200 motion-reduce:transition-none lg:flex lg:flex-col"
          :class="sidebarCollapsed ? 'lg:w-12' : 'lg:w-64'"
          :aria-label="sidebarCollapsed ? '對話記錄（已收合）' : '對話記錄'"
        >
          <div v-if="sidebarCollapsed" class="flex justify-center pt-3">
            <LazyUTooltip text="展開對話記錄">
              <UButton
                data-testid="chat-history-expand-toggle"
                variant="ghost"
                color="neutral"
                size="xs"
                icon="i-lucide-panel-left-open"
                aria-label="展開對話記錄"
                @click="expandHistorySidebar"
              />
            </LazyUTooltip>
          </div>

          <LazyChatConversationHistory
            :collapsed="sidebarCollapsed"
            :disabled="conversationInteractionLocked"
            :refresh-key="historyRefreshKey"
            :selected-conversation-id="activeConversationId"
            @conversation-cleared="handleConversationCleared"
            @conversation-selected="handleConversationSelected"
            @expand-request="expandHistorySidebar"
            @new-conversation-request="handleNewConversationRequest"
          >
            <template #header-action>
              <UButton
                v-if="!sidebarCollapsed"
                variant="ghost"
                color="neutral"
                size="xs"
                icon="i-lucide-panel-left-close"
                aria-label="收合對話記錄"
                @click="collapseHistorySidebar"
              />
            </template>
          </LazyChatConversationHistory>
        </aside>

        <!-- Chat column. Parent chat layout owns the `<main>` landmark,
             so this is a `section` to avoid a nested-main a11y error. -->
        <section class="flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="知識庫問答">
          <div class="flex items-center justify-between border-b border-default px-3 py-3 md:px-4">
            <div class="min-w-0">
              <h1 class="text-base font-semibold text-default md:text-lg">知識庫問答</h1>
              <p class="hidden text-xs text-muted md:block">
                向知識庫提問，獲取準確的答案與引用來源
              </p>
            </div>
            <UButton
              data-testid="chat-header-new-conversation-button"
              icon="i-lucide-message-circle-plus"
              variant="soft"
              color="primary"
              size="sm"
              aria-label="新對話"
              :disabled="conversationInteractionLocked"
              @click="handleNewConversationRequest"
            >
              <!-- persist-refusal-and-label-new-chat: visible label MUST
                   stay across all viewports per web-chat-ui spec. The icon
                   collapses first if width pressure forces a tradeoff —
                   never the label. -->
              新對話
            </UButton>
          </div>

          <LazyChatContainer
            class="flex-1"
            :disabled="!canAsk"
            :active-conversation-id="activeConversationId"
            :initial-messages="persistedMessages"
            @busy-change="handleConversationBusyChange"
            @conversation-persisted="handleConversationPersisted"
          />
        </section>
      </div>

      <!-- < lg chat-history drawer -->
      <LazyUSlideover
        v-model:open="historyDrawer.isOpen.value"
        side="left"
        title="對話記錄"
        :ui="{ content: 'lg:hidden' }"
      >
        <template #body>
          <div
            id="chat-history-drawer"
            class="h-full"
            role="navigation"
            aria-label="對話記錄（抽屜）"
          >
            <LazyChatConversationHistory
              :disabled="conversationInteractionLocked"
              :refresh-key="historyRefreshKey"
              :selected-conversation-id="activeConversationId"
              @conversation-cleared="handleConversationCleared"
              @conversation-selected="handleConversationSelected"
              @new-conversation-request="handleNewConversationRequest"
            />
          </div>
        </template>
      </LazyUSlideover>
    </template>
  </LazyChatGuestAccessGate>
</template>
