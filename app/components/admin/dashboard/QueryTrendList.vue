<script setup lang="ts">
  /**
   * Coarse 7-day query trend display.
   *
   * Shows only aggregate daily counts. Never renders raw query text or any
   * per-row source material. If the parent passes an empty array, the
   * component renders a minimal "no activity" message — but the outer
   * page is responsible for global empty/loading/error coordination.
   */
  interface TrendPoint {
    count: number
    date: string
  }

  interface Props {
    points: TrendPoint[]
  }

  const props = defineProps<Props>()

  const maxCount = computed(() => {
    if (props.points.length === 0) return 0
    return props.points.reduce((acc, p) => (p.count > acc ? p.count : acc), 0)
  })

  function barPercent(count: number): number {
    if (maxCount.value === 0) return 0
    return Math.round((count / maxCount.value) * 100)
  }

  function formatShortDate(iso: string): string {
    // iso is 'YYYY-MM-DD' (UTC bucket) — render as MM/DD for compact display.
    const parts = iso.split('-')
    if (parts.length !== 3) return iso
    return `${parts[1]}/${parts[2]}`
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="props.points.length === 0" class="text-sm text-muted">最近 7 天尚無查詢資料。</div>
    <ul v-else class="flex flex-col gap-2">
      <li v-for="point in props.points" :key="point.date" class="flex items-center gap-3">
        <span class="w-14 text-xs text-muted">{{ formatShortDate(point.date) }}</span>
        <div class="relative h-6 flex-1 overflow-hidden rounded bg-elevated">
          <div
            class="h-full rounded bg-primary transition-all"
            :style="{ width: `${barPercent(point.count)}%` }"
            role="presentation"
          />
        </div>
        <span class="w-12 text-right text-sm font-medium text-default tabular-nums">
          {{ point.count }}
        </span>
      </li>
    </ul>
  </div>
</template>
