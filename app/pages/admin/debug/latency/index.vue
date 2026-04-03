<script setup lang="ts">
  /**
   * observability-and-debug §3 — latency + outcome summary page.
   *
   * Consumes `/api/admin/debug/latency/summary` (admin + prod-flag gated).
   * NULL p50 / p95 / sampleCount=0 render explicitly; never fabricated to 0.
   */

  definePageMeta({
    middleware: ['admin'],
  })

  interface LatencyBucket {
    p50: number | null
    p95: number | null
    sampleCount: number
  }

  interface OutcomeBreakdown {
    answered: number
    refused: number
    forbidden: number
    error: number
  }

  interface ChannelLatencySummary {
    channel: string
    firstTokenMs: LatencyBucket
    completionMs: LatencyBucket
    outcomes: OutcomeBreakdown
  }

  interface LatencySummary {
    channels: ChannelLatencySummary[]
    days: number
  }

  const days = ref<7 | 30>(7)

  interface DayOption {
    label: string
    value: 7 | 30
  }

  const dayOptions: DayOption[] = [
    { label: '近 7 天', value: 7 },
    { label: '近 30 天', value: 30 },
  ]

  const { data, status, error, refresh } = await useFetch<{ data: LatencySummary }>(
    '/api/admin/debug/latency/summary',
    {
      query: { days },
      watch: [days],
      key: 'debug-latency-summary',
    },
  )

  const summary = computed(() => data.value?.data ?? null)
  const channels = computed(() => summary.value?.channels ?? [])

  const isLoading = computed(() => status.value === 'pending')

  type UiPageState = 'loading' | 'unauthorized' | 'empty' | 'error' | 'ready'

  const errorStatusCode = computed(() => {
    const code = (error.value as { statusCode?: number } | null)?.statusCode ?? null
    return typeof code === 'number' ? code : null
  })

  const pageState = computed<UiPageState>(() => {
    if (isLoading.value) return 'loading'
    if (error.value) {
      if (errorStatusCode.value === 401 || errorStatusCode.value === 403) {
        return 'unauthorized'
      }
      return 'error'
    }
    if (channels.value.length === 0) return 'empty'
    return 'ready'
  })
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-default">Debug · 延遲與結果分布</h1>
        <p class="mt-1 text-sm text-muted">內部觀測儀表板，Admin 專用。</p>
      </div>
      <div class="flex items-center gap-2">
        <USelectMenu
          v-model="days"
          :items="dayOptions"
          value-key="value"
          color="neutral"
          size="sm"
          class="w-36"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          :loading="isLoading"
          @click="refresh()"
        >
          重新整理
        </UButton>
      </div>
    </div>

    <!-- Loading -->
    <template v-if="pageState === 'loading'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16">
          <UIcon
            name="i-lucide-loader-2"
            class="mb-4 size-8 animate-spin text-muted motion-reduce:animate-none"
          />
          <p class="text-sm text-muted">載入延遲統計中...</p>
        </div>
      </UCard>
    </template>

    <!-- Unauthorized -->
    <template v-else-if="pageState === 'unauthorized'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <UIcon name="i-lucide-shield-off" class="mb-4 size-10 text-warning" />
          <h2 class="mb-2 text-lg font-semibold text-default">無權限存取</h2>
          <p class="max-w-md text-sm text-muted">
            內部 Debug 介面需 Admin 權限，且 production 需開啟
            <code class="rounded bg-muted px-1">NUXT_DEBUG_SURFACE_ENABLED</code> 旗標。
          </p>
        </div>
      </UCard>
    </template>

    <!-- Empty -->
    <template v-else-if="pageState === 'empty'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <UIcon name="i-lucide-inbox" class="mb-4 size-10 text-muted" />
          <h2 class="mb-2 text-lg font-semibold text-default">所選期間內無任何記錄</h2>
          <p class="text-sm text-muted">請嘗試切換期間或稍後再查詢。</p>
        </div>
      </UCard>
    </template>

    <!-- Error -->
    <template v-else-if="pageState === 'error'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <UIcon name="i-lucide-cloud-off" class="mb-4 size-10 text-error" />
          <h2 class="mb-2 text-lg font-semibold text-default">無法載入統計</h2>
          <p class="mb-6 max-w-sm text-sm text-muted">後端回應異常，請稍後再試。</p>
          <UButton
            color="neutral"
            variant="outline"
            size="md"
            icon="i-lucide-refresh-cw"
            @click="refresh()"
          >
            重試
          </UButton>
        </div>
      </UCard>
    </template>

    <!-- Ready -->
    <template v-else>
      <!-- h2 is visually hidden + referenced by aria-labelledby to fix
           heading-order (h1 → h3 was flagged) with a single source of
           truth for the region name. -->
      <section
        aria-labelledby="latency-distribution-heading"
        class="grid grid-cols-1 gap-4 lg:grid-cols-2"
      >
        <h2 id="latency-distribution-heading" class="sr-only">延遲分布</h2>
        <DebugLatencySummaryCards
          v-for="channel in channels"
          :key="`latency-${channel.channel}`"
          :channel="channel.channel"
          :first-token-ms="channel.firstTokenMs"
          :completion-ms="channel.completionMs"
        />
      </section>

      <!-- Outcome breakdown grid -->
      <section
        aria-labelledby="outcome-distribution-heading"
        class="grid grid-cols-1 gap-4 lg:grid-cols-2"
      >
        <h2 id="outcome-distribution-heading" class="sr-only">結果分布</h2>
        <DebugOutcomeBreakdown
          v-for="channel in channels"
          :key="`outcome-${channel.channel}`"
          :channel="channel.channel"
          :outcomes="channel.outcomes"
        />
      </section>
    </template>
  </div>
</template>
