<script setup lang="ts">
  /**
   * Citation card shown below an assistant message. Provides two entry points to
   * the cited chunk: the "展開" icon expands the preview inline (no modal),
   * while clicking the card body opens the Citation Replay Modal.
   */
  interface Props {
    citationId: string
    index: number
    isHovered: boolean
  }

  interface CitationSummary {
    chunkText: string
    documentTitle: string
    isCurrentVersion: boolean
    versionNumber: number
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    openModal: [citationId: string]
    hover: [citationId: string | null]
  }>()

  const isExpanded = ref(false)
  const summary = ref<CitationSummary | null>(null)
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  async function ensureSummary() {
    if (summary.value || isLoading.value) return
    isLoading.value = true
    loadError.value = null
    try {
      const response = await $fetch<{ data: CitationSummary }>(`/api/citations/${props.citationId}`)
      summary.value = response.data
    } catch (error) {
      loadError.value =
        error && typeof error === 'object' && 'statusCode' in error
          ? (error as { statusCode?: number }).statusCode === 404
            ? '此引用已過期或不存在'
            : '無法載入引用內容'
          : '無法載入引用內容'
    } finally {
      isLoading.value = false
    }
  }

  async function toggleExpand(event: Event) {
    event.stopPropagation()
    if (!isExpanded.value) await ensureSummary()
    isExpanded.value = !isExpanded.value
  }

  function handleCardClick() {
    emit('openModal', props.citationId)
  }

  function handleMouseEnter() {
    emit('hover', props.citationId)
    void ensureSummary()
  }

  function handleMouseLeave() {
    emit('hover', null)
  }
</script>

<template>
  <div
    class="rounded-lg border transition-all"
    :class="
      isHovered
        ? 'border-primary bg-accented ring-2 ring-primary/20'
        : 'border-default bg-elevated hover:border-primary/40'
    "
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <button
      type="button"
      class="flex w-full items-start gap-3 p-3 text-left"
      @click="handleCardClick"
    >
      <div
        class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-inverted"
      >
        {{ index + 1 }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="mb-1 flex items-center gap-2">
          <p class="truncate text-sm font-medium text-default">
            {{ summary?.documentTitle ?? '引用來源' }}
          </p>
          <UBadge
            v-if="summary"
            :color="summary.isCurrentVersion ? 'success' : 'warning'"
            variant="subtle"
            size="xs"
            :icon="summary.isCurrentVersion ? 'i-lucide-badge-check' : 'i-lucide-history'"
          >
            {{ summary.isCurrentVersion ? `v${summary.versionNumber}（最新）` : '已非最新版' }}
          </UBadge>
        </div>
        <p v-if="isLoading && !summary" class="text-xs text-muted">載入引用資訊中…</p>
        <p v-else-if="loadError" class="text-xs text-error">{{ loadError }}</p>
        <p v-else-if="summary && !isExpanded" class="line-clamp-2 text-xs text-muted">
          {{ summary.chunkText }}
        </p>
        <p
          v-else-if="summary && isExpanded"
          class="text-xs leading-relaxed whitespace-pre-wrap text-default"
        >
          {{ summary.chunkText }}
        </p>
      </div>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        :icon="isExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :aria-label="isExpanded ? '收合引用' : '展開引用'"
        @click="toggleExpand"
      />
    </button>
  </div>
</template>
