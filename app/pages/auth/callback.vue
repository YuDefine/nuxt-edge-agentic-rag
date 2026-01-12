<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const route = useRoute()
  const error = shallowRef<string | null>(null)

  // 捕獲 OAuth callback 錯誤
  onMounted(() => {
    const errorParam = route.query.error
    if (typeof errorParam === 'string' && errorParam) {
      error.value = decodeURIComponent(errorParam)
    }
  })
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-4 py-12" aria-live="polite">
    <UAlert v-if="error" color="error" variant="subtle" :title="error" />
    <template v-else>
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-neutral-400" />
      <p class="text-neutral-600">正在處理登入...</p>
    </template>
  </div>
</template>
