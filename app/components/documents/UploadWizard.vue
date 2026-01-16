<script setup lang="ts">
  import { assertNever } from '~/utils/assert-never'

  type WizardStep = 'select' | 'presign' | 'upload' | 'finalize' | 'sync' | 'publish' | 'complete'
  type StepStatus = 'pending' | 'active' | 'completed' | 'error'

  interface StepConfig {
    key: WizardStep
    label: string
    description: string
  }

  const steps: StepConfig[] = [
    { key: 'select', label: '選擇檔案', description: '選擇要上傳的文件' },
    { key: 'presign', label: '準備上傳', description: '取得上傳授權' },
    { key: 'upload', label: '上傳檔案', description: '上傳至儲存空間' },
    { key: 'finalize', label: '確認上傳', description: '驗證檔案完整性' },
    { key: 'sync', label: '同步處理', description: '處理文件內容' },
    { key: 'publish', label: '發布文件', description: '發布至知識庫' },
  ]

  const emit = defineEmits<{
    complete: [result: { documentId: string; versionId: string }]
    cancel: []
  }>()

  const currentStep = ref<WizardStep>('select')
  const errorMessage = ref<string | null>(null)
  const isProcessing = ref(false)

  const selectedFile = ref<File | null>(null)
  const fileChecksum = ref<string>('')
  const fileInputRef = ref<HTMLInputElement | null>(null)

  function triggerFileSelect() {
    fileInputRef.value?.click()
  }

  const presignResult = ref<{
    objectKey: string
    uploadId: string
    uploadUrl: string
  } | null>(null)

  const syncResult = ref<{
    documentId: string
    versionId: string
  } | null>(null)

  const documentMeta = ref({
    title: '',
    slug: '',
    categorySlug: '',
    accessLevel: 'internal' as 'internal' | 'restricted',
  })

  function getStepStatus(step: WizardStep): StepStatus {
    const stepIndex = steps.findIndex((s) => s.key === step)
    const currentIndex = steps.findIndex((s) => s.key === currentStep.value)

    if (step === currentStep.value) {
      return errorMessage.value ? 'error' : 'active'
    }
    if (stepIndex < currentIndex) {
      return 'completed'
    }
    return 'pending'
  }

  function getStepIcon(status: StepStatus): string {
    switch (status) {
      case 'completed':
        return 'i-lucide-check'
      case 'error':
        return 'i-lucide-x'
      case 'active':
        return 'i-lucide-loader-2'
      case 'pending':
        return 'i-lucide-circle'
      default:
        return assertNever(status, 'getStepIcon')
    }
  }

  async function calculateChecksum(file: File): Promise<string> {
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  const ALLOWED_EXTENSIONS = ['.txt', '.md', '.pdf']
  const ALLOWED_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'application/pdf'])
  const MAX_FILE_SIZE_MB = 10
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

  const validationError = ref<string | null>(null)

  function validateFile(file: File): { valid: boolean; error?: string } {
    const extension = file.name.toLowerCase().match(/\.[^/.]+$/)?.[0] ?? ''
    const mimeType = file.type || 'application/octet-stream'

    if (!ALLOWED_EXTENSIONS.includes(extension) && !ALLOWED_MIME_TYPES.has(mimeType)) {
      return {
        valid: false,
        error: `不支援的檔案格式。支援格式：${ALLOWED_EXTENSIONS.join(', ')}`,
      }
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `檔案大小超過限制（最大 ${MAX_FILE_SIZE_MB} MB）`,
      }
    }

    if (file.size === 0) {
      return {
        valid: false,
        error: '檔案是空的，請選擇有效的檔案',
      }
    }

    return { valid: true }
  }

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return

    const file = files[0]
    if (!file) return

    validationError.value = null
    const validation = validateFile(file)

    if (!validation.valid) {
      validationError.value = validation.error ?? '檔案驗證失敗'
      selectedFile.value = null
      return
    }

    selectedFile.value = file
    documentMeta.value.title = file.name.replace(/\.[^/.]+$/, '')
    documentMeta.value.slug = file.name
      .replace(/\.[^/.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  async function startUpload() {
    if (!selectedFile.value) return

    errorMessage.value = null
    isProcessing.value = true

    try {
      currentStep.value = 'presign'
      fileChecksum.value = await calculateChecksum(selectedFile.value)

      const presignResponse = await $fetch('/api/uploads/presign', {
        method: 'POST',
        body: {
          checksumSha256: fileChecksum.value,
          filename: selectedFile.value.name,
          mimeType: selectedFile.value.type || 'application/octet-stream',
          size: selectedFile.value.size,
        },
      })

      presignResult.value = presignResponse as {
        objectKey: string
        uploadId: string
        uploadUrl: string
      }

      currentStep.value = 'upload'
      await fetch(presignResult.value.uploadUrl, {
        method: 'PUT',
        body: selectedFile.value,
        headers: {
          'Content-Type': selectedFile.value.type || 'application/octet-stream',
        },
      })

      currentStep.value = 'finalize'
      await $fetch('/api/uploads/finalize', {
        method: 'POST',
        body: {
          checksumSha256: fileChecksum.value,
          mimeType: selectedFile.value.type || 'application/octet-stream',
          objectKey: presignResult.value.objectKey,
          size: selectedFile.value.size,
          uploadId: presignResult.value.uploadId,
        },
      })

      currentStep.value = 'sync'
      const syncResponse = await $fetch('/api/documents/sync', {
        method: 'POST',
        body: {
          accessLevel: documentMeta.value.accessLevel,
          categorySlug: documentMeta.value.categorySlug,
          checksumSha256: fileChecksum.value,
          mimeType: selectedFile.value.type || 'application/octet-stream',
          objectKey: presignResult.value.objectKey,
          size: selectedFile.value.size,
          slug: documentMeta.value.slug,
          title: documentMeta.value.title,
          uploadId: presignResult.value.uploadId,
        },
      })

      const syncData = syncResponse as {
        data: { document: { id: string }; version: { id: string } }
      }
      syncResult.value = {
        documentId: syncData.data.document.id,
        versionId: syncData.data.version.id,
      }

      currentStep.value = 'publish'
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '上傳過程發生錯誤'
    } finally {
      isProcessing.value = false
    }
  }

  async function publishDocument() {
    if (!syncResult.value) return

    errorMessage.value = null
    isProcessing.value = true

    try {
      await $fetch(
        `/api/documents/${syncResult.value.documentId}/versions/${syncResult.value.versionId}/publish`,
        {
          method: 'POST',
        }
      )

      currentStep.value = 'complete'
      emit('complete', syncResult.value)
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '發布失敗'
    } finally {
      isProcessing.value = false
    }
  }

  function reset() {
    currentStep.value = 'select'
    errorMessage.value = null
    selectedFile.value = null
    fileChecksum.value = ''
    presignResult.value = null
    syncResult.value = null
    documentMeta.value = {
      title: '',
      slug: '',
      categorySlug: '',
      accessLevel: 'internal',
    }
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex gap-2 overflow-x-auto pb-2">
      <div
        v-for="step in steps"
        :key="step.key"
        class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2"
        :class="{
          'border-primary bg-primary-50 dark:bg-primary-950': getStepStatus(step.key) === 'active',
          'border-success bg-success-50 dark:bg-success-950':
            getStepStatus(step.key) === 'completed',
          'border-error bg-error-50 dark:bg-error-950': getStepStatus(step.key) === 'error',
          'border-neutral-200 dark:border-neutral-800': getStepStatus(step.key) === 'pending',
        }"
      >
        <UIcon
          :name="getStepIcon(getStepStatus(step.key))"
          class="size-4 shrink-0"
          :class="{
            'animate-spin': getStepStatus(step.key) === 'active' && isProcessing,
          }"
        />
        <span class="truncate text-sm font-medium">{{ step.label }}</span>
      </div>
    </div>

    <UAlert v-if="errorMessage" color="error" variant="subtle" :title="errorMessage" />
    <UAlert v-if="validationError" color="warning" variant="subtle" :title="validationError" />

    <div v-if="currentStep === 'select'" class="flex flex-col gap-4">
      <div
        class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 p-8 dark:border-neutral-700"
      >
        <UIcon name="i-lucide-upload-cloud" class="mb-4 size-12 text-muted" />
        <p class="mb-2 text-sm text-default">拖放檔案至此，或點擊選擇</p>
        <p class="mb-4 text-xs text-muted">支援 .txt, .md, .pdf 格式，最大 10 MB</p>
        <input
          ref="fileInputRef"
          type="file"
          accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
          class="hidden"
          @change="(e) => handleFileSelect((e.target as HTMLInputElement).files)"
        />
        <UButton color="primary" variant="outline" size="sm" @click="triggerFileSelect">
          選擇檔案
        </UButton>
      </div>

      <div v-if="selectedFile" class="rounded-lg border p-4">
        <div class="mb-4 flex items-start gap-3">
          <UIcon name="i-lucide-file-text" class="mt-0.5 size-5 text-muted" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-default">{{ selectedFile.name }}</p>
            <p class="text-sm text-muted">{{ (selectedFile.size / 1024).toFixed(1) }} KB</p>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="文件標題">
            <UInput v-model="documentMeta.title" placeholder="輸入文件標題" />
          </UFormField>
          <UFormField label="文件代碼">
            <UInput v-model="documentMeta.slug" placeholder="document-slug" />
          </UFormField>
          <UFormField label="分類">
            <UInput v-model="documentMeta.categorySlug" placeholder="general" />
          </UFormField>
          <UFormField label="存取等級">
            <USelect
              v-model="documentMeta.accessLevel"
              :items="[
                { value: 'internal', label: '內部' },
                { value: 'restricted', label: '受限' },
              ]"
            />
          </UFormField>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="emit('cancel')">取消</UButton>
        <UButton
          color="primary"
          :disabled="!selectedFile || !documentMeta.title || !documentMeta.slug"
          @click="startUpload"
        >
          開始上傳
        </UButton>
      </div>
    </div>

    <div
      v-else-if="currentStep === 'publish'"
      class="flex flex-col items-center justify-center py-8 text-center"
    >
      <div class="mb-4 rounded-full bg-success-100 p-4 dark:bg-success-900">
        <UIcon name="i-lucide-check-circle" class="size-8 text-success" />
      </div>
      <h3 class="mb-2 text-lg font-medium text-default">文件已準備就緒</h3>
      <p class="mb-6 max-w-sm text-sm text-muted">
        文件已成功處理並編入索引。點擊下方按鈕發布至知識庫。
      </p>
      <div class="flex gap-2">
        <UButton color="neutral" variant="outline" @click="emit('cancel')">稍後發布</UButton>
        <UButton color="primary" :loading="isProcessing" @click="publishDocument">
          立即發布
        </UButton>
      </div>
    </div>

    <div
      v-else-if="currentStep === 'complete'"
      class="flex flex-col items-center justify-center py-8 text-center"
    >
      <div class="mb-4 rounded-full bg-success-100 p-4 dark:bg-success-900">
        <UIcon name="i-lucide-party-popper" class="size-8 text-success" />
      </div>
      <h3 class="mb-2 text-lg font-medium text-default">發布成功</h3>
      <p class="mb-6 max-w-sm text-sm text-muted">文件已成功發布至知識庫，使用者現在可以查詢。</p>
      <div class="flex gap-2">
        <UButton color="neutral" variant="outline" @click="reset">上傳更多</UButton>
        <UButton color="primary" @click="emit('cancel')">返回列表</UButton>
      </div>
    </div>

    <div v-else class="flex flex-col items-center justify-center py-12 text-center">
      <UIcon name="i-lucide-loader-2" class="mb-4 size-8 animate-spin text-primary" />
      <p class="text-sm text-muted">{{ steps.find((s) => s.key === currentStep)?.description }}</p>
    </div>
  </div>
</template>
