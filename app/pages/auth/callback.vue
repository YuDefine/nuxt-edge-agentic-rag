<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const route = useRoute()
  const error = shallowRef<string | null>(null)
  const isTimeout = shallowRef(false)

  // 捕獲 OAuth callback 錯誤
  onMounted(() => {
    const errorParam = route.query.error
    if (typeof errorParam === 'string' && errorParam) {
      error.value = decodeURIComponent(errorParam)
    }

    // 10 秒後顯示 timeout 提示
    const timeoutId = setTimeout(() => {
      if (!error.value) {
        isTimeout.value = true
      }
    }, 10000)

    onUnmounted(() => clearTimeout(timeoutId))
  })
</script>

<template>
  <UCard class="w-full">
    <div class="flex flex-col items-center justify-center gap-4 py-8" aria-live="polite">
      <template v-if="error">
        <UAlert color="error" variant="subtle" :title="error" class="w-full" />
        <NuxtLink
          to="/"
          class="text-sm font-medium text-highlighted hover:underline focus:underline focus:outline-none"
        >
          返回登入
        </NuxtLink>
      </template>
      <template v-else>
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-dimmed" />
        <p class="text-muted">正在處理登入...</p>
        <p v-if="isTimeout" class="text-sm text-muted">
          處理時間較長，請稍候或
          <NuxtLink
            to="/"
            class="font-medium text-highlighted hover:underline focus:underline focus:outline-none"
          >
            返回重試
          </NuxtLink>
        </p>
      </template>
    </div>
  </UCard>
</template>
