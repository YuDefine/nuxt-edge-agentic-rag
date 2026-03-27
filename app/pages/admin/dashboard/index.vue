<script setup lang="ts">
  import { getUiPageState } from '~~/shared/utils/ui-state'

  /**
   * Admin Summary Dashboard page.
   *
   * Feature-gated by `features.adminDashboard`; when the flag is off the
   * server returns 404 and the UI renders a dedicated "feature disabled"
   * surface. Auth is enforced server-side via `requireRuntimeAdminSession`.
   *
   * The page presents coarse aggregates only — documents total, recent query
   * volume, active token count, and a 7-day trend bar list. No raw rows.
   */
  definePageMeta({
    middleware: ['admin'],
  })

  interface SummaryCards {
    documentsTotal: number
    queriesLast30Days: number
    tokensActive: number
  }

  interface TrendPoint {
    count: number
    date: string
  }

  interface SummaryResponse {
    data: {
      cards: SummaryCards
      trend: TrendPoint[]
    }
  }

  const runtimeConfig = useRuntimeConfig()
  const featureEnabled = computed(() => runtimeConfig.public?.adminDashboardEnabled ?? true)

  const { data, state, asyncStatus, error, refetch } = useQuery({
    key: ['admin', 'dashboard', 'summary'],
    query: () => $fetch<SummaryResponse>('/api/admin/dashboard/summary'),
    // Short stale time: the dashboard is expected to be re-opened often
    // and admins want "roughly current" numbers without every refetch.
    staleTime: 30_000,
    enabled: () => featureEnabled.value,
  })

  const cards = computed<SummaryCards>(
    () =>
      data.value?.data?.cards ?? {
        documentsTotal: 0,
        queriesLast30Days: 0,
        tokensActive: 0,
      },
  )

  const trend = computed<TrendPoint[]>(() => data.value?.data?.trend ?? [])

  const fetchStatus = computed(() => {
    const s = asyncStatus.value
    if (s === 'loading') return 'pending'
    if (state.value.status === 'error') return 'error'
    return 'success'
  })

  // Dashboard page is a summary-only surface: "empty" is unusual but we still
  // show it if ALL three cards are zero AND no trend points exist; that
  // communicates "no activity yet" distinctly from "still loading".
  const hasAnyData = computed(() => {
    const c = cards.value
    return (
      c.documentsTotal > 0 ||
      c.queriesLast30Days > 0 ||
      c.tokensActive > 0 ||
      trend.value.length > 0
    )
  })

  const pageState = computed(() => {
    const e = (error.value as { statusCode?: number } | null) ?? null
    // Feature-disabled 404 is routed to a distinct surface, not "error".
    if (e?.statusCode === 404) return 'feature-off'
    return getUiPageState({
      error: e,
      itemCount: hasAnyData.value ? 1 : 0,
      status: fetchStatus.value,
    })
  })
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-default">管理摘要</h1>
        <p class="mt-1 text-sm text-muted">檢視文件、查詢與 token 的概況。僅顯示彙整資料。</p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        size="md"
        icon="i-lucide-refresh-cw"
        @click="refetch()"
      >
        重新整理
      </UButton>
    </div>

    <!-- Feature flag disabled (runtime public or server 404) -->
    <template v-if="!featureEnabled || pageState === 'feature-off'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-power-off" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">管理摘要目前未啟用</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            此環境的
            <code class="font-mono text-xs">features.adminDashboard</code>
            已關閉。如需啟用請洽系統管理員。
          </p>
          <UButton color="neutral" variant="outline" size="md" to="/admin/documents">
            前往文件管理
          </UButton>
        </div>
      </UCard>
    </template>

    <!-- Loading -->
    <template v-else-if="pageState === 'loading'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16">
          <UIcon
            name="i-lucide-loader-2"
            class="mb-4 size-8 animate-spin text-muted motion-reduce:animate-none"
          />
          <p class="text-sm text-muted">載入中...</p>
        </div>
      </UCard>
    </template>

    <!-- Unauthorized -->
    <template v-else-if="pageState === 'unauthorized'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-shield-off" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">權限不足</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">此頁面僅限管理員使用。</p>
          <UButton color="neutral" variant="outline" size="md" to="/">返回首頁</UButton>
        </div>
      </UCard>
    </template>

    <!-- Error -->
    <template v-else-if="pageState === 'error'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-cloud-off" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入摘要</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">連線可能暫時中斷，請稍後再試。</p>
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

    <!-- Empty (no aggregates yet) -->
    <template v-else-if="pageState === 'empty'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-bar-chart-3" class="size-8 text-default" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">尚無營運資料</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            文件、查詢與 token 的統計會在使用後累積；現在尚未有任何活動。
          </p>
          <UButton color="primary" variant="solid" size="md" to="/admin/documents">
            開始管理文件
          </UButton>
        </div>
      </UCard>
    </template>

    <!-- Success — render summary cards + trend -->
    <template v-else>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AdminDashboardSummaryCard
          label="文件總數"
          :value="cards.documentsTotal"
          description="未封存的文件"
          icon="i-lucide-file-text"
        />
        <AdminDashboardSummaryCard
          label="近 30 天查詢"
          :value="cards.queriesLast30Days"
          description="Web + MCP 合計"
          icon="i-lucide-search"
        />
        <AdminDashboardSummaryCard
          label="啟用中 Token"
          :value="cards.tokensActive"
          description="尚未撤銷或到期"
          icon="i-lucide-key"
        />
      </div>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold text-default">近 7 天查詢趨勢</h2>
            <span class="text-xs text-muted">每日彙整，僅顯示數量</span>
          </div>
        </template>
        <AdminDashboardQueryTrendList :points="trend" />
      </UCard>
    </template>
  </div>
</template>
