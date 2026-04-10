<script setup lang="ts">
  import type { DocumentWithAllVersions } from '~~/server/utils/document-list-store'

  /**
   * Admin document upload page - requires admin role.
   * Server truth: POST /api/uploads/presign, POST /api/documents/sync require admin session
   *
   * When invoked with `?documentId=<id>`, the wizard enters「新版上傳」模式：
   * slug 鎖定為既有文件的 slug，確保 server 端 findDocumentBySlug 命中既有文件而非建立新檔。
   */
  definePageMeta({
    middleware: ['admin'],
  })

  const router = useRouter()
  const route = useRoute()

  const rawDocumentId = route.query.documentId
  const targetDocumentId =
    typeof rawDocumentId === 'string' && rawDocumentId.trim() !== '' ? rawDocumentId : null

  // `immediate` / `watch: false` skips the network call when no documentId
  // query param was supplied, while keeping a consistent `{ data, status }`
  // shape so downstream computeds don't have to branch.
  const { data: targetDocumentData, status: targetStatus } = await useFetch<{
    data: DocumentWithAllVersions
  }>(() => `/api/admin/documents/${targetDocumentId}`, {
    immediate: targetDocumentId !== null,
    watch: false,
  })

  const isLockedLoading = computed(
    () => targetDocumentId !== null && targetStatus.value === 'pending',
  )

  const lockedDocument = computed(() => {
    if (!targetDocumentId) return null
    const doc = targetDocumentData.value?.data
    if (!doc) return null
    return {
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      categorySlug: doc.categorySlug,
      accessLevel: doc.accessLevel,
    }
  })

  function handleComplete(_result: { documentId: string; versionId: string }) {
    router.push('/admin/documents')
  }

  function handleCancel() {
    if (targetDocumentId) {
      router.push(`/admin/documents/${targetDocumentId}`)
    } else {
      router.push('/admin/documents')
    }
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center gap-4">
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        :to="targetDocumentId ? `/admin/documents/${targetDocumentId}` : '/admin/documents'"
      >
        返回{{ targetDocumentId ? '文件' : '列表' }}
      </UButton>
    </div>

    <div>
      <h1 class="text-xl font-semibold text-default">
        {{ lockedDocument ? `上傳新版：${lockedDocument.title}` : '上傳文件' }}
      </h1>
      <p class="mt-1 text-sm text-muted">
        {{
          lockedDocument
            ? `新版本將綁定至既有文件代碼「${lockedDocument.slug}」，無法變更。`
            : '上傳新文件至知識庫，完成後可發布至問答系統。'
        }}
      </p>
    </div>

    <UCard v-if="isLockedLoading">
      <div class="flex flex-col items-center justify-center py-12">
        <UIcon
          name="i-lucide-loader-2"
          class="mb-4 size-8 animate-spin text-muted motion-reduce:animate-none"
        />
        <p class="text-sm text-muted">載入文件資訊…</p>
      </div>
    </UCard>

    <UCard v-else-if="targetDocumentId && !lockedDocument">
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <UIcon name="i-lucide-file-x" class="mb-4 size-8 text-error" aria-hidden="true" />
        <h3 class="mb-2 text-lg font-semibold text-default">找不到指定文件</h3>
        <p class="mb-6 max-w-sm text-sm text-muted">
          此文件可能已被刪除，或您無權存取。請回到列表重新選擇。
        </p>
        <UButton color="neutral" variant="outline" to="/admin/documents">返回列表</UButton>
      </div>
    </UCard>

    <UCard v-else>
      <DocumentsUploadWizard
        :locked-document="lockedDocument"
        @complete="handleComplete"
        @cancel="handleCancel"
      />
    </UCard>
  </div>
</template>
