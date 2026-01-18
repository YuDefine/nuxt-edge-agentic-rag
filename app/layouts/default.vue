<script setup lang="ts">
  const { loggedIn } = useUserSession()
  const { isAdmin } = useUserRole()

  const links = computed(() => {
    const items = [{ label: '首頁', to: '/' }]

    if (loggedIn.value) {
      items.push({ label: '問答', to: '/chat' })
    }

    if (isAdmin.value) {
      items.push({ label: '文件管理', to: '/admin/documents' })
    }

    return items
  })
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="border-b">
      <UContainer>
        <div class="flex items-center justify-between py-3">
          <UNavigationMenu :items="links" />
          <UColorModeButton />
        </div>
      </UContainer>
    </header>

    <main class="flex-1">
      <UContainer class="py-8">
        <slot />
      </UContainer>
    </main>

    <footer class="border-t py-4">
      <UContainer>
        <p class="text-center text-sm text-muted">© 2026 知識問答系統</p>
      </UContainer>
    </footer>
  </div>
</template>
