<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const { client } = useUserSession()
  const { parseAuthError } = useAuthError()
  const route = useRoute()

  const password = shallowRef('')
  const confirmPassword = shallowRef('')
  const loading = shallowRef(false)
  const success = shallowRef(false)
  const errorMessage = shallowRef('')

  const token = computed(() => {
    const t = route.query.token
    return typeof t === 'string' ? t : ''
  })

  async function handleSubmit() {
    errorMessage.value = ''

    if (password.value !== confirmPassword.value) {
      errorMessage.value = '密碼不一致'
      return
    }

    if (password.value.length < 8) {
      errorMessage.value = '密碼至少需要 8 個字元'
      return
    }

    loading.value = true
    try {
      if (!client) {
        throw new Error('No auth client available')
      }
      await client.resetPassword({
        newPassword: password.value,
        token: token.value,
      })
      success.value = true
    } catch (e: unknown) {
      errorMessage.value = parseAuthError(e)
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold">重設密碼</h1>
    </div>

    <UAlert v-if="!token" color="error" variant="subtle" title="無效的重設連結" />

    <template v-else>
      <UAlert v-if="success" color="success" variant="subtle" title="密碼已重設成功">
        <template #description>
          <NuxtLink to="/auth/login" class="font-medium underline">前往登入</NuxtLink>
        </template>
      </UAlert>

      <UAlert v-if="errorMessage" color="error" variant="subtle" :title="errorMessage" />

      <form v-if="!success" class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <UFormField label="新密碼">
          <UInput v-model="password" type="password" required placeholder="至少 8 個字元" />
        </UFormField>
        <UFormField label="確認密碼">
          <UInput v-model="confirmPassword" type="password" required placeholder="再次輸入密碼" />
        </UFormField>
        <UButton block color="neutral" variant="solid" size="lg" type="submit" :loading="loading">
          重設密碼
        </UButton>
      </form>
    </template>

    <p class="text-center text-sm">
      <NuxtLink
        to="/auth/login"
        class="font-medium text-neutral-900 hover:underline focus:underline"
        >返回登入</NuxtLink
      >
    </p>
  </div>
</template>
