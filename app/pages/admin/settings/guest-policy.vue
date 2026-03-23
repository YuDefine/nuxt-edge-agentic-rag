<script setup lang="ts">
  import { assertNever } from '#shared/utils/assert-never'
  import { getErrorMessage } from '#shared/utils/error-message'
  import { DEFAULT_GUEST_POLICY, type GuestPolicy, guestPolicySchema } from '#shared/types/auth'

  /**
   * B16 §7.5 — Guest policy single-dial page.
   *
   * Shows a radio group of the three `guest_policy` values and saves via
   * PATCH /api/admin/settings/guest-policy. On save success the KV version
   * stamp is bumped server-side so other Worker instances pick up the
   * new value on their next request.
   */
  definePageMeta({
    middleware: ['admin'],
  })

  interface PolicyResponse {
    data: { value: GuestPolicy }
  }

  const { $csrfFetch } = useNuxtApp()
  const toast = useToast()

  const { data, status, error, refresh } = await useFetch<PolicyResponse>(
    '/api/admin/settings/guest-policy',
    {
      default: () => ({ data: { value: DEFAULT_GUEST_POLICY } }),
    },
  )

  const serverValue = computed<GuestPolicy>(() => {
    const raw = data.value?.data?.value
    const parsed = guestPolicySchema.safeParse(raw)
    return parsed.success ? parsed.data : DEFAULT_GUEST_POLICY
  })

  // Local selection — starts equal to server, diverges while editing.
  const selected = ref<GuestPolicy>(serverValue.value)

  watch(
    serverValue,
    (next) => {
      selected.value = next
    },
    { immediate: false },
  )

  const isDirty = computed(() => selected.value !== serverValue.value)
  const isSaving = ref(false)

  interface PolicyOption {
    value: GuestPolicy
    label: string
    description: string
  }

  function policyOption(value: GuestPolicy): PolicyOption {
    switch (value) {
      case 'same_as_member':
        return {
          value,
          label: '同成員（預設）',
          description:
            '訪客登入後即可提問並使用所有 Member 功能。適合開放註冊情境，以註冊事件本身作為篩選。',
        }
      case 'browse_only':
        return {
          value,
          label: '僅可瀏覽',
          description:
            '訪客可瀏覽內部範圍文件，但不能透過 Web Chat 或 MCP 提問。會在 Chat 頁顯示 banner 與 disabled input。',
        }
      case 'no_access':
        return {
          value,
          label: '完全不開放',
          description:
            '訪客登入後立即導向「帳號待審核」頁，所有功能路徑會回 403。需 Admin 手動升為 Member 才可使用。',
        }
      default:
        return assertNever(value, 'guestPolicyPage.policyOption')
    }
  }

  const policyItems = computed<PolicyOption[]>(() => [
    policyOption('same_as_member'),
    policyOption('browse_only'),
    policyOption('no_access'),
  ])

  const isLoading = computed(() => status.value === 'pending')
  const hasLoadError = computed(() => status.value === 'error')

  async function handleSave() {
    if (!isDirty.value) return
    const nextValue = selected.value
    isSaving.value = true
    try {
      await $csrfFetch('/api/admin/settings/guest-policy', {
        method: 'PATCH',
        body: { value: nextValue },
      })
      await refresh()
      toast.add({
        title: '訪客政策已更新',
        description: '新政策會於所有 Worker 實例下次請求時立即生效。',
        color: 'success',
        icon: 'i-lucide-check-circle',
      })
    } catch (err) {
      selected.value = serverValue.value
      toast.add({
        title: '訪客政策更新失敗',
        description: getErrorMessage(err, '請稍後再試'),
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
    } finally {
      isSaving.value = false
    }
  }

  function handleDiscard() {
    selected.value = serverValue.value
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-bold text-default">訪客政策</h1>
      <p class="mt-1 text-sm text-muted">
        控制訪客（Guest）登入後的預設行為。修改後新政策會透過 KV version stamp 於所有 Worker
        實例下次請求時立即生效。
      </p>
    </div>

    <UCard>
      <template v-if="isLoading">
        <div class="flex flex-col items-center justify-center py-12">
          <UIcon
            name="i-lucide-loader-2"
            class="mb-4 size-8 animate-spin text-muted motion-reduce:animate-none"
          />
          <p class="text-sm text-muted">載入中…</p>
        </div>
      </template>

      <template v-else-if="hasLoadError">
        <div class="flex flex-col items-center justify-center py-12 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-cloud-off" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入訪客政策</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">連線可能暫時中斷，請檢查網路後再試。</p>
          <UButton
            color="neutral"
            variant="outline"
            size="md"
            icon="i-lucide-refresh-cw"
            @click="() => refresh()"
          >
            重新載入
          </UButton>
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            class="mt-4"
            :title="getErrorMessage(error, '未知錯誤')"
          />
        </div>
      </template>

      <template v-else>
        <form class="flex flex-col gap-6" @submit.prevent="handleSave">
          <fieldset class="flex flex-col gap-3" :disabled="isSaving">
            <legend class="mb-2 text-sm font-medium text-default">請選擇一項訪客政策</legend>

            <label
              v-for="item in policyItems"
              :key="item.value"
              class="flex cursor-pointer items-start gap-3 rounded-md border border-default p-3 transition-colors hover:bg-elevated md:p-4"
              :class="{
                'border-default bg-accented': selected === item.value,
              }"
            >
              <input
                v-model="selected"
                type="radio"
                name="guest-policy"
                :value="item.value"
                class="mt-1 size-4 accent-primary"
                :aria-describedby="`guest-policy-desc-${item.value}`"
                :disabled="isSaving"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-default md:text-base">
                    {{ item.label }}
                  </span>
                  <UBadge
                    v-if="serverValue === item.value"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                  >
                    目前
                  </UBadge>
                </div>
                <p :id="`guest-policy-desc-${item.value}`" class="text-xs text-muted md:text-sm">
                  {{ item.description }}
                </p>
              </div>
            </label>
          </fieldset>

          <UAlert
            v-if="isDirty"
            color="warning"
            variant="subtle"
            icon="i-lucide-info"
            title="尚未儲存"
            description="選擇已變更，請按「儲存變更」套用，或按「取消」還原為目前政策。"
          />

          <div class="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              size="md"
              block
              class="md:w-auto"
              :disabled="!isDirty || isSaving"
              @click="handleDiscard"
            >
              取消
            </UButton>
            <UButton
              type="submit"
              color="neutral"
              variant="solid"
              size="md"
              block
              class="md:w-auto"
              icon="i-lucide-check"
              :loading="isSaving"
              :disabled="!isDirty"
            >
              儲存變更
            </UButton>
          </div>
        </form>
      </template>
    </UCard>
  </div>
</template>
