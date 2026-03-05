<script setup lang="ts">
  /**
   * observability-and-debug §2.3 — displays citation eligibility / evidence
   * summary for a query_log. Pulls citations from the detail payload's
   * `citationsJson` + `configSnapshotVersion` (which ties to the threshold
   * set that was active at the time of the query).
   */
  interface Citation {
    citationId?: string
    documentVersionId?: string
    sourceChunkId?: string
  }

  interface Props {
    citationsJson: string
    configSnapshotVersion: string
    allowedAccessLevels: string[]
    riskFlags: string[]
  }

  const props = defineProps<Props>()

  const citations = computed<Citation[]>(() => {
    try {
      const parsed = JSON.parse(props.citationsJson)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  const hasCitations = computed(() => citations.value.length > 0)
</script>

<template>
  <UCard>
    <template #header>
      <h3 class="text-base font-semibold text-default">證據摘要</h3>
    </template>

    <div class="flex flex-col gap-4">
      <!-- Config snapshot version -->
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">設定快照版本</span>
        <code class="rounded bg-muted px-2 py-1 text-sm text-default">
          {{ configSnapshotVersion }}
        </code>
      </div>

      <!-- Allowed access levels -->
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">允許存取層級</span>
        <div v-if="allowedAccessLevels.length === 0" class="text-sm text-dimmed">無資料</div>
        <div v-else class="flex flex-wrap gap-1">
          <UBadge
            v-for="level in allowedAccessLevels"
            :key="level"
            color="neutral"
            variant="outline"
            size="sm"
          >
            {{ level }}
          </UBadge>
        </div>
      </div>

      <!-- Risk flags -->
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">風險標記</span>
        <div v-if="riskFlags.length === 0" class="text-sm text-dimmed">無</div>
        <div v-else class="flex flex-wrap gap-1">
          <UBadge v-for="flag in riskFlags" :key="flag" color="warning" variant="subtle" size="sm">
            {{ flag }}
          </UBadge>
        </div>
      </div>

      <!-- Citations -->
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">引用</span>
        <div v-if="!hasCitations" class="text-sm text-dimmed">此次查詢未產生引用</div>
        <ul v-else class="flex flex-col gap-1">
          <li
            v-for="(citation, index) in citations"
            :key="citation.citationId ?? index"
            class="rounded border border-default bg-muted/50 px-3 py-2 text-sm text-default"
          >
            <span class="font-mono text-xs text-muted">#{{ index + 1 }}</span>
            <span class="ml-2">
              {{ citation.sourceChunkId ?? '—' }}
            </span>
          </li>
        </ul>
      </div>
    </div>
  </UCard>
</template>
