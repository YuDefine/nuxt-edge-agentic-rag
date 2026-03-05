<script setup lang="ts">
  import { KNOWLEDGE_CHANNEL_VALUES } from '~~/shared/schemas/knowledge-runtime'
  import { assertNever } from '~~/shared/utils/assert-never'

  type QueryLogChannel = (typeof KNOWLEDGE_CHANNEL_VALUES)[number]

  interface Props {
    channel: QueryLogChannel
  }

  const props = defineProps<Props>()

  function getChannelConfig(channel: QueryLogChannel) {
    switch (channel) {
      case 'web':
        return { color: 'info' as const, label: 'Web' }
      case 'mcp':
        return { color: 'primary' as const, label: 'MCP' }
      default:
        return assertNever(channel, 'QueryLogChannelBadge')
    }
  }

  const config = computed(() => getChannelConfig(props.channel))
</script>

<template>
  <UBadge :color="config.color" variant="subtle" size="sm">
    {{ config.label }}
  </UBadge>
</template>
