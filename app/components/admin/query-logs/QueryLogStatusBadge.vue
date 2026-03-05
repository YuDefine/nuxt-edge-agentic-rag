<script setup lang="ts">
  import { assertNever } from '~~/shared/utils/assert-never'

  /**
   * Admin query log status badge.
   *
   * Matches server contract in `server/api/admin/query-logs/index.get.ts`:
   * status ∈ { accepted, blocked, limited, rejected }.
   */
  type QueryLogStatus = 'accepted' | 'blocked' | 'limited' | 'rejected'

  interface Props {
    status: QueryLogStatus
  }

  const props = defineProps<Props>()

  function getStatusConfig(status: QueryLogStatus) {
    switch (status) {
      case 'accepted':
        return {
          color: 'success' as const,
          label: '已接受',
          description: '查詢符合 governance 並回傳結果',
        }
      case 'blocked':
        return {
          color: 'error' as const,
          label: '已阻擋',
          description: '查詢觸發 governance 阻擋條件',
        }
      case 'limited':
        return {
          color: 'warning' as const,
          label: '限流',
          description: '查詢被 rate limit 限制',
        }
      case 'rejected':
        return {
          color: 'neutral' as const,
          label: '已拒絕',
          description: '查詢被拒絕（通常為未通過驗證）',
        }
      default:
        return assertNever(status, 'QueryLogStatusBadge')
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
