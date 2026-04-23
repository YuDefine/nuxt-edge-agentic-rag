<script setup lang="ts">
  import type { ChatMessage } from '~/types/chat'

  import { useChatConversationSession } from '~/composables/useChatConversationSession'
  import { loadChatConversationDetail } from '~/utils/chat-conversation-loader'

  /**
   * Home page - shows login when signed out, chat when signed in.
   */
  definePageMeta({
    auth: false, // Public page, handles its own auth state
    layout: false, // Manually handle layout switching
  })

  const { loggedIn, signIn, fetchSession, user } = useUserSession()
  const { parseAuthError } = useAuthError()
  const { $csrfFetch } = useNuxtApp() as unknown as {
    $csrfFetch: typeof $fetch
  }
  // `describePasskeyError` comes from `app/utils/passkey-error.ts` which
  // Nuxt auto-imports. Never surface raw plugin / browser English messages
  // to the UI — always route errors through this helper.

  // passkey-authentication / Decision 4 — UI-side feature flag mirror.
  // When off, no passkey buttons render; Google remains the only login
  // surface, matching v1.0.0 production defaults.
  const runtimeConfig = useRuntimeConfig()
  const passkeyFeatureEnabled = computed<boolean>(
    () => runtimeConfig.public?.knowledge?.features?.passkey === true,
  )

  // responsive-and-a11y-foundation §3.3 — chat-history drawer state is
  // shared with the chat layout header toggle via `useLayoutDrawer`.
  const historyDrawer = useLayoutDrawer('chat-history')

  const socialLoading = shallowRef(false)
  const passkeyLoginLoading = shallowRef(false)
  const errorMessage = shallowRef('')
  const registerDialogOpen = ref(false)
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

  async function handleGoogleLogin() {
    socialLoading.value = true
    errorMessage.value = ''

    try {
      await signIn.social({ provider: 'google' })
    } catch (e: unknown) {
      errorMessage.value = parseAuthError(e)
    } finally {
      socialLoading.value = false
    }
  }

  async function handlePasskeyLogin() {
    passkeyLoginLoading.value = true
    errorMessage.value = ''

    try {
      const result = await signIn.passkey()
      if (result.error) {
        errorMessage.value = describePasskeyError(result.error, 'login')
        return
      }
      // The passkey plugin atom listener triggers `$sessionSignal` on
      // successful verify-authentication; nuxt-better-auth picks that up
      // and re-hydrates `useUserSession()`. Forcing a session fetch here
      // narrows the window before `loggedIn` flips to true.
      await fetchSession({ force: true })
    } catch (e: unknown) {
      errorMessage.value = describePasskeyError(e, 'login')
    } finally {
      passkeyLoginLoading.value = false
    }
  }

  function handleOpenPasskeyRegister() {
    errorMessage.value = ''
    registerDialogOpen.value = true
  }

  function handlePasskeyRegistered() {
    errorMessage.value = ''
    // `PasskeyRegisterDialog` already calls `refreshSession()` internally;
    // nothing else needed here — the `v-if="!loggedIn"` branch will
    // switch off on its own once the session atom reports signed-in.
  }

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
    [loggedIn, computed(() => user.value?.id ?? null)],
    async ([isLoggedIn, userId]) => {
      if (!isLoggedIn || !userId) {
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
  <!-- Signed-out: Login -->
  <NuxtLayout v-if="!loggedIn" name="auth">
    <UCard class="w-full">
      <template #header>
        <div class="text-center">
          <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-sparkles" class="size-6 text-default" />
          </div>
          <h1 class="text-2xl font-bold text-default">知識問答系統</h1>
          <p class="mt-2 text-sm text-muted">使用公司帳號登入系統</p>
        </div>
      </template>

      <div class="flex flex-col gap-5">
        <LazyUAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-alert-circle"
          :title="errorMessage"
        />

        <UButton
          block
          color="neutral"
          variant="solid"
          size="lg"
          icon="i-simple-icons-google"
          class="py-3"
          :loading="socialLoading"
          @click="handleGoogleLogin"
        >
          使用 Google 帳號登入
        </UButton>

        <!-- passkey-authentication: dual-gate feature flag.
             Both buttons only appear when
             `public.knowledge.features.passkey` is true. -->
        <template v-if="passkeyFeatureEnabled">
          <div class="relative flex items-center">
            <div class="flex-1 border-t border-default" aria-hidden="true" />
            <span class="px-3 text-xs text-muted">或</span>
            <div class="flex-1 border-t border-default" aria-hidden="true" />
          </div>

          <UButton
            block
            color="neutral"
            variant="outline"
            size="lg"
            icon="i-lucide-fingerprint"
            class="py-3"
            :loading="passkeyLoginLoading"
            @click="handlePasskeyLogin"
          >
            使用 Passkey 登入
          </UButton>

          <UButton
            block
            color="neutral"
            variant="subtle"
            size="md"
            icon="i-lucide-user-plus"
            @click="handleOpenPasskeyRegister"
          >
            使用 Passkey 註冊新帳號
          </UButton>
        </template>
      </div>
    </UCard>

    <LazyAuthPasskeyRegisterDialog
      v-if="passkeyFeatureEnabled"
      v-model:open="registerDialogOpen"
      @registered="handlePasskeyRegistered"
    />
  </NuxtLayout>

  <!-- Signed-in: Chat -->
  <NuxtLayout v-else name="chat">
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
              :on-expand-request="expandHistorySidebar"
              :refresh-key="historyRefreshKey"
              :selected-conversation-id="activeConversationId"
              @conversation-cleared="handleConversationCleared"
              @conversation-selected="handleConversationSelected"
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
            <div
              class="flex items-center justify-between border-b border-default px-3 py-3 md:px-4"
            >
              <div class="min-w-0">
                <h1 class="text-base font-semibold text-default md:text-lg">知識庫問答</h1>
                <p class="hidden text-xs text-muted md:block">
                  向知識庫提問，獲取準確的答案與引用來源
                </p>
              </div>
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
              />
            </div>
          </template>
        </LazyUSlideover>
      </template>
    </LazyChatGuestAccessGate>
  </NuxtLayout>
</template>
