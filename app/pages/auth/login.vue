<script setup lang="ts">
  import {
    clearGenericReturnTo,
    parseSafeRedirect,
    saveGenericReturnTo,
  } from '~/utils/auth-return-to'

  definePageMeta({
    auth: false,
    layout: 'auth',
  })

  const route = useRoute()
  const { fetchSession, signIn } = useUserSession()
  const { parseAuthError } = useAuthError()
  // `describePasskeyError` comes from `app/utils/passkey-error.ts` (auto-imported).

  // passkey-authentication / Decision 4 — UI-side feature flag mirror.
  // When off, no passkey buttons render; Google remains the only login
  // surface, matching v1.0.0 production defaults.
  const runtimeConfig = useRuntimeConfig()
  const passkeyFeatureEnabled = computed<boolean>(
    () => runtimeConfig.public?.knowledge?.features?.passkey === true,
  )

  const socialLoading = shallowRef(false)
  const passkeyLoginLoading = shallowRef(false)
  const authTransitionLoading = shallowRef(false)
  const errorMessage = shallowRef('')
  const registerDialogOpen = ref(false)

  function resolveSafeRedirect(): string | null {
    return parseSafeRedirect(route.query.redirect)
  }

  async function handleGoogleLogin() {
    socialLoading.value = true
    errorMessage.value = ''

    // Cross-domain OAuth hop drops the URL query string — stash the
    // redirect target in sessionStorage so `/auth/callback` can restore it.
    // When the current attempt has no safe redirect, clear any stale
    // entry left by a previous abandoned flow so the callback falls back
    // to `/` instead of silently reusing a ghost target.
    const safeRedirect = resolveSafeRedirect()
    if (safeRedirect) {
      saveGenericReturnTo(safeRedirect)
    } else {
      clearGenericReturnTo()
    }

    try {
      // Route the OAuth return through `/auth/callback` so the sessionStorage
      // bridge saved above is actually consumed. Without an explicit
      // `callbackURL`, better-auth defaults to `/` and the redirect target
      // is lost.
      await signIn.social({ provider: 'google', callbackURL: '/auth/callback' })
    } catch (e: unknown) {
      errorMessage.value = parseAuthError(e)
    } finally {
      socialLoading.value = false
    }
  }

  async function handlePasskeyLogin() {
    passkeyLoginLoading.value = true
    errorMessage.value = ''

    try {
      const result = await signIn.passkey()
      if (result.error) {
        errorMessage.value = describePasskeyError(result.error, 'login')
        return
      }
      // The passkey plugin atom listener triggers `$sessionSignal` on
      // successful verify-authentication; nuxt-better-auth picks that up
      // and re-hydrates `useUserSession()`. Forcing a session fetch here
      // narrows the window before `loggedIn` flips to true.
      await fetchSession({ force: true })

      // Passkey is same-origin — no sessionStorage round trip needed.
      // Read redirect straight from the query string and validate.
      const safeRedirect = resolveSafeRedirect()
      await navigateTo(safeRedirect ?? '/', { replace: true })
    } catch (e: unknown) {
      errorMessage.value = describePasskeyError(e, 'login')
    } finally {
      passkeyLoginLoading.value = false
    }
  }

  function handleOpenPasskeyRegister() {
    errorMessage.value = ''
    registerDialogOpen.value = true
  }

  async function handlePasskeyRegistered() {
    errorMessage.value = ''
    authTransitionLoading.value = true
    registerDialogOpen.value = false
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    // The dialog already ran `fetchSession({ force: true })` after
    // registration, so mirror `handlePasskeyLogin`'s post-success nav:
    // honour `?redirect=` when safe, otherwise land on `/`.
    const safeRedirect = resolveSafeRedirect()
    await navigateTo(safeRedirect ?? '/', { replace: true })
  }
</script>

<template>
  <LazyUCard v-if="authTransitionLoading" class="w-full">
    <h1 class="sr-only">登入處理中</h1>
    <div class="flex flex-col items-center justify-center gap-4 py-8" aria-live="polite">
      <UIcon
        name="i-lucide-loader-2"
        class="size-8 animate-spin text-muted motion-reduce:animate-none"
      />
      <p class="text-muted">正在處理登入...</p>
    </div>
  </LazyUCard>

  <LazyUCard v-else class="w-full">
    <template #header>
      <div class="text-center">
        <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <UIcon name="i-lucide-sparkles" class="size-6 text-default" />
        </div>
        <h1 class="text-2xl font-bold text-default">知識問答系統</h1>
        <p class="mt-2 text-sm text-muted">使用公司帳號登入系統</p>
      </div>
    </template>

    <div class="flex flex-col gap-5">
      <LazyUAlert
        v-if="errorMessage"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-circle"
        :title="errorMessage"
      />

      <UButton
        block
        color="neutral"
        variant="solid"
        size="lg"
        icon="i-simple-icons-google"
        class="py-3"
        :loading="socialLoading"
        @click="handleGoogleLogin"
      >
        使用 Google 帳號登入
      </UButton>

      <!-- passkey-authentication: dual-gate feature flag.
           Both buttons only appear when
           `public.knowledge.features.passkey` is true. -->
      <template v-if="passkeyFeatureEnabled">
        <div class="relative flex items-center">
          <div class="flex-1 border-t border-default" aria-hidden="true" />
          <span class="px-3 text-xs text-muted">或</span>
          <div class="flex-1 border-t border-default" aria-hidden="true" />
        </div>

        <UButton
          block
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-lucide-fingerprint"
          class="py-3"
          :loading="passkeyLoginLoading"
          @click="handlePasskeyLogin"
        >
          使用 Passkey 登入
        </UButton>

        <UButton
          block
          color="neutral"
          variant="subtle"
          size="md"
          icon="i-lucide-user-plus"
          @click="handleOpenPasskeyRegister"
        >
          使用 Passkey 註冊新帳號
        </UButton>
      </template>
    </div>

    <LazyAuthPasskeyRegisterDialog
      v-if="passkeyFeatureEnabled"
      v-model:open="registerDialogOpen"
      @registered="handlePasskeyRegistered"
    />
  </LazyUCard>
</template>
