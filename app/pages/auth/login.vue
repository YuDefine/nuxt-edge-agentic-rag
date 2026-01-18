<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const { signIn } = useUserSession()
  const { parseAuthError } = useAuthError()
  const route = useRoute()
  const socialLoading = shallowRef(false)
  const errorMessage = shallowRef('')

  const safeRedirect = computed(() => {
    const redirect = route.query.redirect

    if (typeof redirect !== 'string') {
      return '/'
    }

    if (!redirect.startsWith('/') || redirect.startsWith('//')) {
      return '/'
    }

    return redirect
  })

  async function handleGoogleLogin() {
    socialLoading.value = true
    errorMessage.value = ''

    try {
      await signIn.social({ provider: 'google' })
    } catch (e: unknown) {
      errorMessage.value = parseAuthError(e)
    } finally {
      socialLoading.value = false
    }
  }
</script>

<template>
  <UCard class="w-full">
    <template #header>
      <div class="text-center">
        <h1 class="text-xl font-semibold text-default">登入</h1>
        <p class="mt-1 text-sm text-muted">請使用 Google 帳號登入</p>
      </div>
    </template>

    <div class="flex flex-col gap-4">
      <UAlert v-if="errorMessage" color="error" variant="subtle" :title="errorMessage" />

      <UButton
        block
        color="neutral"
        variant="outline"
        size="lg"
        icon="i-simple-icons-google"
        :loading="socialLoading"
        @click="handleGoogleLogin"
      >
        使用 Google 登入
      </UButton>

      <p class="text-center text-sm text-muted">
        首次登入後，系統會依 Google 帳號與部署 allowlist 決定角色。
      </p>
    </div>
  </UCard>
</template>
