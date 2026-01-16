<script setup lang="ts">
  import { assertNever } from '~/utils/assert-never'

  type IndexStatus = 'pending' | 'preprocessing' | 'indexing' | 'indexed' | 'failed'

  interface Props {
    status: IndexStatus
  }

  const props = defineProps<Props>()

  function getStatusConfig(status: IndexStatus) {
    switch (status) {
      case 'pending':
        return { color: 'neutral' as const, label: '待索引' }
      case 'preprocessing':
        return { color: 'info' as const, label: '前處理中' }
      case 'indexing':
        return { color: 'info' as const, label: '索引中' }
      case 'indexed':
        return { color: 'success' as const, label: '已索引' }
      case 'failed':
        return { color: 'error' as const, label: '索引失敗' }
      default:
        return assertNever(status, 'VersionIndexBadge')
    }
  }

  const config = computed(() => getStatusConfig(props.status))
</script>

<template>
  <UBadge :color="config.color" variant="subtle" size="sm">
    {{ config.label }}
  </UBadge>
</template>
