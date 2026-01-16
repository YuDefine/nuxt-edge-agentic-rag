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
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-default">文件管理</h1>
        <p class="mt-1 text-sm text-muted">管理知識庫文件，包含上傳、同步與發布。</p>
      </div>
      <UButton
        color="primary"
        variant="solid"
        size="md"
        icon="i-lucide-upload"
        @click="handleUpload"
      >
        上傳文件
      </UButton>
    </div>

    <UCard>
      <template v-if="hasError">
        <div class="flex flex-col items-center justify-center py-12 text-center">
          <div class="mb-4 rounded-full bg-error-100 p-4 dark:bg-error-900">
            <UIcon name="i-lucide-alert-circle" class="size-8 text-error" />
          </div>
          <h3 class="mb-2 text-lg font-medium text-default">載入失敗</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            {{ error?.message || '無法載入文件列表，請稍後再試。' }}
          </p>
          <UButton color="neutral" variant="outline" size="md" @click="refresh()">
            重新載入
          </UButton>
        </div>
      </template>

      <template v-else-if="isEmpty">
        <DocumentsDocumentListEmpty show-upload-action @upload="handleUpload" />
      </template>

      <template v-else>
        <DocumentsDocumentListTable :documents="documents" :loading="isLoading" />
      </template>
    </UCard>
  </div>
</template>
