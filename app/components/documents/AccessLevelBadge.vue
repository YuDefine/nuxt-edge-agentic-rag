<script setup lang="ts">
  import { assertNever } from '~/utils/assert-never'

  type AccessLevel = 'internal' | 'restricted'

  interface Props {
    level: AccessLevel
  }

  const props = defineProps<Props>()

  function getAccessConfig(level: AccessLevel) {
    switch (level) {
      case 'internal':
        return { color: 'neutral' as const, label: '內部' }
      case 'restricted':
        return { color: 'warning' as const, label: '受限' }
      default:
        return assertNever(level, 'AccessLevelBadge')
    }
  }

  const config = computed(() => getAccessConfig(props.level))
</script>

<template>
  <UBadge :color="config.color" variant="outline" size="sm">
    {{ config.label }}
  </UBadge>
</template>
