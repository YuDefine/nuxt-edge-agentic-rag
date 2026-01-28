<script setup lang="ts">
  import { assertNever } from '~/utils/assert-never'

  type SyncStatus = 'pending' | 'running' | 'synced' | 'failed'

  interface Props {
    status: SyncStatus
  }

  const props = defineProps<Props>()

  function getStatusConfig(status: SyncStatus) {
    switch (status) {
      case 'pending':
        return {
          color: 'neutral' as const,
          label: '待同步',
          description: '等待同步到儲存空間',
        }
      case 'running':
        return {
          color: 'info' as const,
          label: '同步中',
          description: '正在同步檔案內容至儲存空間',
        }
      case 'synced':
        return {
          color: 'success' as const,
          label: '已同步',
          description: '檔案已同步完成',
        }
      case 'failed':
        return {
          color: 'error' as const,
          label: '同步失敗',
          description: '同步過程發生錯誤，需要重試',
        }
      default:
        return assertNever(status, 'VersionSyncBadge')
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
