<script setup lang="ts">
  import { assertNever } from '~~/shared/utils/assert-never'

  type DocumentStatus = 'draft' | 'active' | 'archived'

  interface Props {
    status: DocumentStatus
  }

  const props = defineProps<Props>()

  function getStatusConfig(status: DocumentStatus) {
    switch (status) {
      case 'draft':
        return {
          color: 'neutral' as const,
          label: '草稿',
          description: '尚未啟用，僅管理員可見',
        }
      case 'active':
        return {
          color: 'success' as const,
          label: '啟用',
          description: '已啟用，使用者可於知識庫查詢',
        }
      case 'archived':
        return {
          color: 'warning' as const,
          label: '已歸檔',
          description: '已下架，不再出現於查詢結果',
        }
      default:
        return assertNever(status, 'DocumentStatusBadge')
    }
  }

  const config = computed(() => getStatusConfig(props.status))
</script>

<template>
  <UTooltip :text="config.description">
    <UBadge :color="config.color" variant="subtle" size="sm">
      {{ config.label }}
    </UBadge>
  </UTooltip>
</template>
