<script setup lang="ts">
  import type { DocumentWithCurrentVersion } from '~~/shared/types/knowledge'

  /**
   * Admin documents list page - requires admin role.
   * Server truth: GET /api/admin/documents requires admin session (requireRuntimeAdminSession)
   */
  definePageMeta({
    middleware: ['admin'],
  })

  const router = useRouter()

  const { data, status, error, refresh } = await useFetch<{ data: DocumentWithCurrentVersion[] }>(
    '/api/admin/documents'
  )

  const documents = computed(() => data.value?.data ?? [])
  const isLoading = computed(() => status.value === 'pending')
  const hasError = computed(() => status.value === 'error')
  const isEmpty = computed(
    () => !isLoading.value && !hasError.value && documents.value.length === 0
  )

  function handleUpload() {
    router.push('/admin/documents/upload')
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-default">文件管理</h1>
        <p class="mt-1 text-sm text-muted">管理知識庫文件，包含上傳、同步與發布。</p>
      </div>
      <UButton
        color="neutral"
        variant="solid"
        size="md"
        icon="i-lucide-upload"
        @click="handleUpload"
      >
        上傳文件
      </UButton>
    </div>

    <!-- Content -->
    <UCard>
      <!-- Loading state -->
      <template v-if="isLoading">
        <div class="flex flex-col items-center justify-center py-16">
          <UIcon name="i-lucide-loader-2" class="mb-4 size-8 animate-spin text-muted" />
          <p class="text-sm text-muted">載入中...</p>
        </div>
      </template>

      <!-- Error state -->
      <template v-else-if="hasError">
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-cloud-off" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入文件列表</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">連線可能暫時中斷，請檢查網路後再試。</p>
          <UButton
            color="neutral"
            variant="outline"
            size="md"
            icon="i-lucide-refresh-cw"
            @click="refresh()"
          >
            重新載入
          </UButton>
        </div>
      </template>

      <!-- Empty state -->
      <template v-else-if="isEmpty">
        <DocumentsDocumentListEmpty show-upload-action @upload="handleUpload" />
      </template>

      <!-- Data table -->
      <template v-else>
        <DocumentsDocumentListTable
          :documents="documents"
          :loading="isLoading"
          @action-complete="refresh()"
        />
      </template>
    </UCard>
  </div>
</template>
