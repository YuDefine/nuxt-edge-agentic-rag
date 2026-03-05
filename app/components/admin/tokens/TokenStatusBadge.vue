<script setup lang="ts">
  import { assertNever } from '~~/shared/utils/assert-never'

  /**
   * Admin MCP token status badge.
   *
   * Matches server contract in `server/utils/mcp-token-store.ts` — the admin
   * list endpoint returns `status: 'active' | 'revoked' | 'expired'`.
   */
  type TokenStatus = 'active' | 'revoked' | 'expired'

  interface Props {
    status: TokenStatus
  }

  const props = defineProps<Props>()

  function getStatusConfig(status: TokenStatus) {
    switch (status) {
      case 'active':
        return {
          color: 'success' as const,
          label: '啟用中',
          description: '可使用的有效 token',
        }
      case 'revoked':
        return {
          color: 'neutral' as const,
          label: '已撤銷',
          description: '已由管理員撤銷，不可再使用',
        }
      case 'expired':
        return {
          color: 'warning' as const,
          label: '已過期',
          description: '已到期，不可再使用',
        }
      default:
        return assertNever(status, 'TokenStatusBadge')
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
