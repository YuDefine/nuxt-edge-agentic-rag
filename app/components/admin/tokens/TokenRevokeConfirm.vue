<script setup lang="ts">
  interface Props {
    loading?: boolean
    open: boolean
    tokenName: string
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{
    'update:open': [value: boolean]
    confirm: []
    cancel: []
  }>()

  function handleCancel() {
    emit('update:open', false)
    emit('cancel')
  }

  function handleConfirm() {
    emit('confirm')
  }
</script>

<template>
  <UModal
    :open="props.open"
    title="撤銷 MCP Token"
    :dismissible="!props.loading"
    @update:open="(value) => emit('update:open', value)"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <p class="text-sm text-default">
          確定要撤銷
          <span class="font-semibold">「{{ props.tokenName }}」</span>
          嗎？撤銷後該 token 將立刻失效且無法復原。
        </p>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          description="撤銷為不可逆動作；若需繼續使用，請重新建立新的 token。"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          size="md"
          :disabled="props.loading"
          @click="handleCancel"
        >
          取消
        </UButton>
        <UButton
          color="error"
          variant="solid"
          size="md"
          :loading="props.loading"
          @click="handleConfirm"
        >
          確認撤銷
        </UButton>
      </div>
    </template>
  </UModal>
</template>
