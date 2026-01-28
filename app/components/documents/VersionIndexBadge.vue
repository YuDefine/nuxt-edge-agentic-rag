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
        return {
          color: 'neutral' as const,
          label: '待索引',
          description: '等待建立 AI 搜尋索引',
        }
      case 'preprocessing':
        return {
          color: 'info' as const,
          label: '前處理中',
          description: '正在擷取並切分文件內容',
        }
      case 'indexing':
        return {
          color: 'info' as const,
          label: '索引中',
          description: '正在建立向量索引',
        }
      case 'indexed':
        return {
          color: 'success' as const,
          label: '已索引',
          description: '已可於 AI 知識查詢中檢索',
        }
      case 'failed':
        return {
          color: 'error' as const,
          label: '索引失敗',
          description: '索引過程發生錯誤，需要重試',
        }
      default:
        return assertNever(status, 'VersionIndexBadge')
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
