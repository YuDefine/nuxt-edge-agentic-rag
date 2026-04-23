<script setup lang="ts">
  import { formatDateTime } from '~/utils/format-datetime'
  import { getUiPageState } from '~~/shared/utils/ui-state'

  /**
   * Admin Query Log detail page.
   *
   * Server truth: GET /api/admin/query-logs/[id] — returns redaction-safe
   * fields only. The server deliberately omits any raw / un-redacted text,
   * token_hash, and decision_path (observability change will add the latter
   * separately). This UI mirrors that contract.
   */
  definePageMeta({
    middleware: ['admin'],
  })

  interface QueryLogDetail {
    allowedAccessLevels: string[]
    channel: string
    configSnapshotVersion: string
    createdAt: string
    environment: string
    id: string
    queryRedactedText: string
    redactionApplied: boolean
    riskFlags: string[]
    status: 'accepted' | 'blocked' | 'limited' | 'rejected'
  }

  interface DetailResponse {
    data: QueryLogDetail
  }

  const route = useRoute()
  const id = computed(() => String(route.params.id ?? ''))

  const { data, state, asyncStatus, error, refetch } = useQuery({
    key: () => ['admin', 'query-logs', id.value],
    query: () => $fetch<DetailResponse>(`/api/admin/query-logs/${id.value}`),
  })

  const fetchStatus = computed(() => {
    const s = asyncStatus.value
    if (s === 'loading') return 'pending'
    if (state.value.status === 'error') return 'error'
    return 'success'
  })

  const detail = computed<QueryLogDetail | null>(() => data.value?.data ?? null)

  const pageState = computed(() =>
    getUiPageState({
      error: (error.value as { statusCode?: number } | null) ?? null,
      itemCount: detail.value ? 1 : 0,
      status: fetchStatus.value,
    }),
  )

  const formatDate = formatDateTime
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          to="/admin/query-logs"
        >
          返回列表
        </UButton>
        <h1 class="mt-2 text-2xl font-bold text-default">查詢日誌詳情</h1>
        <p class="mt-1 text-sm text-muted">ID: {{ id }}</p>
      </div>
    </div>

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
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入日誌詳情</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">資料可能不存在或連線中斷，請稍後再試。</p>
          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="outline"
              size="md"
              icon="i-lucide-refresh-cw"
              @click="refetch()"
            >
              重新載入
            </UButton>
            <UButton color="neutral" variant="ghost" size="md" to="/admin/query-logs">
              返回列表
            </UButton>
          </div>
        </div>
      </template>

      <template v-else-if="pageState === 'empty' || !detail">
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-file-question" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">找不到日誌</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">該 ID 對應的日誌可能已被清理或不存在。</p>
          <UButton color="neutral" variant="outline" size="md" to="/admin/query-logs">
            返回列表
          </UButton>
        </div>
      </template>

      <template v-else>
        <div class="flex flex-col gap-6">
          <!-- Summary fields -->
          <dl class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="min-w-0">
              <dt class="text-xs text-muted">建立時間</dt>
              <dd class="mt-1 text-sm font-medium text-default">
                {{ formatDate(detail.createdAt) }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs text-muted">狀態</dt>
              <dd class="mt-1">
                <AdminQueryLogsQueryLogStatusBadge :status="detail.status" />
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs text-muted">來源</dt>
              <dd class="mt-1">
                <AdminQueryLogsQueryLogChannelBadge :channel="detail.channel as 'web' | 'mcp'" />
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs text-muted">環境</dt>
              <dd class="mt-1 text-sm font-medium text-default">{{ detail.environment }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs text-muted">遮罩狀態</dt>
              <dd class="mt-1">
                <UBadge
                  :color="detail.redactionApplied ? 'warning' : 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ detail.redactionApplied ? '已遮罩' : '未遮罩' }}
                </UBadge>
              </dd>
            </div>
            <div class="min-w-0 md:col-span-2">
              <dt class="text-xs text-muted">Config snapshot 版本</dt>
              <dd
                class="mt-1 rounded-md border border-default bg-muted p-3 font-mono text-xs break-all text-default"
              >
                {{ detail.configSnapshotVersion }}
              </dd>
            </div>
          </dl>

          <!-- Redacted query text -->
          <div>
            <p class="mb-2 text-xs text-muted">查詢內容（已遮罩）</p>
            <div
              class="rounded-md border border-default bg-muted p-3 text-sm break-words text-default"
            >
              {{ detail.queryRedactedText || '—' }}
            </div>
            <p class="mt-2 text-xs text-muted">
              為保護隱私，系統僅保留遮罩後文字；原始查詢內容不會儲存或顯示。
            </p>
          </div>

          <!-- Risk flags -->
          <div>
            <p class="mb-2 text-xs text-muted">Risk flags</p>
            <div v-if="detail.riskFlags.length > 0" class="flex flex-wrap gap-1">
              <UBadge
                v-for="flag in detail.riskFlags"
                :key="flag"
                color="error"
                variant="subtle"
                size="sm"
              >
                {{ flag }}
              </UBadge>
            </div>
            <p v-else class="text-sm text-muted">—</p>
          </div>

          <!-- Access levels -->
          <div>
            <p class="mb-2 text-xs text-muted">允許的存取層級</p>
            <div v-if="detail.allowedAccessLevels.length > 0" class="flex flex-wrap gap-1">
              <UBadge
                v-for="level in detail.allowedAccessLevels"
                :key="level"
                color="neutral"
                variant="soft"
                size="sm"
              >
                {{ level }}
              </UBadge>
            </div>
            <p v-else class="text-sm text-muted">—</p>
          </div>
        </div>
      </template>
    </UCard>
  </div>
</template>
