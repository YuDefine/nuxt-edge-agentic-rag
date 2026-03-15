<script setup lang="ts">
  const { user, signOut } = useUserSession()
  const { links } = useAppNavigation()

  const navDrawer = useLayoutDrawer('main')
  const historyDrawer = useLayoutDrawer('chat-history')

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

  function handleNavLinkClick() {
    navDrawer.close()
  }
</script>

<template>
  <div class="flex h-screen flex-col">
    <!-- responsive-and-a11y-foundation §6.3 — Skip to main content link. -->
    <a href="#main-content" class="app-skip-link">跳到主要內容</a>

    <header class="border-b border-default">
      <UContainer>
        <div class="flex items-center justify-between gap-2 py-3">
          <div class="flex items-center gap-2">
            <!-- < md hamburger for nav -->
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-menu"
              class="app-focus-ring md:hidden"
              aria-label="開啟主選單"
              aria-controls="chat-nav-drawer"
              :aria-expanded="navDrawer.isOpen.value"
              @click="navDrawer.open"
            />

            <!-- < md chat history toggle -->
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-history"
              class="app-focus-ring lg:hidden"
              aria-label="開啟對話記錄"
              aria-controls="chat-history-drawer"
              :aria-expanded="historyDrawer.isOpen.value"
              @click="historyDrawer.open"
            />

            <nav aria-label="主要導覽" class="hidden md:block">
              <UNavigationMenu :items="links" />
            </nav>
          </div>
          <div class="flex items-center gap-2">
            <UColorModeButton />
            <UDropdownMenu :items="userMenuItems">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="帳號選單"
                class="app-focus-ring gap-1.5 px-1.5"
              >
                <UAvatar :src="user?.image ?? undefined" :alt="user?.name ?? undefined" size="sm" />
                <UIcon name="i-lucide-chevron-down" class="size-4 text-muted" />
              </UButton>
            </UDropdownMenu>
          </div>
        </div>
      </UContainer>
    </header>

    <!-- < md primary nav drawer -->
    <USlideover
      v-model:open="navDrawer.isOpen.value"
      side="left"
      title="主選單"
      :ui="{ content: 'md:hidden' }"
    >
      <template #body>
        <nav id="chat-nav-drawer" aria-label="主要導覽（抽屜）" class="flex flex-col gap-1 p-4">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="app-focus-ring flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-default hover:bg-elevated"
            active-class="bg-accented text-default"
            @click="handleNavLinkClick"
          >
            <UIcon
              v-if="link.icon"
              :name="link.icon"
              class="size-4 text-muted"
              aria-hidden="true"
            />
            <span>{{ link.label }}</span>
          </NuxtLink>
        </nav>
      </template>
    </USlideover>

    <main id="main-content" tabindex="-1" class="flex-1 overflow-hidden">
      <slot />
    </main>
  </div>
</template>
