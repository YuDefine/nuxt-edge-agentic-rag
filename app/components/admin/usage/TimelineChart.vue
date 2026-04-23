<script setup lang="ts">
  import type { UsageRange, UsageTimelineBucket } from '~~/shared/types/usage'
  import { buildUsageTimelineChartData } from '~~/app/utils/chart-series'

  interface Props {
    buckets: UsageTimelineBucket[]
    range: UsageRange
  }

  const props = defineProps<Props>()

  const chartData = computed(() => buildUsageTimelineChartData(props.buckets, props.range))

  function xFormatter(index: number): string {
    return chartData.value.data[index]?.label ?? ''
  }

  function yFormatter(value: number | Date): string {
    return typeof value === 'number' ? value.toLocaleString('en-US') : String(value)
  }
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-base font-semibold text-default">Tokens 時間分佈</h2>
        <span class="text-xs text-muted">依範圍自動分桶</span>
      </div>
    </template>

    <div v-if="props.buckets.length === 0" class="py-6 text-center text-sm text-muted">
      所選範圍尚無呼叫紀錄。
    </div>

    <div v-else data-testid="usage-timeline-chart">
      <LineChart
        :data="chartData.data"
        :categories="chartData.categories"
        :height="320"
        :hide-legend="true"
        :x-formatter="xFormatter"
        :y-formatter="yFormatter"
        :x-grid-line="false"
        :x-tick-line="false"
        :y-tick-line="false"
        :x-domain-line="false"
        :y-domain-line="false"
        :x-num-ticks="Math.min(chartData.data.length, 6)"
        y-label="Tokens"
      />
    </div>
  </UCard>
</template>
