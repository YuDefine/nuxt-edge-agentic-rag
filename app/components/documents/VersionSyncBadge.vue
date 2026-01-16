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
        return { color: 'neutral' as const, label: '待同步' }
      case 'running':
        return { color: 'info' as const, label: '同步中' }
      case 'synced':
        return { color: 'success' as const, label: '已同步' }
      case 'failed':
        return { color: 'error' as const, label: '同步失敗' }
      default:
        return assertNever(status, 'VersionSyncBadge')
    }
  }

  const config = computed(() => getStatusConfig(props.status))
</script>

<template>
  <UBadge :color="config.color" variant="subtle" size="sm">
    {{ config.label }}
  </UBadge>
</template>
