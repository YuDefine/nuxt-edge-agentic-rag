<script setup lang="ts">
  const { isAdmin } = useUserRole()
  const { user, signOut } = useUserSession()
  const runtimeConfig = useRuntimeConfig()
  const dashboardEnabled = computed(() => runtimeConfig.public?.adminDashboardEnabled ?? true)

  const links = computed(() => {
    const items = [{ label: '問答', to: '/' }]

    if (isAdmin.value) {
      items.push(
        { label: '文件管理', to: '/admin/documents' },
        { label: 'Token 管理', to: '/admin/tokens' },
        { label: '查詢日誌', to: '/admin/query-logs' }
      )
      if (dashboardEnabled.value) {
        items.push({ label: '管理摘要', to: '/admin/dashboard' })
      }
      items.push({ label: 'Debug 延遲', to: '/admin/debug/latency' })
    }

    return items
  })

  const userMenuItems = computed(() => [
    [
      {
        label: user.value?.name || user.value?.email || '使用者',
        type: 'label' as const,
      },
    ],
    [
      {
        label: '登出',
        icon: 'i-lucide-log-out',
        onSelect: () => signOut(),
      },
    ],
  ])
</script>

<template>
  <div class="flex min-h-screen flex-col bg-default">
    <header class="border-b border-default">
      <UContainer>
        <div class="flex items-center justify-between py-3">
          <UNavigationMenu :items="links" />
          <div class="flex items-center gap-2">
            <UColorModeButton />
            <UDropdownMenu :items="userMenuItems">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="帳號選單"
                class="gap-1.5 px-1.5"
              >
                <UAvatar :src="user?.image ?? undefined" :alt="user?.name ?? undefined" size="sm" />
                <UIcon name="i-lucide-chevron-down" class="size-4 text-muted" />
              </UButton>
            </UDropdownMenu>
          </div>
        </div>
      </UContainer>
    </header>

    <main class="flex-1">
      <UContainer class="py-8">
        <slot />
      </UContainer>
    </main>

    <footer class="border-t border-default py-4">
      <UContainer>
        <p class="text-center text-xs text-dimmed">© 2026 知識問答系統</p>
      </UContainer>
    </footer>
  </div>
</template>
