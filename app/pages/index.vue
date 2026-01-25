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
        <UAlert
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

        <p class="text-center text-xs text-dimmed">首次登入後，系統會根據帳號設定自動指派角色。</p>
      </div>
    </UCard>
  </NuxtLayout>

  <!-- Signed-in: Chat -->
  <NuxtLayout v-else name="chat">
    <div class="flex h-[calc(100vh-4rem)] gap-0">
      <!-- Sidebar: Conversation History -->
      <aside class="hidden w-64 flex-shrink-0 border-r border-default lg:block">
        <ChatConversationHistory :current-session-id="currentSessionId" />
      </aside>

      <!-- Main chat area -->
      <main class="flex flex-1 flex-col overflow-hidden">
        <div class="flex items-center justify-between border-b border-default px-4 py-3">
          <div>
            <h1 class="text-lg font-semibold text-default">知識庫問答</h1>
            <p class="text-xs text-muted">向知識庫提問，獲取準確的答案與引用來源</p>
          </div>
        </div>

        <ChatContainer class="flex-1" />
      </main>
    </div>
  </NuxtLayout>
</template>
