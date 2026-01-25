<script setup lang="ts">
  /**
   * Modal for displaying citation replay content.
   * Fetches cited chunk from /api/citations/:citationId
   */
  interface Props {
    citationId: string | null
    open: boolean
  }

  interface CitationData {
    chunkText: string
    citationId: string
    citationLocator: string
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
          <div
            v-if="parseLocator(citationData.citationLocator).title"
            class="flex items-center gap-2 rounded-lg bg-muted p-3"
          >
            <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
            <div class="flex-1">
              <p class="text-sm font-medium text-default">
                {{ parseLocator(citationData.citationLocator).title }}
              </p>
              <p v-if="parseLocator(citationData.citationLocator).page" class="text-xs text-muted">
                頁面 {{ parseLocator(citationData.citationLocator).page }}
              </p>
            </div>
          </div>

          <!-- Chunk text -->
          <div class="rounded-lg border border-default bg-elevated p-4">
            <p class="text-sm leading-relaxed whitespace-pre-wrap text-default">
              {{ citationData.chunkText }}
            </p>
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
