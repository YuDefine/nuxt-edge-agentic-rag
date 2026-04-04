<script setup lang="ts">
  /**
   * observability-and-debug §3.1 — first-token + completion latency p50 / p95
   * cards per channel. NULL latencies render as "—" with an explanatory
   * hint, NEVER as 0.
   */
  import { formatNullableNumber } from '~/utils/debug-labels'

  interface LatencyBucket {
    p50: number | null
    p95: number | null
    sampleCount: number
  }

  interface Props {
    channel: string
    firstTokenMs: LatencyBucket
    completionMs: LatencyBucket
  }

  const props = defineProps<Props>()

  const firstTokenP50 = computed(() => formatNullableNumber(props.firstTokenMs.p50, ' ms'))
  const firstTokenP95 = computed(() => formatNullableNumber(props.firstTokenMs.p95, ' ms'))
  const completionP50 = computed(() => formatNullableNumber(props.completionMs.p50, ' ms'))
  const completionP95 = computed(() => formatNullableNumber(props.completionMs.p95, ' ms'))

  const hasNumericSamples = computed(() => props.firstTokenMs.sampleCount > 0)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-default">
          {{ channel }}
        </h3>
        <span class="text-xs text-muted" data-testid="sample-count">
          樣本數：{{ firstTokenMs.sampleCount }}
        </span>
      </div>
    </template>

    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">首 token p50</span>
        <span
          class="text-lg font-semibold"
          :class="firstTokenMs.p50 === null ? 'text-muted' : 'text-default'"
          data-testid="first-token-p50"
        >
          {{ firstTokenP50 }}
        </span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">首 token p95</span>
        <span
          class="text-lg font-semibold"
          :class="firstTokenMs.p95 === null ? 'text-muted' : 'text-default'"
          data-testid="first-token-p95"
        >
          {{ firstTokenP95 }}
        </span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">完成 p50</span>
        <span
          class="text-lg font-semibold"
          :class="completionMs.p50 === null ? 'text-muted' : 'text-default'"
          data-testid="completion-p50"
        >
          {{ completionP50 }}
        </span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">完成 p95</span>
        <span
          class="text-lg font-semibold"
          :class="completionMs.p95 === null ? 'text-muted' : 'text-default'"
          data-testid="completion-p95"
        >
          {{ completionP95 }}
        </span>
      </div>
    </div>

    <template v-if="!hasNumericSamples" #footer>
      <p class="text-xs text-muted">此通道於所選期間內無可量測的延遲樣本（全為 null）。</p>
    </template>
  </UCard>
</template>
