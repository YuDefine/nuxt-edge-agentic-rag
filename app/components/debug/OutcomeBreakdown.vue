<script setup lang="ts">
  import type { OutcomeBreakdown } from '~~/shared/types/observability'
  import { buildOutcomeBreakdownChartData } from '~~/app/utils/chart-series'

  interface Props {
    channel: string
    outcomes: OutcomeBreakdown
  }

  const props = defineProps<Props>()

  const chartData = computed(() => buildOutcomeBreakdownChartData(props.outcomes))
  const total = computed(() => chartData.value.total)
  const rows = computed(() => chartData.value.rows)
  const yAxis = computed<Array<keyof OutcomeBreakdown>>(() => [...chartData.value.order])

  function percent(count: number): number {
    if (total.value === 0) return 0
    return Math.round((count / total.value) * 1000) / 10
  }

  function yFormatter(value: number | Date): string {
    return typeof value === 'number' ? value.toLocaleString('en-US') : String(value)
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

    <div v-if="total === 0" class="py-6 text-center text-sm text-muted">
      此通道於所選期間內無記錄。
    </div>

    <div v-else class="flex flex-col gap-4" data-testid="outcome-breakdown-chart">
      <BarChart
        :data="chartData.data"
        :categories="chartData.categories"
        :height="220"
        :hide-legend="true"
        :x-axis="'group'"
        :y-axis="yAxis"
        :x-grid-line="false"
        :x-tick-line="false"
        :y-tick-line="false"
        :x-domain-line="false"
        :y-domain-line="false"
        :y-formatter="yFormatter"
      />

      <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <li
          v-for="row in rows"
          :key="row.key"
          class="rounded-lg border border-default/60 bg-elevated/40 px-3 py-2"
          :data-testid="`outcome-${row.key}`"
        >
          <div class="flex items-center justify-between gap-3 text-sm">
            <div class="flex items-center gap-2">
              <span
                class="size-2.5 rounded-full"
                :style="{ backgroundColor: row.color }"
                aria-hidden="true"
              />
              <span class="text-default">{{ row.label }}</span>
            </div>
            <span class="font-mono text-muted">{{ row.count }} ({{ percent(row.count) }}%)</span>
          </div>
        </li>
      </ul>
    </div>
  </UCard>
</template>
