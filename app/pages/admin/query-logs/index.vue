<script setup lang="ts">
  import type { TableColumn } from '@nuxt/ui'

  import { KNOWLEDGE_CHANNEL_VALUES } from '~~/shared/schemas/knowledge-runtime'
  import { srOnlyHeader } from '~~/shared/utils/table'
  import { getUiPageState } from '~~/shared/utils/ui-state'

  /**
   * Admin Query Log list page.
   *
   * Server truth: GET /api/admin/query-logs — returns redaction-safe rows
   * only (query_redacted_text, never raw query). Gated by
   * `requireRuntimeAdminSession`.
   */
  definePageMeta({
    middleware: ['admin'],
  })

  interface QueryLogRow {
    channel: string
    configSnapshotVersion: string
    createdAt: string
    environment: string
    id: string
    queryRedactedText: string
    redactionApplied: boolean
    riskFlagsJson: string
    status: 'accepted' | 'blocked' | 'limited' | 'rejected'
  }

  interface ListResponse {
    data: QueryLogRow[]
    pagination: { page: number; pageSize: number; total: number }
  }

  interface SelectOption {
    value: string
    label: string
  }

  const ALL_OPTION_VALUE = 'all'

  const STATUS_OPTIONS: SelectOption[] = [
    { value: ALL_OPTION_VALUE, label: '全部狀態' },
    { value: 'accepted', label: '已接受' },
    { value: 'blocked', label: '已阻擋' },
    { value: 'limited', label: '限流' },
    { value: 'rejected', label: '已拒絕' },
  ]

  const CHANNEL_OPTIONS: SelectOption[] = [
    { value: ALL_OPTION_VALUE, label: '全部來源' },
    ...KNOWLEDGE_CHANNEL_VALUES.map((c) => ({
      value: c as string,
      label: c === 'web' ? 'Web' : 'MCP',
    })),
  ]

  const REDACTION_OPTIONS: SelectOption[] = [
    { value: ALL_OPTION_VALUE, label: '全部' },
    { value: 'true', label: '已遮罩' },
    { value: 'false', label: '未遮罩' },
  ]

  const filters = reactive({
    channel: ALL_OPTION_VALUE,
    status: ALL_OPTION_VALUE,
    redactionApplied: ALL_OPTION_VALUE,
    startDate: '',
    endDate: '',
  })

  const queryParams = computed(() => {
    const params: Record<string, string> = {}
    if (filters.channel !== ALL_OPTION_VALUE) params.channel = filters.channel
    if (filters.status !== ALL_OPTION_VALUE) params.status = filters.status
    if (filters.redactionApplied !== ALL_OPTION_VALUE) {
      params.redactionApplied = filters.redactionApplied
    }
    if (filters.startDate) params.startDate = filters.startDate
    if (filters.endDate) params.endDate = filters.endDate
    return params
  })

  const { data, state, asyncStatus, error, refetch } = useQuery({
    key: () => ['admin', 'query-logs', queryParams.value],
    query: () =>
      $fetch<ListResponse>('/api/admin/query-logs', {
        query: queryParams.value,
      }),
  })

  const fetchStatus = computed(() => {
    const s = asyncStatus.value
    if (s === 'loading') return 'pending'
    if (state.value.status === 'error') return 'error'
    return 'success'
  })

  const logs = computed<QueryLogRow[]>(() => data.value?.data ?? [])

  const pageState = computed(() =>
    getUiPageState({
      error: (error.value as { statusCode?: number } | null) ?? null,
      itemCount: logs.value.length,
      status: fetchStatus.value,
    }),
  )

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function resetFilters() {
    filters.channel = ALL_OPTION_VALUE
    filters.status = ALL_OPTION_VALUE
    filters.redactionApplied = ALL_OPTION_VALUE
    filters.startDate = ''
    filters.endDate = ''
  }

  const columns: TableColumn<QueryLogRow>[] = [
    { accessorKey: 'createdAt', header: '時間' },
    { accessorKey: 'channel', header: '來源' },
    { accessorKey: 'status', header: '狀態' },
    { accessorKey: 'queryRedactedText', header: '查詢內容（已遮罩）' },
    { accessorKey: 'redactionApplied', header: '遮罩' },
    { id: 'actions', header: srOnlyHeader('操作') },
  ]
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-default">查詢日誌</h1>
        <p class="mt-1 text-sm text-muted">
          檢視 governance 遮罩後的查詢紀錄；原始查詢文字永不顯示。
        </p>
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

    <UCard>
      <div class="flex flex-wrap items-end gap-3">
        <UFormField label="來源" name="channel" size="xs">
          <USelect
            v-model="filters.channel"
            :items="CHANNEL_OPTIONS"
            value-key="value"
            color="neutral"
            variant="outline"
            size="md"
            class="min-w-32"
          />
        </UFormField>
        <UFormField label="狀態" name="status" size="xs">
          <USelect
            v-model="filters.status"
            :items="STATUS_OPTIONS"
            value-key="value"
            color="neutral"
            variant="outline"
            size="md"
            class="min-w-32"
          />
        </UFormField>
        <UFormField label="遮罩狀態" name="redactionApplied" size="xs">
          <USelect
            v-model="filters.redactionApplied"
            :items="REDACTION_OPTIONS"
            value-key="value"
            color="neutral"
            variant="outline"
            size="md"
            class="min-w-32"
          />
        </UFormField>
        <UFormField label="開始日期" name="startDate" size="xs">
          <UInput
            v-model="filters.startDate"
            type="date"
            color="neutral"
            variant="outline"
            size="md"
          />
        </UFormField>
        <UFormField label="結束日期" name="endDate" size="xs">
          <UInput
            v-model="filters.endDate"
            type="date"
            color="neutral"
            variant="outline"
            size="md"
          />
        </UFormField>
        <UButton
          color="neutral"
          variant="ghost"
          size="md"
          icon="i-lucide-filter-x"
          @click="resetFilters"
        >
          清除篩選
        </UButton>
      </div>
    </UCard>

    <UCard>
      <template v-if="pageState === 'loading'">
        <div class="flex flex-col items-center justify-center py-16">
          <UIcon
            name="i-lucide-loader-2"
            class="mb-4 size-8 animate-spin text-muted motion-reduce:animate-none"
          />
          <p class="text-sm text-muted">載入中...</p>
        </div>
      </template>

      <template v-else-if="pageState === 'unauthorized'">
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-shield-off" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">權限不足</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            此頁面僅限管理員使用。若您認為這是錯誤，請聯絡系統管理員。
          </p>
          <UButton color="neutral" variant="outline" size="md" to="/">返回首頁</UButton>
        </div>
      </template>

      <template v-else-if="pageState === 'error'">
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-cloud-off" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入查詢日誌</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">連線可能暫時中斷，請檢查網路後再試。</p>
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
      </template>

      <template v-else-if="pageState === 'empty'">
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-search" class="size-8 text-default" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">沒有符合條件的查詢日誌</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            請調整篩選條件，或稍候新查詢產生後再回來檢視。
          </p>
          <UButton
            color="neutral"
            variant="outline"
            size="md"
            icon="i-lucide-filter-x"
            @click="resetFilters"
          >
            清除篩選
          </UButton>
        </div>
      </template>

      <template v-else>
        <UTable :columns="columns" :data="logs">
          <template #createdAt-cell="{ row }">
            <span class="text-sm text-muted">{{ formatDate(row.original.createdAt) }}</span>
          </template>

          <template #channel-cell="{ row }">
            <AdminQueryLogsQueryLogChannelBadge :channel="row.original.channel as 'web' | 'mcp'" />
          </template>

          <template #status-cell="{ row }">
            <AdminQueryLogsQueryLogStatusBadge :status="row.original.status" />
          </template>

          <template #queryRedactedText-cell="{ row }">
            <span
              class="max-w-md truncate text-sm text-default"
              :title="row.original.queryRedactedText"
            >
              {{ row.original.queryRedactedText || '—' }}
            </span>
          </template>

          <template #redactionApplied-cell="{ row }">
            <UBadge
              :color="row.original.redactionApplied ? 'warning' : 'neutral'"
              variant="subtle"
              size="sm"
            >
              {{ row.original.redactionApplied ? '已遮罩' : '未遮罩' }}
            </UBadge>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex justify-end">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-eye"
                :to="`/admin/query-logs/${row.original.id}`"
                :aria-label="`檢視日誌 ${row.original.id}`"
              >
                詳情
              </UButton>
            </div>
          </template>
        </UTable>
      </template>
    </UCard>
  </div>
</template>
