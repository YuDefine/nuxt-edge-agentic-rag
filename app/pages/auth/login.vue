<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const { signIn } = useUserSession()
  const { parseAuthError } = useAuthError()
  const email = shallowRef('')
  const password = shallowRef('')
  const loading = shallowRef(false)
  const socialLoading = shallowRef(false)
  const errorMessage = shallowRef('')

  const route = useRoute()

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

  async function handleLogin() {
    loading.value = true
    errorMessage.value = ''
    try {
      await signIn.email({ email: email.value, password: password.value })
      await navigateTo(safeRedirect.value)
    } catch (e: unknown) {
      errorMessage.value = parseAuthError(e)
    } finally {
      loading.value = false
    }
  }

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
  <div class="flex flex-col gap-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold">登入</h1>
    </div>

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

    <UDivider label="或使用 Email" />

    <form class="flex flex-col gap-4" @submit.prevent="handleLogin">
      <UFormField label="Email">
        <UInput v-model="email" type="email" required placeholder="you@example.com" />
      </UFormField>
      <UFormField label="密碼">
        <UInput v-model="password" type="password" required placeholder="••••••••" />
      </UFormField>
      <UButton block color="neutral" variant="solid" size="lg" type="submit" :loading="loading">
        登入
      </UButton>
    </form>

    <div class="flex items-center justify-between text-sm">
      <NuxtLink
        to="/auth/register"
        class="font-medium text-neutral-900 hover:underline focus:underline"
        >還沒有帳號？註冊</NuxtLink
      >
      <NuxtLink to="/auth/forgot-password" class="text-neutral-600 hover:underline focus:underline"
        >忘記密碼</NuxtLink
      >
    </div>
  </div>
</template>
