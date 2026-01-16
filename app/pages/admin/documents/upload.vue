<script setup lang="ts">
  /**
   * Admin document upload page - requires admin role.
   * Server truth: POST /api/uploads/presign, POST /api/documents/sync require admin session
   */
  definePageMeta({
    middleware: ['admin'],
  })

  const router = useRouter()

  function handleComplete(result: { documentId: string; versionId: string }) {
    router.push('/admin/documents')
  }

  function handleCancel() {
    router.push('/admin/documents')
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
        to="/admin/documents"
      >
        返回列表
      </UButton>
    </div>

    <div>
      <h1 class="text-xl font-semibold text-default">上傳文件</h1>
      <p class="mt-1 text-sm text-muted">上傳新文件至知識庫，完成後可發布至問答系統。</p>
    </div>

    <UCard>
      <DocumentsUploadWizard @complete="handleComplete" @cancel="handleCancel" />
    </UCard>
  </div>
</template>
