<script setup lang="ts">
  import { assertNever } from '~/utils/assert-never'

  type DocumentStatus = 'draft' | 'active' | 'archived'

  interface Props {
    status: DocumentStatus
  }

  const props = defineProps<Props>()

  function getStatusConfig(status: DocumentStatus) {
    switch (status) {
      case 'draft':
        return { color: 'neutral' as const, label: '草稿' }
      case 'active':
        return { color: 'success' as const, label: '啟用' }
      case 'archived':
        return { color: 'warning' as const, label: '已歸檔' }
      default:
        return assertNever(status, 'DocumentStatusBadge')
    }
  }

  const config = computed(() => getStatusConfig(props.status))
</script>

<template>
  <UBadge :color="config.color" variant="subtle" size="sm">
    {{ config.label }}
  </UBadge>
</template>
