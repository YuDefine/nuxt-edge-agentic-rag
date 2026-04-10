<script setup lang="ts">
  /**
   * observability-and-debug §2.4 — internal debug detail for a single
   * query_log. Route is independent from `/admin/query-logs/[id]` (admin-ui
   * Phase 3) so the two surfaces can evolve separately.
   *
   * Server truth: GET /api/admin/debug/query-logs/[id] is gated by
   * `requireInternalDebugAccess` (admin + prod flag).
   */

  import type { DecisionPath, RefusalReason } from '~~/shared/types/observability'
  import { formatNullableNumber } from '~/utils/debug-labels'

  definePageMeta({
    middleware: ['admin'],
  })

  interface DebugQueryLogDetail {
    id: string
    channel: string
    status: string
    environment: string
    queryRedactedText: string
    riskFlags: string[]
    allowedAccessLevels: string[]
    redactionApplied: boolean
    configSnapshotVersion: string
    citationsJson: string
    createdAt: string
    firstTokenLatencyMs: number | null
    completionLatencyMs: number | null
    retrievalScore: number | null
    judgeScore: number | null
    decisionPath: DecisionPath | null
    refusalReason: RefusalReason | null
  }

  const route = useRoute()
  const logId = computed(() => String(route.params.id ?? ''))

  const { data, status, error, refresh } = await useFetch<{ data: DebugQueryLogDetail }>(
    () => `/api/admin/debug/query-logs/${logId.value}`,
    {
      key: `debug-query-log-${logId.value}`,
    },
  )

  const detail = computed(() => data.value?.data ?? null)
  const isLoading = computed(() => status.value === 'pending')

  type UiPageState = 'loading' | 'unauthorized' | 'not-found' | 'error' | 'ready'

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
      if (errorStatusCode.value === 404) {
        return 'not-found'
      }
      return 'error'
    }
    if (!detail.value) return 'not-found'
    return 'ready'
  })

  const firstTokenText = computed(() =>
    formatNullableNumber(detail.value?.firstTokenLatencyMs ?? null, ' ms'),
  )
  const completionText = computed(() =>
    formatNullableNumber(detail.value?.completionLatencyMs ?? null, ' ms'),
  )
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-default">Debug · Query Log 詳情</h1>
        <p class="mt-1 text-sm text-muted">內部觀測面板，僅 Admin 可見。</p>
      </div>
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

    <!-- Loading -->
    <template v-if="pageState === 'loading'">
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

    <!-- Unauthorized (403 / 401 from requireInternalDebugAccess) -->
    <template v-else-if="pageState === 'unauthorized'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <UIcon name="i-lucide-shield-off" class="mb-4 size-10 text-warning" aria-hidden="true" />
          <h3 class="mb-2 text-lg font-semibold text-default">無權限存取</h3>
          <p class="max-w-md text-sm text-muted">
            內部 Debug 介面受 Admin 權限與 production 的
            <code class="rounded bg-muted px-1">NUXT_DEBUG_SURFACE_ENABLED</code>
            旗標雙重控制。請確認帳號角色與環境設定後再試。
          </p>
        </div>
      </UCard>
    </template>

    <!-- Not found -->
    <template v-else-if="pageState === 'not-found'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <UIcon name="i-lucide-search-x" class="mb-4 size-10 text-muted" />
          <h3 class="mb-2 text-lg font-semibold text-default">找不到此 Query Log</h3>
          <p class="text-sm text-muted">
            ID <code>{{ logId }}</code> 不存在或已被清除。
          </p>
        </div>
      </UCard>
    </template>

    <!-- Generic error -->
    <template v-else-if="pageState === 'error'">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <UIcon name="i-lucide-cloud-off" class="mb-4 size-10 text-error" aria-hidden="true" />
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入 Debug 資料</h3>
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
    <template v-else-if="detail">
      <!-- Top-line facts -->
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center gap-3">
            <h3 class="text-base font-semibold text-default">決策與延遲</h3>
            <DebugDecisionPathBadge :value="detail.decisionPath" />
            <UBadge color="neutral" variant="outline" size="sm">{{ detail.channel }}</UBadge>
            <UBadge color="neutral" variant="outline" size="sm">{{ detail.environment }}</UBadge>
          </div>
        </template>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-muted uppercase">首 token 延遲</span>
            <span
              class="text-lg font-semibold"
              :class="detail.firstTokenLatencyMs === null ? 'text-muted' : 'text-default'"
            >
              {{ firstTokenText }}
            </span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-muted uppercase">完成延遲</span>
            <span
              class="text-lg font-semibold"
              :class="detail.completionLatencyMs === null ? 'text-muted' : 'text-default'"
            >
              {{ completionText }}
            </span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-muted uppercase">狀態</span>
            <UBadge color="neutral" variant="subtle" size="sm" class="self-start">
              {{ detail.status }}
            </UBadge>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-muted uppercase">建立時間</span>
            <span class="text-sm text-default">{{ detail.createdAt }}</span>
          </div>
        </div>
      </UCard>

      <!-- Scores + refusal -->
      <DebugScorePanel
        :retrieval-score="detail.retrievalScore"
        :judge-score="detail.judgeScore"
        :refusal-reason="detail.refusalReason"
      />

      <!-- Redacted query text -->
      <UCard>
        <template #header>
          <h3 class="text-base font-semibold text-default">原始查詢（已消毒）</h3>
        </template>
        <pre class="rounded bg-muted p-4 text-sm break-words whitespace-pre-wrap text-default">{{
          detail.queryRedactedText
        }}</pre>
        <p
          v-if="detail.redactionApplied"
          class="mt-2 text-xs text-warning-700 dark:text-warning-200"
        >
          此查詢已套用 redaction 規則，原始文本不會出現在此介面。
        </p>
      </UCard>

      <!-- Evidence panel -->
      <DebugEvidencePanel
        :citations-json="detail.citationsJson"
        :config-snapshot-version="detail.configSnapshotVersion"
        :allowed-access-levels="detail.allowedAccessLevels"
        :risk-flags="detail.riskFlags"
      />
    </template>
  </div>
</template>
