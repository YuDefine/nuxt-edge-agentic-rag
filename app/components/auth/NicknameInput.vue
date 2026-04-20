<script setup lang="ts">
  import { useDebounceFn } from '@vueuse/core'

  import {
    NICKNAME_ALLOWED_PATTERN,
    NICKNAME_MAX_LENGTH,
    NICKNAME_MIN_LENGTH,
  } from '#shared/schemas/nickname'
  import type { NicknameStatus } from '#shared/types/nickname'
  import { assertNever } from '#shared/utils/assert-never'
  import { getErrorMessage } from '#shared/utils/error-message'

  /**
   * passkey-authentication / nickname-identity-anchor — Nickname input
   * with debounced availability check.
   *
   * Emits `update:modelValue` for the raw string and `update:status` so
   * the parent form can gate its submit button on `status === 'available'`.
   *
   * Status life cycle:
   *   - `idle`       — user hasn't typed anything yet
   *   - `invalid`    — format doesn't match nickname schema
   *   - `checking`   — availability request is in flight
   *   - `available`  — server confirmed no existing row matches
   *   - `taken`      — server found a case-insensitive collision
   *   - `error`      — network / server error
   *
   * The `NicknameStatus` type lives in `#shared/types/nickname` so other
   * components (e.g. `PasskeyRegisterDialog`) can type their
   * `update:status` handlers without a circular SFC type import.
   */

  const props = defineProps<{
    modelValue: string
    disabled?: boolean
  }>()

  const emit = defineEmits<{
    'update:modelValue': [value: string]
    'update:status': [status: NicknameStatus]
  }>()

  const localValue = ref(props.modelValue)
  const status = ref<NicknameStatus>('idle')
  const errorMessage = ref('')

  watch(
    () => props.modelValue,
    (next) => {
      if (next !== localValue.value) localValue.value = next
    },
  )

  // Local format validation — mirrors shared nickname schema so the UI
  // can reject invalid input without a round trip.
  function validateFormat(raw: string): { ok: true } | { ok: false; message: string } {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return { ok: false, message: '請輸入暱稱' }
    }
    if (trimmed.length < NICKNAME_MIN_LENGTH) {
      return { ok: false, message: `暱稱至少需要 ${NICKNAME_MIN_LENGTH} 個字` }
    }
    if (trimmed.length > NICKNAME_MAX_LENGTH) {
      return { ok: false, message: `暱稱不可超過 ${NICKNAME_MAX_LENGTH} 個字` }
    }
    if (!NICKNAME_ALLOWED_PATTERN.test(trimmed)) {
      return { ok: false, message: '暱稱只能包含中英文字、數字、底線、連字號與空白' }
    }
    return { ok: true }
  }

  async function checkAvailability(nickname: string): Promise<void> {
    try {
      const result = await $fetch<{ data: { available: boolean } }>('/api/auth/nickname/check', {
        query: { nickname },
      })
      if (result.data.available) {
        status.value = 'available'
        errorMessage.value = ''
      } else {
        status.value = 'taken'
        errorMessage.value = '此暱稱已被使用，請嘗試其他名稱'
      }
    } catch (error) {
      status.value = 'error'
      errorMessage.value = getErrorMessage(error, '無法檢查暱稱可用性，請稍後再試')
    }
  }

  const debouncedCheck = useDebounceFn(checkAvailability, 500)

  async function handleInput(raw: string): Promise<void> {
    localValue.value = raw
    emit('update:modelValue', raw)

    const trimmed = raw.trim()
    const validation = validateFormat(trimmed)

    if (!validation.ok) {
      status.value = trimmed.length === 0 ? 'idle' : 'invalid'
      errorMessage.value = trimmed.length === 0 ? '' : validation.message
      return
    }

    status.value = 'checking'
    errorMessage.value = ''
    await debouncedCheck(trimmed)
  }

  watch(status, (next) => emit('update:status', next))

  function statusIcon(
    current: NicknameStatus,
  ): { name: string; ariaLabel: string; variant: 'muted' | 'success' | 'error' } | null {
    switch (current) {
      case 'idle':
        return null
      case 'checking':
        return {
          name: 'i-lucide-loader-2',
          ariaLabel: '檢查中',
          variant: 'muted',
        }
      case 'available':
        return {
          name: 'i-lucide-check-circle',
          ariaLabel: '暱稱可用',
          variant: 'success',
        }
      case 'invalid':
      case 'taken':
      case 'error':
        return {
          name: 'i-lucide-alert-circle',
          ariaLabel: '暱稱無法使用',
          variant: 'error',
        }
      default:
        return assertNever(current, 'NicknameInput.statusIcon')
    }
  }

  const currentIcon = computed(() => statusIcon(status.value))

  const helpText = computed(() => {
    switch (status.value) {
      case 'idle':
        return `${NICKNAME_MIN_LENGTH}–${NICKNAME_MAX_LENGTH} 字，中英文字、數字、底線、連字號皆可`
      case 'checking':
        return '正在檢查暱稱可用性…'
      case 'available':
        return '此暱稱可用'
      case 'invalid':
      case 'taken':
      case 'error':
        return errorMessage.value
      default:
        return assertNever(status.value, 'NicknameInput.helpText')
    }
  })

  const fieldColor = computed<'neutral' | 'success' | 'error'>(() => {
    switch (status.value) {
      case 'available':
        return 'success'
      case 'invalid':
      case 'taken':
      case 'error':
        return 'error'
      case 'idle':
      case 'checking':
        return 'neutral'
      default:
        return assertNever(status.value, 'NicknameInput.fieldColor')
    }
  })
</script>

<template>
  <UFormField label="暱稱" name="nickname" :help="helpText" :color="fieldColor" required>
    <div class="relative">
      <UInput
        :model-value="localValue"
        color="neutral"
        variant="outline"
        size="md"
        :maxlength="NICKNAME_MAX_LENGTH"
        :disabled="disabled"
        autocomplete="username"
        placeholder="例如：小明"
        aria-describedby="nickname-status"
        class="w-full"
        @update:model-value="(val: string | number) => handleInput(String(val))"
      />
      <span
        v-if="currentIcon"
        id="nickname-status"
        class="pointer-events-none absolute inset-y-0 right-3 flex items-center"
        :aria-label="currentIcon.ariaLabel"
      >
        <UIcon
          :name="currentIcon.name"
          class="size-5"
          :class="{
            'text-muted motion-reduce:animate-none': currentIcon.variant === 'muted',
            'animate-spin motion-reduce:animate-none': currentIcon.name === 'i-lucide-loader-2',
            'text-success': currentIcon.variant === 'success',
            'text-error': currentIcon.variant === 'error',
          }"
        />
      </span>
    </div>
  </UFormField>
</template>
