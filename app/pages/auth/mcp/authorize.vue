<script setup lang="ts">
  import { getErrorMessage } from '#shared/utils/error-message'

  definePageMeta({
    auth: false,
    layout: 'auth',
  })

  const route = useRoute()
  const runtimeConfig = useRuntimeConfig()
  const { loggedIn, signIn, fetchSession, user } = useUserSession()
  const { parseAuthError } = useAuthError()

  const {
    actionErrorMessage,
    approveAuthorization,
    authorization,
    denyAuthorization,
    isApproving,
    isDenying,
    isLoading,
    loadAuthorization,
    loadErrorMessage,
    localAccountRequired,
    queryErrorMessage,
  } = useMcpConnectorAuthorization()

  const googleLoading = ref(false)
  const passkeyLoading = ref(false)
  const loginError = ref('')

  const passkeyFeatureEnabled = computed<boolean>(
    () => runtimeConfig.public?.knowledge?.features?.passkey === true,
  )

  const accountLabel = computed(
    () => user.value?.name ?? user.value?.email ?? user.value?.id ?? '目前登入帳號',
  )

  async function handleGoogleLogin() {
    googleLoading.value = true
    loginError.value = ''
    saveMcpConnectorReturnTo(route.fullPath)

    try {
      await signIn.social({ provider: 'google' })
    } catch (error) {
      loginError.value = parseAuthError(error)
      googleLoading.value = false
    }
  }

  async function handlePasskeyLogin() {
    passkeyLoading.value = true
    loginError.value = ''

    try {
      const result = await signIn.passkey()
      if (result.error) {
        loginError.value = describePasskeyError(result.error, 'login')
        return
      }

      await fetchSession({ force: true })
    } catch (error) {
      loginError.value = describePasskeyError(error, 'login')
    } finally {
      passkeyLoading.value = false
    }
  }

  function handleRetryAuthorization() {
    loginError.value = ''
    void loadAuthorization()
  }

  const showInvalidRequest = computed(() => queryErrorMessage.value.length > 0)
  const showLoginCard = computed(() => !showInvalidRequest.value && !loggedIn.value)
  const showLoadingCard = computed(
    () => !showInvalidRequest.value && loggedIn.value && isLoading.value,
  )
  const showLocalAccountRequired = computed(
    () => !showInvalidRequest.value && loggedIn.value && localAccountRequired.value,
  )
  const showErrorCard = computed(
    () =>
      !showInvalidRequest.value &&
      loggedIn.value &&
      !isLoading.value &&
      !localAccountRequired.value &&
      loadErrorMessage.value.length > 0,
  )
  const showConsentCard = computed(
    () =>
      !showInvalidRequest.value &&
      loggedIn.value &&
      !isLoading.value &&
      authorization.value !== null &&
      loadErrorMessage.value.length === 0,
  )

  watch(
    () => loggedIn.value,
    (next) => {
      if (next) {
        loginError.value = ''
        googleLoading.value = false
      }
    },
  )
</script>

<template>
  <AuthMcpConnectorLoginCard
    v-if="showLoginCard"
    :error-message="loginError"
    :google-loading="googleLoading"
    :passkey-feature-enabled="passkeyFeatureEnabled"
    :passkey-loading="passkeyLoading"
    @google-login="handleGoogleLogin"
    @passkey-login="handlePasskeyLogin"
  />

  <UCard v-else-if="showInvalidRequest" class="w-full">
    <div class="flex flex-col items-center gap-4 py-8 text-center">
      <div class="flex size-12 items-center justify-center rounded-full bg-error/10">
        <UIcon name="i-lucide-unplug" class="size-6 text-error" />
      </div>
      <div class="space-y-2">
        <h1 class="text-xl font-semibold text-default">授權連結無效</h1>
        <p class="text-sm text-muted">{{ queryErrorMessage }}</p>
      </div>
      <UButton color="neutral" variant="outline" to="/">回首頁</UButton>
    </div>
  </UCard>

  <UCard v-else-if="showLoadingCard" class="w-full">
    <div class="flex flex-col items-center justify-center gap-4 py-10">
      <UIcon
        name="i-lucide-loader-2"
        class="size-8 animate-spin text-muted motion-reduce:animate-none"
      />
      <div class="space-y-1 text-center">
        <h1 class="text-lg font-semibold text-default">正在載入授權資訊</h1>
        <p class="text-sm text-muted">系統正在確認連接器、scope 與你的本地帳號。</p>
      </div>
    </div>
  </UCard>

  <UCard v-else-if="showLocalAccountRequired" class="w-full">
    <div class="flex flex-col gap-4 py-4">
      <div class="text-center">
        <div
          class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-warning/10"
        >
          <UIcon name="i-lucide-user-round-x" class="size-6 text-warning" />
        </div>
        <h1 class="text-2xl font-bold text-default">無法辨識本地帳號</h1>
        <p class="mt-2 text-sm text-muted">
          這次登入尚未對應到可授權的本地帳號，請先回首頁完成一般登入流程後再回來。
        </p>
      </div>

      <LazyUAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-badge-alert"
        :title="loadErrorMessage"
        description="若你是第一次使用此系統，請先完成網站登入，讓系統建立或辨識你的本地帳號。"
      />

      <div class="flex flex-col gap-2 md:flex-row md:justify-end">
        <UButton color="neutral" variant="outline" @click="handleRetryAuthorization">
          重新檢查
        </UButton>
        <UButton color="neutral" variant="solid" to="/">回首頁</UButton>
      </div>
    </div>
  </UCard>

  <UCard v-else-if="showErrorCard" class="w-full">
    <div class="flex flex-col items-center gap-4 py-8 text-center">
      <div class="flex size-12 items-center justify-center rounded-full bg-muted">
        <UIcon name="i-lucide-cloud-off" class="size-6 text-muted" />
      </div>
      <div class="space-y-2">
        <h1 class="text-xl font-semibold text-default">暫時無法載入授權資訊</h1>
        <p class="text-sm text-muted">
          {{ loadErrorMessage || getErrorMessage(null, '請稍後再試') }}
        </p>
      </div>
      <div class="flex flex-col gap-2 md:flex-row">
        <UButton color="neutral" variant="outline" @click="handleRetryAuthorization">
          重新載入
        </UButton>
        <UButton color="neutral" variant="ghost" to="/">回首頁</UButton>
      </div>
    </div>
  </UCard>

  <AuthMcpConnectorConsentCard
    v-else-if="showConsentCard && authorization"
    :account-label="accountLabel"
    :action-error-message="actionErrorMessage"
    :approving="isApproving"
    :authorization="authorization"
    :denying="isDenying"
    @approve="approveAuthorization"
    @deny="denyAuthorization"
  />
</template>
