<script setup lang="ts">
  const { isAdmin } = useUserRole()
  const { user, signOut } = useUserSession()

  const links = computed(() => {
    const items = [{ label: '問答', to: '/' }]

    if (isAdmin.value) {
      items.push({ label: '文件管理', to: '/admin/documents' })
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
  <div class="flex h-screen flex-col">
    <header class="border-b border-default">
      <UContainer>
        <div class="flex items-center justify-between py-3">
          <UNavigationMenu :items="links" />
          <div class="flex items-center gap-2">
            <UColorModeButton />
            <UDropdownMenu :items="userMenuItems">
              <UAvatar :src="user?.image ?? undefined" :alt="user?.name ?? undefined" size="sm" />
            </UDropdownMenu>
          </div>
        </div>
      </UContainer>
    </header>

    <main class="flex-1 overflow-hidden">
      <slot />
    </main>
  </div>
</template>
