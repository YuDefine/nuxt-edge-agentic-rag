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

  useSeoMeta({ title: '上傳文件' })

  const router = useRouter()
  const route = useRoute()

  const rawDocumentId = route.query.documentId
  const targetDocumentId =
    typeof rawDocumentId === 'string' && rawDocumentId.trim() !== '' ? rawDocumentId : null

  // `immediate` / `watch: false` skips the network call when no documentId
  // query param was supplied, while keeping a consistent `{ data, status }`
  // shape so downstream computeds don't have to branch.
  const {
    data: targetDocumentData,
    status: targetStatus,
    error: targetError,
    refresh: refreshTarget,
  } = await useFetch<{
    data: DocumentWithAllVersions
  }>(() => `/api/admin/documents/${targetDocumentId}`, {
    key: `admin-documents-upload-target-${targetDocumentId ?? 'none'}`,
    immediate: targetDocumentId !== null,
    watch: false,
  })

  const isLockedLoading = computed(
    () => targetDocumentId !== null && targetStatus.value === 'pending',
  )

  // Without this branch a failed lookup fell through to the「找不到指定文件」
  // card, so a transient network error was indistinguishable from a deleted
  // document — and the only offered action was to go back to the list.
  //
  // 404 / 403 stay on that card: it already says「已被刪除，或您無權存取」,
  // which is the accurate reading, and offering a retry button there would
  // just invert the same confusion.
  const targetErrorStatus = computed(() => targetError.value?.statusCode ?? null)

  const targetLoadFailed = computed(
    () =>
      targetDocumentId !== null &&
      targetStatus.value === 'error' &&
      targetErrorStatus.value !== 404 &&
      targetErrorStatus.value !== 403,
  )

  // Status code only. `err.message` on a transport failure is an untranslated
  // browser string ("Failed to fetch"), and this page's copy is 繁中 — the
  // localized sentence below already says what happened, so the raw string
  // would add noise in another language rather than information.
  const targetErrorDetail = computed(() =>
    targetErrorStatus.value ? `HTTP ${targetErrorStatus.value}` : null,
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

    <UCard v-else-if="targetLoadFailed">
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <UIcon name="i-lucide-wifi-off" class="mb-4 size-8 text-error" aria-hidden="true" />
        <h2 class="mb-2 text-lg font-semibold text-default">載入文件資訊失敗</h2>
        <p class="mb-6 max-w-sm text-sm text-muted">
          無法讀取此文件的資訊{{ targetErrorDetail ? `（${targetErrorDetail}）` : '' }}，
          可能是暫時性的連線問題。重試仍失敗時請回到列表重新選擇。
        </p>
        <div class="flex gap-3">
          <UButton color="primary" icon="i-lucide-refresh-cw" @click="refreshTarget()"
            >重試</UButton
          >
          <UButton color="neutral" variant="outline" to="/admin/documents">返回列表</UButton>
        </div>
      </div>
    </UCard>

    <UCard v-else-if="targetDocumentId && !lockedDocument">
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <UIcon name="i-lucide-file-x" class="mb-4 size-8 text-error" aria-hidden="true" />
        <h2 class="mb-2 text-lg font-semibold text-default">找不到指定文件</h2>
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
