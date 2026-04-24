<script setup lang="ts">
  import { getErrorMessage } from '#shared/utils/error-message'

  /**
   * passkey-authentication §12 — Self-deletion dialog.
   *
   * The flow is:
   *
   *   1. User opens dialog → sees destructive warning + consequences
   *   2. User clicks reauth button:
   *      - Passkey path: `signIn.passkey()` — mints a fresh session
   *        row that the delete endpoint's 5-min reauth-window check
   *        will accept.
   *      - Google path (Phase 11 Google-linked users): same flow via
   *        `signIn.social({ provider: 'google' })`.
   *   3. After reauth succeeds, the confirm button unlocks.
   *   4. Confirm → `POST /api/auth/account/delete` → sign out, then force
   *      a hard redirect to `/auth/login` so stale SPA auth state cannot
   *      leave `/account/settings` mounted after the session is gone.
   */

  const props = defineProps<{
    open: boolean
    hasPasskey: boolean
    hasGoogle: boolean
  }>()

  const emit = defineEmits<{
    'update:open': [value: boolean]
  }>()

  const { $csrfFetch } = useNuxtApp() as unknown as {
    $csrfFetch: typeof $fetch
  }
  // `useUserSession()` exposes `signIn` (passkey + social) directly.
  const { signIn } = useUserSession()
  const { signOutAndRedirect } = useSignOutRedirect()
  const toast = useToast()

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  })

  const reauthComplete = ref(false)
  const reauthLoading = ref(false)
  const deleteLoading = ref(false)
  const errorMessage = ref('')

  watch(
    () => props.open,
    (next) => {
      if (next) {
        reauthComplete.value = false
        reauthLoading.value = false
        deleteLoading.value = false
        errorMessage.value = ''
      }
    },
  )

  async function handlePasskeyReauth(): Promise<void> {
    reauthLoading.value = true
    errorMessage.value = ''
    try {
      const result = await signIn.passkey()
      if (result.error) {
        errorMessage.value = describePasskeyError(result.error, 'reauth')
        return
      }
      reauthComplete.value = true
    } catch (error) {
      errorMessage.value = describePasskeyError(error, 'reauth')
    } finally {
      reauthLoading.value = false
    }
  }

  async function handleGoogleReauth(): Promise<void> {
    reauthLoading.value = true
    errorMessage.value = ''
    try {
      await signIn.social({ provider: 'google' })
      // Google OAuth performs a full-page redirect, so control rarely
      // returns here. If it does (e.g. provider cancellation), the
      // session hasn't rotated.
      reauthComplete.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error, 'Google 重新驗證失敗')
    } finally {
      reauthLoading.value = false
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!reauthComplete.value) return
    deleteLoading.value = true
    errorMessage.value = ''
    try {
      await $csrfFetch('/api/auth/account/delete', { method: 'POST' })
      toast.add({
        title: '帳號已刪除',
        description: '相關資料已移除，您將被登出',
        color: 'neutral',
        icon: 'i-lucide-check',
      })
      isOpen.value = false
      // Sign out + redirect. Targets `/auth/login` (auth: false) so the
      // global middleware never sees a stale `loggedIn=true` atom on a
      // protected route during the post-delete transition.
      await signOutAndRedirect()
    } catch (error) {
      errorMessage.value = getErrorMessage(error, '刪除失敗，請稍後再試')
    } finally {
      deleteLoading.value = false
    }
  }

  function handleCancel(): void {
    isOpen.value = false
  }

  const canReauth = computed(() => props.hasPasskey || props.hasGoogle)
</script>

<template>
  <UModal v-model:open="isOpen" title="刪除帳號" :dismissible="!deleteLoading && !reauthLoading">
    <template #body>
      <div class="flex flex-col gap-4">
        <LazyUAlert
          color="error"
          variant="subtle"
          icon="i-lucide-alert-triangle"
          title="此操作無法復原"
          description="帳號、passkey、對話紀錄都會被刪除；audit 紀錄將保留為法遵追溯。"
        />

        <div class="rounded-md border border-default bg-elevated p-3 text-sm">
          <p class="font-medium text-default">刪除前必須完成兩個步驟</p>
          <ol class="mt-2 list-inside list-decimal space-y-1 text-muted">
            <li>
              <span :class="reauthComplete ? 'text-success' : 'text-default'">
                重新驗證身分 {{ reauthComplete ? '（已完成）' : '' }}
              </span>
            </li>
            <li class="text-default">確認刪除</li>
          </ol>
        </div>

        <div v-if="!reauthComplete" class="flex flex-col gap-2">
          <p class="text-sm text-muted">請選擇一種方式重新驗證：</p>
          <UButton
            v-if="hasPasskey"
            block
            color="neutral"
            variant="outline"
            size="md"
            icon="i-lucide-fingerprint"
            :loading="reauthLoading"
            @click="handlePasskeyReauth"
          >
            使用 Passkey 重新驗證
          </UButton>
          <UButton
            v-if="hasGoogle"
            block
            color="neutral"
            variant="outline"
            size="md"
            icon="i-simple-icons-google"
            :loading="reauthLoading"
            @click="handleGoogleReauth"
          >
            使用 Google 重新驗證
          </UButton>
          <p v-if="!canReauth" class="text-sm text-error">
            此帳號沒有可用的憑證來重新驗證，請聯絡管理員處理。
          </p>
        </div>

        <LazyUAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-alert-circle"
          :title="errorMessage"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 md:flex-row md:justify-end">
        <UButton
          color="neutral"
          variant="outline"
          size="md"
          block
          class="md:w-auto"
          :disabled="deleteLoading"
          @click="handleCancel"
        >
          取消
        </UButton>
        <UButton
          color="error"
          variant="solid"
          size="md"
          block
          class="md:w-auto"
          icon="i-lucide-trash-2"
          :loading="deleteLoading"
          :disabled="!reauthComplete"
          @click="handleConfirmDelete"
        >
          確認刪除
        </UButton>
      </div>
    </template>
  </UModal>
</template>
