<script setup lang="ts">
  // `AuthNicknameInput` is auto-imported via Nuxt component discovery
  // (`app/components/auth/NicknameInput.vue` → `<AuthNicknameInput>`).
  // The status type lives in `#shared/types/nickname` so we avoid the
  // brittle SFC-to-SFC type dependency.
  import type { NicknameStatus } from '#shared/types/nickname'

  /**
   * passkey-authentication — Passkey-first registration dialog.
   *
   * Two-step flow inside a single modal:
   *   1. User enters nickname → debounced availability check
   *   2. On confirm → WebAuthn ceremony via `authClient.passkey.addPasskey()`
   *      with `context` carrying the chosen nickname so the server hook
   *      can set `user.displayName` on the newly-created user row.
   *
   * Error handling covers:
   *   - WebAuthn `NotAllowedError` (user cancelled / OS refused)
   *   - `InvalidStateError` (passkey already registered on this device)
   *   - timeout (no response within the OS timeout window)
   *   - network / server errors (401, 409, 500)
   *
   * On success: emits `registered` so the parent can `refreshSession()`
   * and close the dialog.
   */

  const props = defineProps<{
    open: boolean
  }>()

  const emit = defineEmits<{
    'update:open': [value: boolean]
    registered: []
  }>()

  // `useUserSession()` from `@onmax/nuxt-better-auth` exposes the
  // authClient instance as `client`. `passkey.addPasskey()` is added by
  // the `passkeyClient()` plugin registered in `app/auth.config.ts`.
  // `fetchSession({ force: true })` ensures consumers see the
  // newly-minted session immediately rather than waiting for the atom
  // listener to propagate.
  const { client, fetchSession } = useUserSession()

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  })

  const nickname = ref('')
  const nicknameStatus = ref<NicknameStatus>('idle')
  const isSubmitting = ref(false)
  const submitError = ref('')

  watch(
    () => props.open,
    (next) => {
      if (next) {
        nickname.value = ''
        nicknameStatus.value = 'idle'
        submitError.value = ''
        isSubmitting.value = false
      }
    },
  )

  const canSubmit = computed(() => nicknameStatus.value === 'available' && !isSubmitting.value)

  // Error copy is produced by the shared `describePasskeyError` helper
  // from `app/utils/passkey-error.ts` (Nuxt auto-imports) so no raw
  // English plugin / WebAuthn string ever reaches the UI.

  async function handleConfirm(): Promise<void> {
    if (!canSubmit.value) return

    isSubmitting.value = true
    submitError.value = ''

    const trimmed = nickname.value.trim()

    if (!client) {
      submitError.value = 'Passkey 尚未初始化，請重新整理頁面'
      isSubmitting.value = false
      return
    }

    try {
      const result = await client.passkey.addPasskey({
        name: trimmed,
        context: trimmed,
      })

      if (result.error) {
        submitError.value = describePasskeyError(result.error, 'register')
        return
      }

      // `addPasskey` is designed for logged-in users (adding another
      // passkey to existing session) so the plugin does not notify
      // `$sessionSignal` after verify-registration. For our passkey-first
      // flow `afterVerification` on the server creates a brand-new
      // session + cookie, but the client's reactive session atom stays
      // stale until notified — then `fetchSession({ force: true })`
      // populates the composable's session/user state without the
      // nanostore watcher racing to clear it.
      const store = (client as unknown as { $store?: { notify: (sig: string) => void } }).$store
      store?.notify('$sessionSignal')
      await fetchSession({ force: true })
      emit('registered')
      isOpen.value = false
    } catch (error) {
      submitError.value = describePasskeyError(error, 'register')
    } finally {
      isSubmitting.value = false
    }
  }

  function handleCancel(): void {
    isOpen.value = false
  }
</script>

<template>
  <UModal v-model:open="isOpen" title="使用 Passkey 註冊" :dismissible="!isSubmitting">
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
          設定你的暱稱後，瀏覽器會引導你用裝置（指紋 / Face ID / 硬體金鑰）建立 passkey。
        </p>

        <LazyAuthNicknameInput
          v-model="nickname"
          :disabled="isSubmitting"
          @update:status="(s: NicknameStatus) => (nicknameStatus = s)"
        />

        <LazyUAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-alert-circle"
          :title="submitError"
          :description="'如需協助，可關閉此視窗改用 Google 登入。'"
        />

        <LazyUAlert
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="暱稱永久不可修改"
          description="建立後無法變更，也不會在未來自助更名。"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 md:flex-row md:justify-end">
        <LazyUButton
          color="neutral"
          variant="outline"
          size="md"
          block
          class="md:w-auto"
          :disabled="isSubmitting"
          @click="handleCancel"
        >
          取消
        </LazyUButton>
        <LazyUButton
          color="neutral"
          variant="solid"
          size="md"
          block
          class="md:w-auto"
          icon="i-lucide-fingerprint"
          :loading="isSubmitting"
          :disabled="!canSubmit"
          @click="handleConfirm"
        >
          建立 Passkey
        </LazyUButton>
      </div>
    </template>
  </UModal>
</template>
