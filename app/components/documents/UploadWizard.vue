<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import { assertNever } from '~~/shared/utils/assert-never'

  const { $csrfFetch } = useNuxtApp()

  const UPLOAD_DRAFT_KEY = 'doc-upload-draft-v1'

  type WizardStep =
    | 'select'
    | 'presign'
    | 'upload'
    | 'finalize'
    | 'sync'
    | 'indexing_wait'
    | 'publish'
    | 'complete'
  type StepStatus = 'pending' | 'active' | 'completed' | 'error'

  const POLLING_INTERVAL_MS = 3000
  const INDEXING_TIMEOUT_MS = 5 * 60 * 1000

  const documentMetaSchema = z.object({
    title: z.string().trim().min(1, '請輸入文件標題'),
    slug: z
      .string()
      .trim()
      .min(1, '請輸入文件代碼')
      .regex(/^[a-z0-9-]+$/, '只能使用小寫英數字與連字符（-）'),
    categorySlug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]*$/, '只能使用小寫英數字與連字符（-）')
      .optional()
      .default(''),
    accessLevel: z.enum(['internal', 'restricted']),
  })

  type DocumentMeta = z.infer<typeof documentMetaSchema>

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
    { key: 'indexing_wait', label: '索引處理', description: '建立向量索引' },
    { key: 'publish', label: '發布文件', description: '發布至知識庫' },
  ]

  interface LockedDocument {
    id: string
    slug: string
    title: string
    categorySlug: string
    accessLevel: 'internal' | 'restricted'
  }

  const props = defineProps<{
    lockedDocument?: LockedDocument | null
  }>()

  const isLocked = computed(() => Boolean(props.lockedDocument))

  const emit = defineEmits<{
    complete: [result: { documentId: string; versionId: string }]
    cancel: []
  }>()

  const currentStep = ref<WizardStep>('select')
  const errorMessage = ref<string | null>(null)
  const errorStep = ref<WizardStep | null>(null)
  const isProcessing = ref(false)
  const uploadProgressPercent = ref<number | null>(null)

  const selectedFile = ref<File | null>(null)
  const fileChecksum = ref<string>('')
  const fileInputRef = ref<HTMLInputElement | null>(null)

  const STAGE_ERROR_LABEL: Record<WizardStep, string> = {
    select: '檔案驗證失敗',
    presign: '取得上傳授權失敗',
    upload: '檔案上傳失敗',
    finalize: '上傳確認失敗',
    sync: '文件同步失敗',
    indexing_wait: '索引處理失敗',
    publish: '文件發布失敗',
    complete: '流程完成後發生錯誤',
  }

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

  interface IndexingStatusSnapshot {
    indexStatus: string
    syncStatus: string
  }
  const indexingStatus = ref<IndexingStatusSnapshot | null>(null)
  const indexingError = ref<string | null>(null)
  let indexingTimeoutHandle: ReturnType<typeof setTimeout> | null = null

  const { pause: pauseIndexingPoll, resume: resumeIndexingPoll } = useIntervalFn(
    () => pollIndexStatus(),
    POLLING_INTERVAL_MS,
    { immediate: false, immediateCallback: false },
  )

  async function pollIndexStatus() {
    if (!syncResult.value) return
    try {
      const response = await $fetch<{
        data: { indexStatus: string; syncStatus: string; versionId: string }
      }>(
        `/api/documents/${syncResult.value.documentId}/versions/${syncResult.value.versionId}/index-status`,
      )
      indexingStatus.value = {
        indexStatus: response.data.indexStatus,
        syncStatus: response.data.syncStatus,
      }
      if (response.data.indexStatus === 'indexed' && response.data.syncStatus !== 'running') {
        stopIndexingPolling()
        currentStep.value = 'publish'
        return
      }
      if (response.data.indexStatus === 'failed' || response.data.syncStatus === 'failed') {
        stopIndexingPolling()
        indexingError.value = '索引處理失敗，請重新上傳或聯絡管理員'
      }
    } catch {
      // 單次 polling 失敗不中斷整體流程；timeout 會接手判定最終失敗
    }
  }

  function startIndexingPolling() {
    indexingStatus.value = null
    indexingError.value = null
    indexingTimeoutHandle = setTimeout(() => {
      stopIndexingPolling()
      indexingError.value = '索引處理超過 5 分鐘仍未完成，請聯絡管理員'
    }, INDEXING_TIMEOUT_MS)
    resumeIndexingPoll()
    void pollIndexStatus()
  }

  function stopIndexingPolling() {
    pauseIndexingPoll()
    if (indexingTimeoutHandle) {
      clearTimeout(indexingTimeoutHandle)
      indexingTimeoutHandle = null
    }
  }

  function getIndexingStatusLabel(status: IndexingStatusSnapshot | null): string {
    if (!status) return '正在啟動索引…'
    if (status.indexStatus === 'preprocessing') return '正在前處理文件內容…'
    if (status.indexStatus === 'smoke_pending') return '正在進行 smoke 驗證…'
    if (status.indexStatus === 'indexed') return '索引完成，即將進入發布階段'
    if (status.indexStatus === 'failed' || status.syncStatus === 'failed') return '索引失敗'
    return '處理中…'
  }

  function getIndexingDetailLabel(status: IndexingStatusSnapshot | null): string | null {
    if (!status) return null
    if (status.indexStatus === 'preprocessing') return '文件較長時，前處理可能需要 30 秒至數分鐘'
    if (status.indexStatus === 'smoke_pending') return '系統正以測試問答驗證向量索引品質'
    return null
  }

  onUnmounted(() => {
    stopIndexingPolling()
  })

  function createEmptyDraft(): DocumentMeta {
    return {
      title: '',
      slug: '',
      categorySlug: '',
      accessLevel: 'internal',
    }
  }

  const documentMeta = reactive<DocumentMeta>(createEmptyDraft())

  // Copy the four locked metadata fields into `documentMeta`. Used whenever
  // the wizard resets / restores state under `lockedDocument` mode so the
  // four fields stay in sync across mount, reset, and file-selection paths.
  function applyLockedMeta() {
    if (!props.lockedDocument) return
    documentMeta.title = props.lockedDocument.title
    documentMeta.slug = props.lockedDocument.slug
    documentMeta.categorySlug = props.lockedDocument.categorySlug
    documentMeta.accessLevel = props.lockedDocument.accessLevel
  }

  const draft = useLocalStorage<DocumentMeta>(UPLOAD_DRAFT_KEY, createEmptyDraft())
  const hasRestoredDraft = ref(false)

  onMounted(() => {
    // 鎖定模式：以既有文件資料預填，並忽略 localStorage 草稿
    if (props.lockedDocument) {
      applyLockedMeta()
      return
    }

    const d = draft.value
    const hasContent = Boolean(d.title || d.slug || d.categorySlug)
    if (!hasContent) return
    hasRestoredDraft.value = true
    documentMeta.title = d.title
    documentMeta.slug = d.slug
    documentMeta.categorySlug = d.categorySlug ?? ''
    documentMeta.accessLevel = d.accessLevel
  })

  // watchEffect below syncs documentMeta → draft.value, so clearing draft directly is redundant;
  // mutating documentMeta triggers the sync.
  // 鎖定模式不寫入草稿，避免污染下次「新文件上傳」。
  watchEffect(() => {
    if (isLocked.value) return
    draft.value = {
      title: documentMeta.title,
      slug: documentMeta.slug,
      categorySlug: documentMeta.categorySlug,
      accessLevel: documentMeta.accessLevel,
    }
  })

  function resetDocumentMeta() {
    Object.assign(documentMeta, createEmptyDraft())
  }

  function clearDraft() {
    hasRestoredDraft.value = false
  }

  function discardDraft() {
    resetDocumentMeta()
    clearDraft()
  }

  const slugConflict = ref(false)

  const debouncedCheckSlug = useDebounceFn(async (slug: string) => {
    try {
      const { data } = await $fetch<{ data: { available: boolean } }>(
        '/api/admin/documents/check-slug',
        { query: { slug } },
      )
      // Race protection: 只在當前輸入仍等於送出查詢的 slug 時才更新
      if (documentMeta.slug.trim() === slug) {
        slugConflict.value = !data.available
      }
    } catch {
      // 查詢失敗不阻擋使用者；server 端 unique constraint 仍會在 finalize 時擋下
      slugConflict.value = false
    }
  }, 300)

  watch(
    () => documentMeta.slug,
    (value) => {
      // 鎖定模式：slug 已綁定既有文件，不需做衝突檢查提示
      if (isLocked.value) {
        slugConflict.value = false
        return
      }
      const trimmed = value.trim()
      if (!trimmed || !/^[a-z0-9-]+$/.test(trimmed)) {
        slugConflict.value = false
        return
      }
      debouncedCheckSlug(trimmed)
    },
  )

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
        return 'i-lucide-loader'
      case 'pending':
        return 'i-lucide-circle'
      default:
        return assertNever(status, 'getStepIcon')
    }
  }

  function stepStatusLabel(status: StepStatus): string {
    switch (status) {
      case 'completed':
        return '已完成'
      case 'error':
        return '發生錯誤'
      case 'active':
        return '進行中'
      case 'pending':
        return '尚未開始'
      default:
        return assertNever(status, 'stepStatusLabel')
    }
  }

  const currentStepIndex = computed(() =>
    Math.max(
      0,
      steps.findIndex((s) => s.key === currentStep.value),
    ),
  )
  const currentStepConfig = computed(() => steps.find((s) => s.key === currentStep.value))

  async function calculateChecksum(file: File): Promise<string> {
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const bytes = new Uint8Array(hashBuffer)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  }

  const ALLOWED_EXTENSIONS = ['.txt', '.md', '.pdf']
  const ALLOWED_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'application/pdf'])
  const MAX_FILE_SIZE_MB = 10
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

  const validationError = ref<string | null>(null)
  const isDragging = ref(false)

  function handleDragOver(event: DragEvent) {
    event.preventDefault()
    isDragging.value = true
  }

  function handleDragLeave(event: DragEvent) {
    const related = event.relatedTarget
    const current = event.currentTarget
    if (related instanceof Node && current instanceof Node && current.contains(related)) {
      return
    }
    isDragging.value = false
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    isDragging.value = false
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) return
    if (files.length > 1) {
      validationError.value = '一次只能上傳一個檔案，請分次上傳'
      return
    }
    handleFileSelect(files)
  }

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
    // 鎖定模式：保留既有文件的 title / slug，不從檔名覆寫
    if (isLocked.value) return
    const baseName = file.name.replace(/\.[^/.]+$/, '')
    documentMeta.title = baseName
    documentMeta.slug = generateSlugFromName(baseName)
  }

  function generateSlugFromName(name: string): string {
    const normalized = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    if (normalized) return normalized

    return `doc-${crypto.randomUUID().slice(0, 8)}`
  }

  async function uploadWithProgress(params: {
    body: File
    contentType: string
    checksum: string
    url: string
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', params.url, true)
      xhr.setRequestHeader('Content-Type', params.contentType)
      xhr.setRequestHeader('x-amz-checksum-sha256', params.checksum)

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && e.total > 0) {
          uploadProgressPercent.value = Math.min(
            100,
            Math.max(0, Math.round((e.loaded / e.total) * 100)),
          )
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          uploadProgressPercent.value = 100
          resolve()
        } else {
          reject(new Error(`上傳失敗（HTTP ${xhr.status}）`))
        }
      })

      xhr.addEventListener('error', () => reject(new Error('上傳時網路中斷')))
      xhr.addEventListener('abort', () => reject(new Error('上傳已取消')))

      xhr.send(params.body)
    })
  }

  async function startUpload(event: FormSubmitEvent<DocumentMeta>) {
    if (!selectedFile.value) return

    // 鎖定模式：強制以既有文件的 slug / metadata 送出，防止 form state 被繞過
    const validated: DocumentMeta = props.lockedDocument
      ? {
          title: props.lockedDocument.title,
          slug: props.lockedDocument.slug,
          categorySlug: props.lockedDocument.categorySlug,
          accessLevel: props.lockedDocument.accessLevel,
        }
      : event.data

    errorMessage.value = null
    errorStep.value = null
    uploadProgressPercent.value = null
    isProcessing.value = true

    try {
      currentStep.value = 'presign'
      fileChecksum.value = await calculateChecksum(selectedFile.value)

      const presignResponse = await $csrfFetch('/api/uploads/presign', {
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
      uploadProgressPercent.value = 0
      await uploadWithProgress({
        body: selectedFile.value,
        contentType: selectedFile.value.type || 'application/octet-stream',
        checksum: fileChecksum.value,
        url: presignResult.value.uploadUrl,
      })

      currentStep.value = 'finalize'
      await $csrfFetch('/api/uploads/finalize', {
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
      const syncResponse = await $csrfFetch('/api/documents/sync', {
        method: 'POST',
        body: {
          accessLevel: validated.accessLevel,
          categorySlug: validated.categorySlug ?? '',
          checksumSha256: fileChecksum.value,
          mimeType: selectedFile.value.type || 'application/octet-stream',
          objectKey: presignResult.value.objectKey,
          size: selectedFile.value.size,
          slug: validated.slug,
          title: validated.title,
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

      currentStep.value = 'indexing_wait'
      startIndexingPolling()
    } catch (error) {
      errorStep.value = currentStep.value
      const stagePrefix = STAGE_ERROR_LABEL[currentStep.value] ?? '處理失敗'
      const detail = error instanceof Error ? error.message : '上傳過程發生錯誤'
      errorMessage.value = `${stagePrefix}：${detail}`
    } finally {
      isProcessing.value = false
    }
  }

  async function publishDocument() {
    if (!syncResult.value) return

    errorMessage.value = null
    isProcessing.value = true

    try {
      await $csrfFetch(
        `/api/documents/${syncResult.value.documentId}/versions/${syncResult.value.versionId}/publish`,
        {
          method: 'POST',
        },
      )

      currentStep.value = 'complete'
      clearDraft()
      emit('complete', syncResult.value)
    } catch (error) {
      errorStep.value = 'publish'
      const stagePrefix = STAGE_ERROR_LABEL.publish
      const detail = error instanceof Error ? error.message : '發布失敗'
      errorMessage.value = `${stagePrefix}：${detail}`
    } finally {
      isProcessing.value = false
    }
  }

  function reset() {
    stopIndexingPolling()
    currentStep.value = 'select'
    errorMessage.value = null
    selectedFile.value = null
    fileChecksum.value = ''
    presignResult.value = null
    syncResult.value = null
    indexingStatus.value = null
    indexingError.value = null
    // 鎖定模式：保留既有文件 metadata，只清檔案與流程狀態
    if (props.lockedDocument) {
      applyLockedMeta()
      return
    }
    resetDocumentMeta()
    clearDraft()
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div v-if="currentStep !== 'complete'" class="flex flex-col gap-2 pb-2">
      <ol
        class="flex items-center gap-2 overflow-x-auto"
        :aria-label="`上傳流程：共 ${steps.length} 步`"
      >
        <template v-for="(step, index) in steps" :key="step.key">
          <li
            class="flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors"
            :class="{
              'border-primary bg-primary text-inverted': getStepStatus(step.key) === 'active',
              'border-primary bg-default text-default': getStepStatus(step.key) === 'completed',
              'border-error bg-error text-inverted': getStepStatus(step.key) === 'error',
              'border-muted bg-default text-dimmed': getStepStatus(step.key) === 'pending',
            }"
            :aria-current="getStepStatus(step.key) === 'active' ? 'step' : undefined"
            :aria-label="`${step.label}：${stepStatusLabel(getStepStatus(step.key))}`"
          >
            <UIcon
              :name="getStepIcon(getStepStatus(step.key))"
              class="size-3"
              :class="{
                'animate-spin motion-reduce:animate-none':
                  getStepStatus(step.key) === 'active' && isProcessing,
              }"
              aria-hidden="true"
            />
          </li>
          <div
            v-if="index < steps.length - 1"
            class="h-px flex-1"
            :class="{
              'bg-primary': getStepStatus(step.key) === 'completed',
              'bg-muted': getStepStatus(step.key) !== 'completed',
            }"
            aria-hidden="true"
          />
        </template>
      </ol>
      <p class="text-sm text-muted">
        步驟 {{ currentStepIndex + 1 }} / {{ steps.length }}：
        <span class="font-medium text-default">{{ currentStepConfig?.label }}</span>
      </p>
    </div>

    <UAlert v-if="errorMessage" color="error" variant="subtle" :title="errorMessage" />
    <UAlert v-if="validationError" color="warning" variant="subtle" :title="validationError" />

    <div
      v-if="currentStep === 'upload' && !errorMessage && uploadProgressPercent !== null"
      class="rounded-md border border-default bg-elevated p-4"
      data-testid="upload-progress"
    >
      <div class="mb-2 flex items-center justify-between text-sm">
        <span class="flex items-center gap-2 font-medium text-default">
          <UIcon name="i-lucide-upload" class="size-4" />
          上傳中…
        </span>
        <span class="text-muted tabular-nums">{{ uploadProgressPercent }}%</span>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-muted">
        <div
          class="h-full bg-primary transition-[width] duration-150"
          :style="{ width: `${uploadProgressPercent}%` }"
        />
      </div>
    </div>

    <div v-if="currentStep === 'select'" class="flex flex-col gap-4">
      <UAlert
        v-if="isLocked && lockedDocument"
        color="neutral"
        variant="subtle"
        icon="i-lucide-lock"
        title="新版本上傳模式"
        :description="`此次上傳會成為文件「${lockedDocument.title}」的新版本，文件代碼已鎖定為「${lockedDocument.slug}」，無法變更。`"
      />
      <div
        v-if="!isLocked && hasRestoredDraft && !selectedFile"
        class="flex items-start gap-3 rounded-md border border-default bg-accented p-3"
      >
        <UIcon name="i-lucide-history" class="mt-0.5 size-4 text-default" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-default">已還原上次未完成的草稿</p>
          <p class="mt-0.5 text-xs text-muted">
            標題、文件代碼、分類與存取等級已自動恢復，請重新選擇檔案繼續上傳。
          </p>
        </div>
        <UButton color="neutral" variant="ghost" size="xs" @click="discardDraft">
          放棄草稿
        </UButton>
      </div>
      <div
        class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors"
        :class="isDragging ? 'border-default bg-accented' : 'border-muted'"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <UIcon
          :name="isDragging ? 'i-lucide-file-down' : 'i-lucide-upload-cloud'"
          class="mb-4 size-12"
          :class="isDragging ? 'text-default' : 'text-muted'"
        />
        <p class="mb-2 text-sm text-default">
          {{ isDragging ? '放開以上傳' : '拖放檔案至此，或點擊選擇' }}
        </p>
        <p class="mb-4 text-xs text-muted">支援 .txt, .md, .pdf 格式，最大 10 MB（單一檔案）</p>
        <input
          ref="fileInputRef"
          type="file"
          accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
          class="hidden"
          @change="(e) => handleFileSelect((e.target as HTMLInputElement).files)"
        />
        <UButton color="neutral" variant="outline" size="sm" @click="triggerFileSelect">
          選擇檔案
        </UButton>
      </div>

      <div v-if="!selectedFile" class="flex justify-end gap-2">
        <UButton type="button" color="neutral" variant="ghost" @click="emit('cancel')">
          取消
        </UButton>
      </div>

      <UForm
        v-else
        :schema="documentMetaSchema"
        :state="documentMeta"
        class="flex flex-col gap-4"
        @submit="startUpload"
      >
        <div class="rounded-lg border p-4">
          <div class="mb-4 flex items-start gap-3">
            <UIcon name="i-lucide-file-text" class="mt-0.5 size-5 text-muted" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium text-default">{{ selectedFile.name }}</p>
              <p class="text-sm text-muted">{{ (selectedFile.size / 1024).toFixed(1) }} KB</p>
            </div>
          </div>

          <!-- responsive-and-a11y-foundation §5.1 —
               < md: single-column stack; >= md: two-column grid. -->
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField
              label="文件標題"
              name="title"
              required
              :help="isLocked ? '鎖定模式：沿用既有文件標題' : undefined"
            >
              <UInput
                v-model="documentMeta.title"
                placeholder="輸入文件標題"
                class="w-full"
                :disabled="isLocked"
              />
            </UFormField>
            <UFormField
              label="文件代碼"
              name="slug"
              required
              :help="
                isLocked
                  ? '🔒 鎖定為既有文件代碼，確保以新版本入庫'
                  : slugConflict
                    ? 'ℹ️ 此文件代碼已存在，將以新版本上傳到既有文件'
                    : '小寫英數字與連字符（-）'
              "
            >
              <UInput
                v-model="documentMeta.slug"
                placeholder="document-slug"
                class="w-full"
                :disabled="isLocked"
                :readonly="isLocked"
              />
            </UFormField>
            <UFormField
              label="分類"
              name="categorySlug"
              :help="isLocked ? '鎖定模式：沿用既有文件分類' : '選填'"
            >
              <UInput
                v-model="documentMeta.categorySlug"
                placeholder="general"
                class="w-full"
                :disabled="isLocked"
              />
            </UFormField>
            <UFormField
              label="存取等級"
              name="accessLevel"
              :description="
                isLocked ? '鎖定模式：沿用既有文件存取等級' : '決定誰可以在知識庫中查詢此文件'
              "
              required
            >
              <URadioGroup
                v-model="documentMeta.accessLevel"
                :disabled="isLocked"
                :items="[
                  { value: 'internal', label: '內部', description: '所有已登入使用者' },
                  { value: 'restricted', label: '受限', description: '僅管理員' },
                ]"
              />
            </UFormField>
          </div>
        </div>

        <!-- responsive-and-a11y-foundation §5.1 —
             < md: buttons stack full-width (primary above cancel so thumb
             reaches it first on tall phones); >= md: right-aligned inline. -->
        <div class="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            block
            class="md:w-auto"
            @click="emit('cancel')"
          >
            取消
          </UButton>
          <UButton type="submit" color="neutral" block class="md:w-auto" :loading="isProcessing">
            開始上傳
          </UButton>
        </div>
      </UForm>
    </div>

    <div
      v-else-if="currentStep === 'indexing_wait'"
      class="flex flex-col items-center justify-center py-8 text-center"
      data-testid="indexing-wait"
    >
      <template v-if="indexingError">
        <div class="mb-4 rounded-full bg-muted p-4">
          <UIcon name="i-lucide-alert-triangle" class="size-8 text-error" />
        </div>
        <h3 class="mb-2 text-lg font-medium text-default">索引處理未完成</h3>
        <p class="mb-6 max-w-sm text-sm text-muted">{{ indexingError }}</p>
        <!-- responsive-and-a11y-foundation §5.1 — button row stacks < md. -->
        <div class="flex w-full max-w-sm flex-col-reverse gap-2 md:w-auto md:flex-row">
          <UButton
            color="neutral"
            variant="outline"
            block
            class="md:w-auto"
            @click="emit('cancel')"
          >
            返回列表
          </UButton>
          <UButton color="neutral" variant="solid" block class="md:w-auto" @click="reset">
            重新開始
          </UButton>
        </div>
      </template>
      <template v-else>
        <div class="mb-4 rounded-full bg-muted p-4">
          <UIcon
            name="i-lucide-loader-2"
            class="size-8 animate-spin text-primary motion-reduce:animate-none"
          />
        </div>
        <h3 class="mb-2 text-lg font-medium text-default">正在建立索引</h3>
        <p class="max-w-sm text-sm text-muted">
          {{ getIndexingStatusLabel(indexingStatus) }}
        </p>
        <p
          v-if="getIndexingDetailLabel(indexingStatus)"
          class="mt-2 mb-6 max-w-sm text-xs text-dimmed"
        >
          {{ getIndexingDetailLabel(indexingStatus) }}
        </p>
        <UButton color="neutral" variant="ghost" class="mt-6" @click="emit('cancel')">
          稍後返回
        </UButton>
      </template>
    </div>

    <div
      v-else-if="currentStep === 'publish'"
      class="flex flex-col items-center justify-center py-8 text-center"
    >
      <div class="mb-4 rounded-full bg-muted p-4">
        <UIcon name="i-lucide-check-circle" class="size-8 text-default" />
      </div>
      <h3 class="mb-2 text-lg font-medium text-default">文件已準備就緒</h3>
      <p class="mb-6 max-w-sm text-sm text-muted">
        文件已成功處理並編入索引。點擊下方按鈕發布至知識庫。
      </p>
      <!-- responsive-and-a11y-foundation §5.1 — button row stacks < md. -->
      <div class="flex w-full max-w-sm flex-col-reverse gap-2 md:w-auto md:flex-row">
        <UButton color="neutral" variant="outline" block class="md:w-auto" @click="emit('cancel')">
          稍後發布
        </UButton>
        <UButton
          color="neutral"
          variant="solid"
          block
          class="md:w-auto"
          :loading="isProcessing"
          @click="publishDocument"
        >
          立即發布
        </UButton>
      </div>
    </div>

    <div
      v-else-if="currentStep === 'complete'"
      class="flex flex-col items-center justify-center py-8 text-center"
    >
      <div class="mb-4 rounded-full bg-muted p-4">
        <UIcon name="i-lucide-party-popper" class="size-8 text-default" />
      </div>
      <h3 class="mb-2 text-lg font-medium text-default">發布成功</h3>
      <p class="mb-6 max-w-sm text-sm text-muted">文件已成功發布至知識庫，使用者現在可以查詢。</p>
      <!-- responsive-and-a11y-foundation §5.1 — button row stacks < md. -->
      <div class="flex w-full max-w-sm flex-col-reverse gap-2 md:w-auto md:flex-row">
        <UButton color="neutral" variant="outline" block class="md:w-auto" @click="reset">
          上傳更多
        </UButton>
        <UButton color="neutral" variant="solid" block class="md:w-auto" @click="emit('cancel')">
          返回列表
        </UButton>
      </div>
    </div>

    <div v-else class="flex flex-col items-center justify-center py-12 text-center">
      <UIcon
        name="i-lucide-loader-2"
        class="mb-4 size-8 animate-spin text-primary motion-reduce:animate-none"
      />
      <p class="text-sm text-muted">{{ steps.find((s) => s.key === currentStep)?.description }}</p>
    </div>
  </div>
</template>
