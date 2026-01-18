<script setup lang="ts">
  /**
   * Home page - public, shows different content based on auth state.
   */
  definePageMeta({
    auth: false, // Public page
  })

  const { loggedIn, user, signOut } = useUserSession()
  const { isAdmin } = useUserRole()

  async function handleSignOut() {
    await signOut()
    await navigateTo('/auth/login')
  }
</script>

<template>
  <div class="flex min-h-[calc(100vh-12rem)] items-center justify-center">
    <!-- Signed-out state -->
    <UCard v-if="!loggedIn" class="w-full max-w-md">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-brain" class="size-6 text-primary" />
          <h1 class="text-lg font-semibold text-default">知識問答系統</h1>
        </div>
      </template>

      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
          歡迎使用知識問答系統。登入後即可向知識庫提問，獲取準確的答案與引用來源。
        </p>

        <div class="rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900">
          <h3 class="mb-2 text-sm font-medium text-default">系統功能</h3>
          <ul class="space-y-2 text-sm text-muted">
            <li class="flex items-center gap-2">
              <UIcon name="i-lucide-message-square" class="size-4 text-primary" />
              智能問答 — 自然語言查詢知識庫
            </li>
            <li class="flex items-center gap-2">
              <UIcon name="i-lucide-file-text" class="size-4 text-primary" />
              引用追蹤 — 查看答案來源文件
            </li>
            <li class="flex items-center gap-2">
              <UIcon name="i-lucide-shield-check" class="size-4 text-primary" />
              安全存取 — 基於角色的內容控制
            </li>
          </ul>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <UButton color="primary" variant="solid" size="md" to="/auth/login"> 登入系統 </UButton>
        </div>
      </template>
    </UCard>

    <!-- Signed-in state -->
    <UCard v-else class="w-full max-w-md">
      <template #header>
        <div class="flex items-center justify-between">
          <h1 class="text-lg font-semibold text-default">知識問答系統</h1>
          <UBadge v-if="isAdmin" color="success" variant="subtle" size="sm">管理員</UBadge>
          <UBadge v-else color="neutral" variant="subtle" size="sm">使用者</UBadge>
        </div>
      </template>

      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <UAvatar :alt="user?.name || user?.email || '使用者'" size="md" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-default">{{ user?.name || '使用者' }}</p>
            <p class="truncate text-sm text-muted">{{ user?.email }}</p>
          </div>
        </div>

        <USeparator />

        <!-- Navigation actions -->
        <div class="flex flex-col gap-2">
          <UButton
            color="primary"
            variant="solid"
            size="md"
            icon="i-lucide-message-square"
            to="/chat"
            block
          >
            開始問答
          </UButton>

          <UButton
            v-if="isAdmin"
            color="neutral"
            variant="outline"
            size="md"
            icon="i-lucide-file-text"
            to="/admin/documents"
            block
          >
            文件管理
          </UButton>
        </div>

        <p class="mt-4 text-xs text-muted">向知識庫提問，獲取準確的答案與引用來源。</p>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <UButton color="neutral" variant="ghost" size="sm" @click="handleSignOut">登出</UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
