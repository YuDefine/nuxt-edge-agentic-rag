<script setup lang="ts">
  import { resolveReturnToPath } from '~/utils/auth-return-to'

  definePageMeta({ layout: 'auth', auth: false })

  const route = useRoute()
  const { fetchSession } = useUserSession()
  const error = shallowRef<string | null>(null)

  // 捕獲 OAuth callback 錯誤
  onMounted(async () => {
    const errorParam = route.query.error
    if (typeof errorParam === 'string' && errorParam) {
      error.value = decodeURIComponent(errorParam)
      return
    }

    // Return-to consume order is enforced inside resolveReturnToPath:
    // MCP connector double-handshake first, then generic return-to
    // (revalidated via parseSafeRedirect), else null.
    //
    // design.md step 3: when both sources are empty, fall back to `/`.
    const pendingPath = resolveReturnToPath()
    await fetchSession({ force: true }).catch(() => {})
    await navigateTo(pendingPath ?? '/', { replace: true })
  })
</script>

<template>
  <UCard class="w-full">
    <h1 class="sr-only">{{ error ? '登入失敗' : '登入處理中' }}</h1>
    <div class="flex flex-col items-center justify-center gap-4 py-8" aria-live="polite">
      <template v-if="error">
        <LazyUAlert color="error" variant="subtle" :title="error" class="w-full" />
        <NuxtLink
          to="/"
          class="text-sm font-medium text-highlighted hover:underline focus:underline focus:outline-none"
        >
          返回登入
        </NuxtLink>
      </template>
      <template v-else>
        <UIcon
          name="i-lucide-loader-2"
          class="size-8 animate-spin text-muted motion-reduce:animate-none"
        />
        <p class="text-muted">正在處理登入...</p>
      </template>
    </div>
  </UCard>
</template>
