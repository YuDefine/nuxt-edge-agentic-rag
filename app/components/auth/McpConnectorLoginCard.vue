<script setup lang="ts">
  const props = defineProps<{
    errorMessage: string
    googleLoading: boolean
    passkeyFeatureEnabled: boolean
    passkeyLoading: boolean
  }>()

  const emit = defineEmits<{
    googleLogin: []
    passkeyLogin: []
  }>()
</script>

<template>
  <UCard class="w-full">
    <template #header>
      <div class="text-center">
        <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <UIcon name="i-lucide-plug-zap" class="size-6 text-default" />
        </div>
        <h1 class="text-2xl font-bold text-default">先登入以授權連接器</h1>
        <p class="mt-2 text-sm text-muted">
          Remote MCP 授權只接受本系統既有帳號，登入後才可檢視 scope 與完成授權。
        </p>
      </div>
    </template>

    <div class="flex flex-col gap-5">
      <LazyUAlert
        v-if="props.errorMessage"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-circle"
        :title="props.errorMessage"
      />

      <LazyUAlert
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        title="尚未建立本地帳號？"
        description="請先完成網站登入，讓系統建立或辨識你的本地帳號後，再回到此頁繼續授權。"
      />

      <UButton
        block
        color="neutral"
        variant="solid"
        size="lg"
        icon="i-simple-icons-google"
        class="py-3"
        :loading="props.googleLoading"
        @click="emit('googleLogin')"
      >
        使用 Google 帳號登入
      </UButton>

      <UButton
        v-if="props.passkeyFeatureEnabled"
        block
        color="neutral"
        variant="outline"
        size="lg"
        icon="i-lucide-fingerprint"
        class="py-3"
        :loading="props.passkeyLoading"
        @click="emit('passkeyLogin')"
      >
        使用 Passkey 登入
      </UButton>

      <UButton color="neutral" variant="ghost" size="sm" to="/"> 回首頁查看一般登入入口 </UButton>
    </div>
  </UCard>
</template>
