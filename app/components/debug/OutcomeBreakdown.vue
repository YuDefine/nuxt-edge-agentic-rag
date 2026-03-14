<script setup lang="ts">
  /**
   * observability-and-debug §3.2 — answered / refused / forbidden / error
   * horizontal bar breakdown. No chart lib — we render CSS bars to keep the
   * debug bundle slim and to avoid introducing new dependencies.
   */

  interface OutcomeBreakdown {
    answered: number
    refused: number
    forbidden: number
    error: number
  }

  interface Props {
    channel: string
    outcomes: OutcomeBreakdown
  }

  const props = defineProps<Props>()

  const total = computed(
    () =>
      props.outcomes.answered +
      props.outcomes.refused +
      props.outcomes.forbidden +
      props.outcomes.error,
  )

  interface Row {
    key: keyof OutcomeBreakdown
    label: string
    count: number
    color: string
  }

  const rows = computed<Row[]>(() => [
    { key: 'answered', label: '已回答', count: props.outcomes.answered, color: 'bg-success' },
    { key: 'refused', label: '拒答', count: props.outcomes.refused, color: 'bg-warning' },
    { key: 'forbidden', label: '阻擋', count: props.outcomes.forbidden, color: 'bg-error' },
    { key: 'error', label: '錯誤', count: props.outcomes.error, color: 'bg-error' },
  ])

  function percent(count: number): number {
    if (total.value === 0) return 0
    return Math.round((count / total.value) * 1000) / 10
  }
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-default">{{ channel }} 結果分布</h3>
        <span class="text-xs text-muted" data-testid="outcome-total">總數：{{ total }}</span>
      </div>
    </template>

    <div v-if="total === 0" class="py-6 text-center text-sm text-dimmed">
      此通道於所選期間內無記錄。
    </div>

    <ul v-else class="flex flex-col gap-3">
      <li
        v-for="row in rows"
        :key="row.key"
        class="flex flex-col gap-1"
        :data-testid="`outcome-${row.key}`"
      >
        <div class="flex items-center justify-between text-sm">
          <span class="text-default">{{ row.label }}</span>
          <span class="font-mono text-muted"> {{ row.count }} ({{ percent(row.count) }}%) </span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            class="h-full transition-all"
            :class="row.color"
            :style="{ width: `${percent(row.count)}%` }"
          />
        </div>
      </li>
    </ul>
  </UCard>
</template>
