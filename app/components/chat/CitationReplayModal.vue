<script setup lang="ts">
  /**
   * Modal for displaying citation replay content.
   * Fetches cited chunk from /api/citations/:citationId
   */
  interface Props {
    citationId: string | null
    open: boolean
  }

  interface CitationAdminData {
    documentVersionId: string
    expiresAt: string
    queryLogId: string
    sourceChunkId: string
  }

  interface CitationData {
    admin?: CitationAdminData
    chunkText: string
    citationId: string
    citationLocator: string
    documentId: string
    documentTitle: string
    isCurrentVersion: boolean
    versionNumber: number
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:open': [value: boolean]
  }>()

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  })

  const citationUrl = computed(() => (props.citationId ? `/api/citations/${props.citationId}` : ''))

  const {
    data: citation,
    status,
    error,
    refresh,
  } = await useFetch<{ data: CitationData }>(citationUrl, {
    immediate: false,
    watch: false,
  })

  const isLoading = computed(() => status.value === 'pending')
  const hasError = computed(() => status.value === 'error')
  const citationData = computed(() => citation.value?.data ?? null)

  // Fetch when citationId changes and modal is open
  watch(
    () => [props.citationId, props.open],
    async ([newCitationId, newOpen]) => {
      if (newCitationId && newOpen) {
        await refresh()
      }
    },
    { immediate: true }
  )

  function getErrorMessage(): string {
    if (!error.value) return '無法載入引用內容'

    const statusCode = (error.value as { statusCode?: number }).statusCode
    if (statusCode === 404) {
      return '此引用已過期或不存在'
    }
    if (statusCode === 403) {
      return '您沒有權限查看此引用'
    }
    return '載入引用內容時發生錯誤'
  }

  function parseLocator(locator: string): { title?: string; page?: string } {
    // Expected format: "title:Document Name;page:1" or similar
    const parts = locator.split(';')
    const result: { title?: string; page?: string } = {}

    for (const part of parts) {
      const [key, value] = part.split(':')
      if (key === 'title' && value) {
        result.title = value
      } else if (key === 'page' && value) {
        result.page = value
      }
    }

    return result
  }
</script>

<template>
  <UModal v-model:open="isOpen">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-quote" class="size-5 text-primary" />
              <h3 class="text-lg font-semibold text-default">引用內容</h3>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-x"
              @click="isOpen = false"
            />
          </div>
        </template>

        <!-- Loading state -->
        <div v-if="isLoading" class="flex items-center justify-center py-8">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-primary" />
          <span class="ml-2 text-sm text-muted">載入中...</span>
        </div>

        <!-- Error state -->
        <div v-else-if="hasError" class="py-4">
          <UAlert
            color="error"
            variant="subtle"
            icon="i-lucide-alert-circle"
            :title="getErrorMessage()"
          />
        </div>

        <!-- Content -->
        <div v-else-if="citationData" class="flex flex-col gap-4">
          <!-- Source metadata -->
          <div class="flex items-center gap-2 rounded-lg bg-muted p-3">
            <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-default">
                {{ citationData.documentTitle || parseLocator(citationData.citationLocator).title }}
              </p>
              <p class="text-xs text-muted">
                <span>版本 v{{ citationData.versionNumber }}</span>
                <span
                  v-if="parseLocator(citationData.citationLocator).page"
                  class="ml-2 border-l border-default pl-2"
                >
                  頁面 {{ parseLocator(citationData.citationLocator).page }}
                </span>
              </p>
            </div>
            <UBadge
              v-if="citationData.isCurrentVersion"
              color="success"
              variant="subtle"
              size="sm"
              icon="i-lucide-badge-check"
            >
              最新版
            </UBadge>
            <UBadge v-else color="warning" variant="subtle" size="sm" icon="i-lucide-history">
              已非最新版
            </UBadge>
          </div>

          <!-- Chunk text -->
          <div class="rounded-lg border border-default bg-elevated p-4">
            <p class="text-sm leading-relaxed whitespace-pre-wrap text-default">
              {{ citationData.chunkText }}
            </p>
          </div>

          <!-- Admin-only audit fields -->
          <div
            v-if="citationData.admin"
            class="rounded-lg border border-dashed border-default bg-muted p-3"
            data-testid="citation-admin-fields"
          >
            <p class="mb-2 flex items-center gap-1 text-xs font-medium text-default">
              <UIcon name="i-lucide-shield-alert" class="size-3.5" />
              稽核資訊（僅管理員可見）
            </p>
            <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-[auto_1fr]">
              <dt class="font-medium">Query Log ID</dt>
              <dd class="font-mono break-all">{{ citationData.admin.queryLogId }}</dd>
              <dt class="font-medium">Citation ID</dt>
              <dd class="font-mono break-all">{{ citationData.citationId }}</dd>
              <dt class="font-medium">Source Chunk ID</dt>
              <dd class="font-mono break-all">{{ citationData.admin.sourceChunkId }}</dd>
              <dt class="font-medium">Expires At</dt>
              <dd class="font-mono break-all">{{ citationData.admin.expiresAt }}</dd>
            </dl>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end">
            <UButton color="neutral" variant="outline" size="sm" @click="isOpen = false">
              關閉
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
