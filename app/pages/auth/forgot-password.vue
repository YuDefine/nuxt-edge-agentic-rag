<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const { client } = useUserSession()
  const email = shallowRef('')
  const loading = shallowRef(false)
  const sent = shallowRef(false)

  async function handleSubmit() {
    loading.value = true
    try {
      if (!client) {
        throw new Error('No auth client available')
      }
      sent.value = true
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold">忘記密碼</h1>
    </div>

    <UAlert v-if="sent" color="success" variant="subtle" :title="`重設連結已寄送至 ${email}`" />

    <form v-else class="flex flex-col gap-4" @submit.prevent="handleSubmit">
      <UFormField label="Email">
        <UInput v-model="email" type="email" required placeholder="you@example.com" />
      </UFormField>
      <UButton block color="neutral" variant="solid" size="lg" type="submit" :loading="loading">
        送出重設連結
      </UButton>
    </form>

    <p class="text-center text-sm">
      <NuxtLink
        to="/auth/login"
        class="font-medium text-neutral-900 hover:underline focus:underline"
        >返回登入</NuxtLink
      >
    </p>
  </div>
</template>
