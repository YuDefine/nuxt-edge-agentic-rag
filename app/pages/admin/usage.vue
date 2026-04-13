<script setup lang="ts">
  import { useDocumentVisibility, useIntervalFn, useTimeAgo } from '@vueuse/core'

  import { getUiPageState } from '~~/shared/utils/ui-state'
  import type { UsageRange, UsageResponse, UsageSnapshot } from '~~/shared/types/usage'

  /**
   * AI Gateway usage dashboard.
   *
   * Polls `/api/admin/usage` every 60s while the tab is visible. Range
   * switcher changes the Pinia Colada query key so switching ranges
   * triggers a fresh fetch rather than reusing a stale cache. Auth is
   * enforced server-side (`requireRuntimeAdminSession`); the middleware
   * here also blocks non-admins client-side to skip a doomed call.
   */
  definePageMeta({
    middleware: ['admin'],
  })

  const range = ref<UsageRange>('today')

  const { data, state, asyncStatus, error, refetch } = useQuery({
    key: () => ['admin', 'usage', range.value],
    query: () => $fetch<UsageResponse>(`/api/admin/usage?range=${range.value}`),
    staleTime: 30_000,
  })

  // Pinia Colada does not expose `refetchInterval`; drive polling manually.
  // Pause when the tab is hidden so we honor spec "SHALL stop polling
  // when the page is hidden" and avoid burning the 100k logs/month free
  // quota on background tabs.
  const visibility = useDocumentVisibility()
  const polling = useIntervalFn(() => refetch(), 60_000, {
    immediateCallback: false,
  })

  watch(
    visibility,
    (current) => {
      if (current === 'visible') polling.resume()
      else polling.pause()
    },
    { immediate: true },
  )

  const EMPTY_SNAPSHOT: UsageSnapshot = {
    tokens: { input: 0, output: 0, total: 0 },
    neurons: { used: 0, freeQuotaPerDay: 10_000, remaining: 10_000 },
    requests: { total: 0, cached: 0, cacheHitRate: 0 },
    timeline: [],
    lastUpdatedAt: '',
  }

  const snapshot = computed<UsageSnapshot>(() => data.value?.data ?? EMPTY_SNAPSHOT)

  const fetchStatus = computed(() => {
    const s = asyncStatus.value
    if (s === 'loading') return 'pending'
    if (state.value.status === 'error') return 'error'
    return 'success'
  })

  const lastUpdatedDate = computed<Date | null>(() => {
    const iso = snapshot.value.lastUpdatedAt
    if (!iso) return null
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  })

  // useTimeAgo requires a non-null Date; fall back to epoch when we
  // have no data yet so the computed stays type-safe. The template
  // gates rendering via `v-if="lastUpdatedDate"` so the fallback value
  // is never shown.
  const lastUpdatedAgo = useTimeAgo(computed(() => lastUpdatedDate.value ?? new Date(0)))

  const pageState = computed(() => {
    const e = (error.value as { statusCode?: number } | null) ?? null
    return getUiPageState({
      error: e,
      itemCount: snapshot.value.requests.total > 0 ? 1 : 0,
      status: fetchStatus.value,
    })
  })
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-default">AI Gateway 用量</h1>
        <p class="mt-1 text-sm text-muted">
          顯示 Cloudflare AI Gateway 的 token 消耗、Neurons 使用與 cache 命中率。資料經 Cloudflare
          Analytics API 拉取，約有 1–2 分鐘延遲。
        </p>
      </div>
      <div class="flex items-center gap-2">
        <AdminUsageRangeSwitcher v-model="range" />
        <UButton
          color="neutral"
          variant="outline"
          size="md"
          icon="i-lucide-refresh-cw"
          aria-label="重新整理"
          @click="refetch()"
        >
          重新整理
        </UButton>
      </div>
    </div>

    <template v-if="pageState === 'loading'">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <USkeleton v-for="i in 4" :key="i" class="h-28 w-full" />
      </div>
      <USkeleton class="h-32 w-full" />
      <USkeleton class="h-64 w-full" />
    </template>

    <template v-else-if="pageState === 'unauthorized'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-shield-off" class="size-8 text-muted" aria-hidden="true" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">權限不足</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">此頁面僅限管理員使用，未顯示任何用量數字。</p>
          <UButton color="neutral" variant="outline" size="md" to="/">返回首頁</UButton>
        </div>
      </UCard>
    </template>

    <template v-else-if="pageState === 'error'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-cloud-off" class="size-8 text-muted" aria-hidden="true" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入用量資料</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            Cloudflare Analytics API 可能暫時不可用，或 gateway / 金鑰尚未設定完成。
          </p>
          <UButton
            color="neutral"
            variant="outline"
            size="md"
            icon="i-lucide-refresh-cw"
            @click="refetch()"
          >
            重新載入
          </UButton>
        </div>
      </UCard>
    </template>

    <template v-else-if="pageState === 'empty'">
      <AdminUsageOverviewCards
        :tokens-total="snapshot.tokens.total"
        :neurons-used="snapshot.neurons.used"
        :cache-hit-rate="snapshot.requests.cacheHitRate"
        :requests-total="snapshot.requests.total"
      />
      <AdminUsageQuotaProgress
        :used="snapshot.neurons.used"
        :free-quota-per-day="snapshot.neurons.freeQuotaPerDay"
        :remaining="snapshot.neurons.remaining"
      />
      <UCard>
        <div class="flex flex-col items-center justify-center py-10 text-center">
          <div class="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-bar-chart-3" class="size-7 text-default" aria-hidden="true" />
          </div>
          <h3 class="mb-2 text-base font-semibold text-default">此範圍內沒有呼叫紀錄</h3>
          <p class="mb-4 max-w-sm text-sm text-muted">
            試試切換到更長的時間範圍，或等 chat / MCP 用戶端發出第一次呼叫。
          </p>
        </div>
      </UCard>
    </template>

    <template v-else>
      <AdminUsageOverviewCards
        :tokens-total="snapshot.tokens.total"
        :neurons-used="snapshot.neurons.used"
        :cache-hit-rate="snapshot.requests.cacheHitRate"
        :requests-total="snapshot.requests.total"
      />
      <AdminUsageQuotaProgress
        :used="snapshot.neurons.used"
        :free-quota-per-day="snapshot.neurons.freeQuotaPerDay"
        :remaining="snapshot.neurons.remaining"
      />
      <AdminUsageTimelineChart :buckets="snapshot.timeline" :range="range" />
    </template>

    <p v-if="lastUpdatedDate" class="text-right text-xs text-muted">
      最後更新：{{ lastUpdatedAgo }}
    </p>
  </div>
</template>
