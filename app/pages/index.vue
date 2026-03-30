<script setup lang="ts">
  /**
   * Home page - shows login when signed out, chat when signed in.
   */
  definePageMeta({
    auth: false, // Public page, handles its own auth state
    layout: false, // Manually handle layout switching
  })

  const { loggedIn, signIn } = useUserSession()
  const { parseAuthError } = useAuthError()

  // responsive-and-a11y-foundation §3.3 — chat-history drawer state is
  // shared with the chat layout header toggle via `useLayoutDrawer`.
  const historyDrawer = useLayoutDrawer('chat-history')

  const socialLoading = shallowRef(false)
  const errorMessage = shallowRef('')

  // In v1.0 MVP, we only track the current session
  const currentSessionId = ref<string | undefined>(undefined)

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

  function handleHistoryDrawerClick() {
    // Auto-close the history drawer after a selection so the chat area
    // returns to focus on `< lg` viewports. In v1.0.0 MVP there is only
    // one conversation entry so any click inside closes the drawer.
    historyDrawer.close()
  }
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
          :loading="socialLoading"
          @click="handleGoogleLogin"
        >
          使用 Google 帳號登入
        </UButton>

        <p class="text-center text-xs text-muted">首次登入後，系統會根據帳號設定自動指派角色。</p>
      </div>
    </UCard>
  </NuxtLayout>

  <!-- Signed-in: Chat -->
  <NuxtLayout v-else name="chat">
    <ChatGuestAccessGate>
      <template #default="{ canAsk }">
        <!-- responsive-and-a11y-foundation §5.5 — two-column on lg, stacked on < lg.
             `< lg` conversation history is reachable via the chat-layout drawer
             toggle; sidebar is hidden below that breakpoint to keep the chat
             column full-width for phones / small tablets. -->
        <div class="flex h-[calc(100dvh-4rem)] min-h-0 gap-0">
          <aside
            class="hidden w-64 shrink-0 border-r border-default lg:flex lg:flex-col"
            aria-label="對話記錄"
          >
            <LazyChatConversationHistory :current-session-id="currentSessionId" />
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

            <LazyChatContainer class="flex-1" :disabled="!canAsk" />
          </section>
        </div>

        <!-- < lg chat-history drawer -->
        <USlideover
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
              @click="handleHistoryDrawerClick"
            >
              <LazyChatConversationHistory :current-session-id="currentSessionId" />
            </div>
          </template>
        </USlideover>
      </template>
    </ChatGuestAccessGate>
  </NuxtLayout>
</template>
