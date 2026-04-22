<script setup lang="ts">
  import { getErrorMessage } from '#shared/utils/error-message'
  import { getUiPageState } from '#shared/utils/ui-state'

  /**
   * passkey-authentication §11 — Account settings page.
   *
   * Surfaces the logged-in user's identity anchors and credentials:
   *   - Personal info (email, display_name — both read-only)
   *   - Passkey list + add button
   *   - Link Google button (visible only when email IS NULL)
   *   - Danger zone: self-deletion
   *
   * Permission: any signed-in user. `definePageMeta({ auth: true })`
   * routes anonymous visitors to the login page.
   */
  definePageMeta({
    auth: true,
  })

  interface CredentialsResponse {
    data: {
      email: string | null
      displayName: string | null
      hasGoogle: boolean
      passkeys: Array<{
        id: string
        name: string | null
        deviceType: string
        backedUp: boolean
        createdAt: string | null
      }>
    }
  }

  const { $csrfFetch } = useNuxtApp() as unknown as {
    $csrfFetch: typeof $fetch
  }
  // `useUserSession()` exposes authClient (`client`) + `signIn` (which
  // covers passkey + social) from `@onmax/nuxt-better-auth`. `addPasskey`
  // lives on the authClient itself (`client.passkey.addPasskey`).
  const { client, signIn } = useUserSession()
  const toast = useToast()
  const passkeyFeatureEnabled = computed<boolean>(
    () => useRuntimeConfig().public?.knowledge?.features?.passkey === true,
  )

  const { data, state, asyncStatus, error, refetch } = useQuery({
    key: () => ['account', 'credentials'],
    query: () => $fetch<CredentialsResponse>('/api/auth/me/credentials'),
  })

  const fetchStatus = computed(() => {
    const s = asyncStatus.value
    if (s === 'loading') return 'pending'
    if (state.value.status === 'error') return 'error'
    return 'success'
  })

  const credentials = computed(() => data.value?.data ?? null)
  const pageState = computed(() =>
    getUiPageState({
      error: (error.value as { statusCode?: number } | null) ?? null,
      itemCount: credentials.value ? 1 : 0,
      status: fetchStatus.value,
    }),
  )

  // Local action state.
  const addPasskeyLoading = ref(false)
  const addPasskeyError = ref('')
  const linkGoogleLoading = ref(false)
  const deleteDialogOpen = ref(false)
  const deletingPasskeyId = ref<string | null>(null)

  // Naming dialog — shown before the WebAuthn ceremony so users can
  // give each passkey a recognisable label (e.g. "MacBook Pro", "iPhone
  // 15"). Without this the plugin defaults to an empty name and the
  // list renders "未命名 passkey", which is indistinguishable when a
  // user has several devices registered.
  const nameDialogOpen = ref(false)
  const passkeyNameInput = ref('')
  const MAX_PASSKEY_NAME_LENGTH = 40

  function openNameDialog(): void {
    addPasskeyError.value = ''
    passkeyNameInput.value = ''
    nameDialogOpen.value = true
  }

  // Lockout guard — if this is the last passkey AND no Google account is
  // linked, revoking it would strand the user. Block the revoke button
  // so a single wrong click can't lock them out of their own account.
  const isLastCredential = computed<boolean>(
    () =>
      credentials.value !== null &&
      credentials.value.passkeys.length === 1 &&
      !credentials.value.hasGoogle,
  )

  async function handleAddPasskey(): Promise<void> {
    if (!client) {
      addPasskeyError.value = 'Passkey 尚未初始化，請重新整理頁面'
      return
    }
    const trimmed = passkeyNameInput.value.trim().slice(0, MAX_PASSKEY_NAME_LENGTH)
    if (!trimmed) {
      addPasskeyError.value = '請為此 passkey 命名，方便日後辨識'
      return
    }
    nameDialogOpen.value = false
    addPasskeyLoading.value = true
    addPasskeyError.value = ''
    try {
      const result = await client.passkey.addPasskey({ name: trimmed })
      if (result.error) {
        addPasskeyError.value = describePasskeyError(result.error, 'register')
        return
      }
      toast.add({
        title: 'Passkey 已新增',
        color: 'success',
        icon: 'i-lucide-check-circle',
      })
      await refetch()
    } catch (err) {
      addPasskeyError.value = describePasskeyError(err, 'register')
    } finally {
      addPasskeyLoading.value = false
    }
  }

  async function handleRevokePasskey(id: string): Promise<void> {
    deletingPasskeyId.value = id
    try {
      await $csrfFetch('/api/auth/passkey/delete-passkey', {
        method: 'POST',
        body: { id },
      })
      toast.add({
        title: 'Passkey 已撤銷',
        color: 'neutral',
        icon: 'i-lucide-check',
      })
      await refetch()
    } catch (err) {
      toast.add({
        title: '撤銷失敗',
        description: getErrorMessage(err, '請稍後再試'),
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
    } finally {
      deletingPasskeyId.value = null
    }
  }

  async function handleLinkGoogle(): Promise<void> {
    // TD-012: better-auth `linkSocial` state parser requires
    // `session.user.email` to be a non-null string, which rejects every
    // passkey-first user. The template button is `disabled` with an
    // explanatory alert; this guard prevents keyboard-race / programmatic
    // triggers from reaching a guaranteed-to-fail endpoint and surfacing
    // raw English errors via getErrorMessage.
    toast.add({
      title: '功能尚在開發中',
      description: '目前 passkey-only 帳號無法直接綁定 Google，請等待後續版本支援。',
      color: 'info',
      icon: 'i-lucide-info',
    })
  }

  function formatDate(dateString: string | null | undefined): string {
    if (!dateString) return '—'
    return new Date(dateString).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const showLinkGoogleSection = computed(
    () =>
      credentials.value !== null &&
      !credentials.value.hasGoogle &&
      credentials.value.email === null,
  )
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-bold text-default">帳號設定</h1>
      <p class="mt-1 text-sm text-muted">管理你的登入憑證、個人資料與帳號狀態。</p>
    </div>

    <UCard v-if="pageState === 'loading'">
      <div class="flex flex-col items-center justify-center py-16">
        <UIcon
          name="i-lucide-loader-2"
          class="mb-4 size-8 animate-spin text-muted motion-reduce:animate-none"
        />
        <p class="text-sm text-muted">載入中…</p>
      </div>
    </UCard>

    <UCard v-else-if="pageState === 'error'">
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
          <UIcon name="i-lucide-cloud-off" class="size-8 text-muted" />
        </div>
        <h3 class="mb-2 text-lg font-semibold text-default">無法載入帳號資訊</h3>
        <p class="mb-6 max-w-sm text-sm text-muted">連線可能暫時中斷，請稍後再試。</p>
        <UButton
          color="neutral"
          variant="outline"
          size="md"
          icon="i-lucide-refresh-cw"
          @click="refetch()"
        >
          重新載入
        </UButton>
      </div>
    </UCard>

    <template v-else-if="credentials">
      <!-- Personal Info -->
      <UCard>
        <template #header>
          <h2 class="text-lg font-semibold text-default">個人資料</h2>
        </template>
        <div class="flex flex-col gap-4">
          <UFormField label="暱稱" name="displayName" help="暱稱永久不可修改">
            <UInput
              :model-value="credentials.displayName ?? ''"
              color="neutral"
              variant="outline"
              size="md"
              disabled
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Email"
            name="email"
            help="Google 綁定時同步更新；passkey-only 帳號為空"
          >
            <UInput
              :model-value="credentials.email ?? ''"
              color="neutral"
              variant="outline"
              size="md"
              disabled
              placeholder="—"
              class="w-full"
            />
          </UFormField>
        </div>
      </UCard>

      <!-- Passkeys -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-lg font-semibold text-default">Passkey</h2>
            <UButton
              v-if="passkeyFeatureEnabled"
              color="neutral"
              variant="solid"
              size="sm"
              icon="i-lucide-plus"
              :loading="addPasskeyLoading"
              @click="openNameDialog"
            >
              新增 Passkey
            </UButton>
          </div>
        </template>

        <div class="flex flex-col gap-3">
          <LazyUAlert
            v-if="isLastCredential"
            color="warning"
            variant="subtle"
            icon="i-lucide-alert-triangle"
            title="這是你目前唯一的登入憑證"
            description="撤銷會讓你無法登入自己的帳號。請先新增第二個 passkey，或綁定 Google 帳號作為備援後再撤銷。"
          />

          <LazyUAlert
            v-else-if="credentials.passkeys.length === 1 && credentials.hasGoogle"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="只有一個 passkey"
            description="失去此裝置時仍可用 Google 帳號登入。若希望保留 passkey 作為主要入口，建議再新增一個。"
          />

          <LazyUAlert
            v-if="addPasskeyError"
            color="error"
            variant="subtle"
            icon="i-lucide-alert-circle"
            :title="addPasskeyError"
          />

          <div
            v-if="credentials.passkeys.length === 0"
            class="flex flex-col items-center justify-center py-10 text-center"
          >
            <UIcon name="i-lucide-key-round" class="mb-2 size-10 text-dimmed" />
            <p class="font-medium text-default">尚未綁定任何 passkey</p>
            <p class="mt-1 text-sm text-muted">新增 passkey 後可免密碼登入此裝置。</p>
          </div>

          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="passkey in credentials.passkeys"
              :key="passkey.id"
              class="flex items-center justify-between gap-2 rounded-md border border-default bg-elevated p-3"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-default">
                  {{ passkey.name || '未命名 passkey' }}
                </p>
                <p class="text-xs text-muted">
                  {{ passkey.deviceType === 'singleDevice' ? '本裝置專用' : '跨裝置同步' }} · 建立於
                  {{ formatDate(passkey.createdAt) }}
                </p>
              </div>
              <UButton
                color="error"
                variant="ghost"
                size="sm"
                icon="i-lucide-trash-2"
                :aria-label="isLastCredential ? '無法撤銷：這是唯一的登入憑證' : '撤銷 passkey'"
                :loading="deletingPasskeyId === passkey.id"
                :disabled="isLastCredential"
                @click="handleRevokePasskey(passkey.id)"
              >
                撤銷
              </UButton>
            </li>
          </ul>
        </div>
      </UCard>

      <!-- Link Google (only when email is null).
           TD-012: better-auth's linkSocial requires session.user.email to
           be non-null (state parse enforces string type), so passkey-first
           users currently cannot link Google through the built-in API.
           Button is disabled with an explanation until the custom
           link-google-for-passkey-first endpoint is built. -->
      <UCard v-if="showLinkGoogleSection">
        <template #header>
          <h2 class="text-lg font-semibold text-default">綁定 Google 帳號</h2>
        </template>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-muted">
            綁定 Google 後可用 Google 帳號登入，並在失去 passkey 時作為備援。若該 email
            屬於管理員，下次登入會自動升級為管理員。
          </p>
          <LazyUAlert
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="功能尚在開發中"
            description="目前 passkey-only 帳號無法直接綁定 Google，請等待後續版本支援；過渡期可先新增第二個 passkey 以確保登入備援。"
          />
          <UButton
            color="neutral"
            variant="solid"
            size="md"
            icon="i-simple-icons-google"
            disabled
            aria-label="綁定 Google 帳號（開發中）"
            :loading="linkGoogleLoading"
            @click="handleLinkGoogle"
          >
            綁定 Google 帳號
          </UButton>
        </div>
      </UCard>

      <!-- Danger zone -->
      <UCard>
        <template #header>
          <h2 class="text-lg font-semibold text-error">危險區域</h2>
        </template>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-muted">
            刪除帳號後所有資料將被清除，且無法復原。audit 紀錄會保留為法遵追溯。
          </p>
          <UButton
            color="error"
            variant="outline"
            size="md"
            icon="i-lucide-trash-2"
            class="md:w-fit"
            @click="deleteDialogOpen = true"
          >
            刪除我的帳號
          </UButton>
        </div>
      </UCard>
    </template>

    <LazyAuthDeleteAccountDialog
      v-if="credentials"
      v-model:open="deleteDialogOpen"
      :has-passkey="credentials.passkeys.length > 0"
      :has-google="credentials.hasGoogle"
    />

    <!-- Passkey naming dialog -->
    <UModal
      v-model:open="nameDialogOpen"
      title="為此 Passkey 命名"
      :dismissible="!addPasskeyLoading"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            命名有助於辨識不同裝置（例如「MacBook Pro」、「iPhone
            15」）。命名後瀏覽器會引導你用裝置建立 passkey。
          </p>
          <UFormField
            label="Passkey 名稱"
            name="passkeyName"
            :help="`最多 ${MAX_PASSKEY_NAME_LENGTH} 字，僅作為列表辨識用途`"
            required
          >
            <UInput
              v-model="passkeyNameInput"
              color="neutral"
              variant="outline"
              size="md"
              :maxlength="MAX_PASSKEY_NAME_LENGTH"
              :disabled="addPasskeyLoading"
              placeholder="例如：MacBook Pro"
              autocomplete="off"
              class="w-full"
              @keydown.enter.prevent="handleAddPasskey"
            />
          </UFormField>
          <LazyUAlert
            v-if="addPasskeyError"
            color="error"
            variant="subtle"
            icon="i-lucide-alert-circle"
            :title="addPasskeyError"
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
            :disabled="addPasskeyLoading"
            @click="nameDialogOpen = false"
          >
            取消
          </UButton>
          <UButton
            color="neutral"
            variant="solid"
            size="md"
            block
            class="md:w-auto"
            icon="i-lucide-fingerprint"
            :loading="addPasskeyLoading"
            :disabled="!passkeyNameInput.trim()"
            @click="handleAddPasskey"
          >
            建立 Passkey
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
