<script setup lang="ts">
  import { assertNever } from '~~/shared/utils/assert-never'
  import type { UsageRange, UsageTimelineBucket } from '~~/shared/types/usage'

  interface Props {
    buckets: UsageTimelineBucket[]
    range: UsageRange
  }

  const props = defineProps<Props>()

  const maxTokens = computed(() => {
    if (props.buckets.length === 0) return 0
    return props.buckets.reduce((acc, bucket) => (bucket.tokens > acc ? bucket.tokens : acc), 0)
  })

  function barPercent(tokens: number): number {
    if (maxTokens.value === 0) return 0
    return Math.round((tokens / maxTokens.value) * 100)
  }

  function formatTimestamp(iso: string, range: UsageRange): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso

    switch (range) {
      case 'today':
        return `${date.getUTCHours().toString().padStart(2, '0')}:00`
      case '7d':
      case '30d':
        return `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}/${date
          .getUTCDate()
          .toString()
          .padStart(2, '0')}`
      default:
        return assertNever(range, 'TimelineChart.formatTimestamp')
    }
  }

  function describeBucket(bucket: UsageTimelineBucket): string {
    return `Tokens ${bucket.tokens.toLocaleString('en-US')} · Requests ${bucket.requests.toLocaleString('en-US')} · Cache ${bucket.cacheHits.toLocaleString('en-US')}`
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

    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="bucket in props.buckets"
        :key="bucket.timestamp"
        class="flex items-center gap-3"
        :title="describeBucket(bucket)"
      >
        <span class="w-14 shrink-0 text-xs text-muted tabular-nums">
          {{ formatTimestamp(bucket.timestamp, props.range) }}
        </span>
        <div class="relative h-5 flex-1 overflow-hidden rounded bg-elevated">
          <div
            class="h-full rounded bg-primary transition-all"
            :style="{ width: `${barPercent(bucket.tokens)}%` }"
            role="presentation"
          />
        </div>
        <span class="w-20 text-right text-sm font-medium text-default tabular-nums">
          {{ bucket.tokens.toLocaleString('en-US') }}
        </span>
      </li>
    </ul>
  </UCard>
</template>
