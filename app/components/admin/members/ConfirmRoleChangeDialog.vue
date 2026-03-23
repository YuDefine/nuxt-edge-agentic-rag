<script setup lang="ts">
  import { assertNever } from '#shared/utils/assert-never'
  import { getErrorMessage } from '#shared/utils/error-message'
  import { roleLabel, type Role } from '#shared/types/auth'
  import type { AdminMemberRow } from '#shared/types/admin-members'

  /**
   * B16 §7.4 — Two-step confirmation modal for role change.
   *
   * Shows the target user's email, current role, and destination role,
   * plus a free-text `reason` field that is passed through to the PATCH
   * endpoint's audit row.
   */

  const props = defineProps<{
    open: boolean
    member: AdminMemberRow | null
    targetRole: Role | null
  }>()

  const emit = defineEmits<{
    'update:open': [value: boolean]
    updated: []
  }>()

  const { $csrfFetch } = useNuxtApp()
  const toast = useToast()

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  })

  const reason = ref('')
  const isSubmitting = ref(false)

  watch(
    () => props.open,
    (next) => {
      if (next) reason.value = ''
    },
  )

  function transitionWarning(target: Role): string {
    switch (target) {
      case 'admin':
        return '此角色由伺服器設定管理，無法由 UI 變更。'
      case 'member':
        return '此使用者將可提問並使用所有 Member 權限。'
      case 'guest':
        return '此使用者將會降級為訪客，能否提問取決於目前的訪客政策。'
      default:
        return assertNever(target, 'ConfirmRoleChangeDialog.transitionWarning')
    }
  }

  async function handleConfirm() {
    if (!props.member || !props.targetRole) return
    isSubmitting.value = true
    try {
      await $csrfFetch(`/api/admin/members/${props.member.id}`, {
        method: 'PATCH',
        body: {
          role: props.targetRole,
          reason: reason.value.trim() || undefined,
        },
      })
      toast.add({
        title: '角色已更新',
        description: `${props.member.email ?? props.member.id} → ${roleLabel(props.targetRole)}`,
        color: 'success',
        icon: 'i-lucide-check-circle',
      })
      emit('updated')
      isOpen.value = false
    } catch (error) {
      const message = getErrorMessage(error, '角色更新失敗，請稍後再試')
      toast.add({
        title: '角色更新失敗',
        description: message,
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
    } finally {
      isSubmitting.value = false
    }
  }

  function handleCancel() {
    isOpen.value = false
  }
</script>

<template>
  <UModal v-model:open="isOpen" :title="member ? '確認變更角色' : ''" :dismissible="!isSubmitting">
    <template #body>
      <div v-if="member && targetRole" class="flex flex-col gap-4 text-sm text-default">
        <p class="text-default">
          確定要將以下使用者的角色變更為
          <span class="font-semibold">{{ roleLabel(targetRole) }}</span>
          嗎？
        </p>

        <div class="rounded-md border border-default bg-elevated p-3">
          <p class="text-xs font-medium text-muted">Email</p>
          <p class="mt-0.5 text-sm font-medium break-all text-default">
            {{ member.email ?? '（未提供）' }}
          </p>
          <p class="mt-3 text-xs font-medium text-muted">目前角色 → 目標角色</p>
          <p class="mt-0.5 text-sm text-default">
            {{ roleLabel(member.role) }}
            <UIcon name="i-lucide-arrow-right" class="mx-1 size-4 text-muted" aria-hidden="true" />
            <span class="font-semibold">{{ roleLabel(targetRole) }}</span>
          </p>
        </div>

        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-info"
          :title="transitionWarning(targetRole)"
        />

        <UFormField
          label="備註（選填）"
          name="reason"
          help="此備註將寫入 audit row，便於日後追溯。"
        >
          <UTextarea
            v-model="reason"
            placeholder="例如：2026Q2 正式入職，開通成員權限"
            :rows="2"
            :maxlength="500"
            :disabled="isSubmitting"
            class="w-full"
          />
        </UFormField>
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
          :disabled="isSubmitting"
          @click="handleCancel"
        >
          取消
        </UButton>
        <UButton
          color="neutral"
          variant="solid"
          size="md"
          block
          class="md:w-auto"
          icon="i-lucide-check"
          :loading="isSubmitting"
          :disabled="!member || !targetRole"
          @click="handleConfirm"
        >
          確認變更
        </UButton>
      </div>
    </template>
  </UModal>
</template>
