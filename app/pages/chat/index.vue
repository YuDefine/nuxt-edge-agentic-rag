<script setup lang="ts">
  /**
   * Chat page - requires authentication.
   * Server truth: POST /api/chat requires user session (requireUserSession)
   */
  definePageMeta({
    // No middleware needed - global auth.global.ts handles authentication
    // Non-admin users can access chat
  })

  // In v1.0 MVP, we only track the current session
  const currentSessionId = ref<string | undefined>(undefined)
</script>

<template>
  <div class="flex h-[calc(100vh-4rem)] gap-0">
    <!-- Sidebar: Conversation History -->
    <aside
      class="hidden w-64 flex-shrink-0 border-r border-neutral-200 lg:block dark:border-neutral-800"
    >
      <ChatConversationHistory :current-session-id="currentSessionId" />
    </aside>

    <!-- Main chat area -->
    <main class="flex flex-1 flex-col overflow-hidden">
      <div class="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h1 class="text-lg font-semibold text-default">知識庫問答</h1>
        <p class="text-xs text-muted">向知識庫提問，獲取準確的答案與引用來源</p>
      </div>

      <ChatContainer class="flex-1" />
    </main>
  </div>
</template>
