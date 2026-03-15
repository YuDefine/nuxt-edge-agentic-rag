<script setup lang="ts">
  const { user, signOut } = useUserSession()
  const { links } = useAppNavigation()

  const drawer = useLayoutDrawer('main')

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

  function handleDrawerLinkClick() {
    drawer.close()
  }
</script>

<template>
  <div class="flex min-h-screen flex-col bg-default">
    <!-- responsive-and-a11y-foundation §6.3 — Skip to main content link. -->
    <a href="#main-content" class="app-skip-link">跳到主要內容</a>

    <header class="border-b border-default">
      <UContainer>
        <div class="flex items-center justify-between gap-2 py-3">
          <div class="flex items-center gap-2">
            <!-- < md hamburger — opens the main nav drawer. -->
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-menu"
              class="app-focus-ring md:hidden"
              aria-label="開啟主選單"
              aria-controls="main-nav-drawer"
              :aria-expanded="drawer.isOpen.value"
              @click="drawer.open"
            />

            <!-- >= md persistent nav. -->
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

    <!-- < md navigation drawer. -->
    <USlideover
      v-model:open="drawer.isOpen.value"
      side="left"
      title="主選單"
      :ui="{ content: 'md:hidden' }"
    >
      <template #body>
        <nav id="main-nav-drawer" aria-label="主要導覽（抽屜）" class="flex flex-col gap-1 p-4">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="app-focus-ring flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-default hover:bg-elevated"
            active-class="bg-accented text-default"
            @click="handleDrawerLinkClick"
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

    <main id="main-content" tabindex="-1" class="flex-1">
      <UContainer class="py-6 md:py-8">
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
