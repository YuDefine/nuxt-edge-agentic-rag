<script setup lang="ts">
  import { assertNever } from '~~/shared/utils/assert-never'
  import { USAGE_RANGE_VALUES, type UsageRange } from '~~/shared/types/usage'

  interface Props {
    modelValue: UsageRange
  }

  interface Emits {
    (event: 'update:modelValue', value: UsageRange): void
  }

  defineProps<Props>()
  const emit = defineEmits<Emits>()

  function rangeLabel(value: UsageRange): string {
    switch (value) {
      case 'today':
        return '今日'
      case '7d':
        return '近 7 天'
      case '30d':
        return '近 30 天'
      default:
        return assertNever(value, 'RangeSwitcher.rangeLabel')
    }
  }

  const items = computed(() =>
    USAGE_RANGE_VALUES.map((value) => ({
      label: rangeLabel(value),
      value,
    })),
  )

  function handleChange(value: UsageRange) {
    emit('update:modelValue', value)
  }
</script>

<template>
  <div
    role="tablist"
    aria-label="用量時間範圍"
    class="inline-flex gap-1 rounded-lg bg-elevated p-1"
  >
    <UButton
      v-for="item in items"
      :key="item.value"
      :color="modelValue === item.value ? 'primary' : 'neutral'"
      :variant="modelValue === item.value ? 'solid' : 'ghost'"
      size="sm"
      role="tab"
      :aria-selected="modelValue === item.value"
      @click="handleChange(item.value)"
    >
      {{ item.label }}
    </UButton>
  </div>
</template>
