<script setup lang="ts">
  const { isAdmin } = useUserRole()

  const links = computed(() => {
    const items = [{ label: '問答', to: '/' }]

    if (isAdmin.value) {
      items.push({ label: '文件管理', to: '/admin/documents' })
    }

    return items
  })
</script>

<template>
  <div class="flex min-h-screen flex-col bg-default">
    <header class="border-b border-default">
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

    <footer class="border-t border-default py-4">
      <UContainer>
        <p class="text-center text-xs text-dimmed">© 2026 知識問答系統</p>
      </UContainer>
    </footer>
  </div>
</template>
