<script setup lang="ts">
  import type {
    DocumentVersion,
    DocumentWithAllVersions,
  } from '~~/server/utils/document-list-store'
  import { assertNever } from '~~/shared/utils/assert-never'

  /**
   * Admin document detail page - requires admin role.
   * Server truth: GET /api/admin/documents/[id] requires admin session
   */
  definePageMeta({
    middleware: ['admin'],
  })

  const route = useRoute()
  const router = useRouter()
  const documentId = computed(() => route.params.id as string)

  const { data, status, error, refresh } = await useFetch<{ data: DocumentWithAllVersions }>(
    () => `/api/admin/documents/${documentId.value}`
  )

  const document = computed(() => data.value?.data ?? null)
  const isLoading = computed(() => status.value === 'pending')
  const hasError = computed(() => status.value === 'error')

  const lifecycle = useDocumentLifecycle()

  type PendingAction = { kind: 'delete' | 'archive' | 'unarchive' }
  const pendingAction = ref<PendingAction | null>(null)
  const confirmOpen = ref(false)
  const retryingVersionId = ref<string | null>(null)

  const rollbackTarget = ref<DocumentVersion | null>(null)
  const rollbackOpen = ref(false)
  const rollbackPendingId = ref<string | null>(null)

  const hasPublishedHistory = computed(() =>
    (document.value?.versions ?? []).some((v) => v.publishedAt !== null)
  )

  const versionCount = computed(() => document.value?.versions.length ?? 0)

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function canShowRetry(version: DocumentVersion): boolean {
    return version.syncStatus === 'pending' || version.syncStatus === 'failed'
  }

  // 此按鈕只會在 syncStatus ∈ {pending, failed} 時 render（見 template 的 v-else-if="canShowRetry"），
  // 因此只需判斷是否為目前正在重試的那一列。
  function isRetryDisabled(version: DocumentVersion): boolean {
    return retryingVersionId.value === version.id
  }

  async function handleRetrySync(version: DocumentVersion) {
    if (!document.value) return
    retryingVersionId.value = version.id
    const result = await lifecycle.retrySync(document.value.id, version.id)
    retryingVersionId.value = null
    if (result.ok) await refresh()
  }

  function openConfirm(kind: PendingAction['kind']) {
    pendingAction.value = { kind }
    confirmOpen.value = true
  }

  async function runLifecycleAction(kind: PendingAction['kind'], targetId: string) {
    switch (kind) {
      case 'delete':
        return lifecycle.deleteDocument(targetId)
      case 'archive':
        return lifecycle.archive(targetId)
      case 'unarchive':
        return lifecycle.unarchive(targetId)
      default:
        return assertNever(kind, 'admin.documents[id].runLifecycleAction')
    }
  }

  async function handleConfirm() {
    if (!pendingAction.value || !document.value) return
    const doc = document.value
    const completedKind = pendingAction.value.kind

    const result = await runLifecycleAction(completedKind, doc.id)

    if (result.ok) {
      confirmOpen.value = false
      pendingAction.value = null

      if (completedKind === 'delete') {
        await router.push('/admin/documents')
      } else {
        await refresh()
      }
    }
  }

  function handleCancel() {
    confirmOpen.value = false
    pendingAction.value = null
  }

  function canRollback(version: DocumentVersion): boolean {
    return (
      !version.isCurrent &&
      version.indexStatus === 'indexed' &&
      version.syncStatus !== 'running' &&
      document.value?.status !== 'archived'
    )
  }

  function openRollback(version: DocumentVersion) {
    rollbackTarget.value = version
    rollbackOpen.value = true
  }

  async function confirmRollback() {
    if (!rollbackTarget.value || !document.value) return
    const versionId = rollbackTarget.value.id
    rollbackPendingId.value = versionId
    const result = await lifecycle.setAsCurrentVersion(document.value.id, versionId)
    rollbackPendingId.value = null
    if (result.ok) {
      rollbackOpen.value = false
      rollbackTarget.value = null
      await refresh()
    }
  }

  function cancelRollback() {
    rollbackOpen.value = false
    rollbackTarget.value = null
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
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

    <!-- Loading state -->
    <template v-if="isLoading">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16">
          <UIcon name="i-lucide-loader-2" class="mb-4 size-8 animate-spin text-muted" />
          <p class="text-sm text-muted">載入中...</p>
        </div>
      </UCard>
    </template>

    <!-- Error state -->
    <template v-else-if="hasError">
      <UCard>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-file-x" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入文件</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            {{
              error?.statusCode === 404
                ? '找不到此文件，可能已被刪除。'
                : '連線可能暫時中斷，請檢查網路後再試。'
            }}
          </p>
          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="outline"
              size="md"
              icon="i-lucide-arrow-left"
              to="/admin/documents"
            >
              返回列表
            </UButton>
            <UButton
              v-if="error?.statusCode !== 404"
              color="neutral"
              variant="solid"
              size="md"
              icon="i-lucide-refresh-cw"
              @click="refresh()"
            >
              重新載入
            </UButton>
          </div>
        </div>
      </UCard>
    </template>

    <!-- Content -->
    <template v-else-if="document">
      <!-- Document info + toolbar -->
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-default">{{ document.title }}</h1>
          <p class="mt-1 text-sm text-muted">{{ document.slug }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- draft + no published history → delete -->
          <UButton
            v-if="document.status === 'draft' && !hasPublishedHistory"
            color="error"
            variant="outline"
            size="sm"
            icon="i-lucide-trash-2"
            @click="openConfirm('delete')"
          >
            刪除
          </UButton>

          <!-- draft with published history OR active → archive -->
          <UButton
            v-if="
              (document.status === 'draft' && hasPublishedHistory) || document.status === 'active'
            "
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-archive"
            @click="openConfirm('archive')"
          >
            封存
          </UButton>

          <!-- archived → unarchive -->
          <UButton
            v-if="document.status === 'archived'"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-archive-restore"
            @click="openConfirm('unarchive')"
          >
            解除封存
          </UButton>
        </div>
      </div>

      <!-- Metadata card -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-default">文件資訊</h2>
            <div class="flex gap-2">
              <DocumentsDocumentStatusBadge :status="document.status" />
              <DocumentsAccessLevelBadge :level="document.accessLevel" />
            </div>
          </div>
        </template>

        <!-- responsive-and-a11y-foundation §5.4 —
             < md: single-column stack so metadata rows breathe on phones;
             >= md: two-column grid. -->
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <p class="text-xs font-medium text-muted">分類</p>
            <p class="mt-1 text-sm text-default">{{ document.categorySlug || '（未分類）' }}</p>
          </div>
          <div>
            <p class="text-xs font-medium text-muted">建立時間</p>
            <p class="mt-1 text-sm text-default">{{ formatDate(document.createdAt) }}</p>
          </div>
          <div>
            <p class="text-xs font-medium text-muted">最後更新</p>
            <p class="mt-1 text-sm text-default">{{ formatDate(document.updatedAt) }}</p>
          </div>
          <div v-if="document.archivedAt">
            <p class="text-xs font-medium text-muted">封存時間</p>
            <p class="mt-1 text-sm text-default">{{ formatDate(document.archivedAt) }}</p>
          </div>
        </div>
      </UCard>

      <!-- Version history -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-default">版本歷史</h2>
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-upload"
              :to="`/admin/documents/upload?documentId=${document.id}`"
            >
              上傳新版
            </UButton>
          </div>
        </template>

        <div v-if="document.versions.length === 0" class="py-8 text-center">
          <UIcon name="i-lucide-file-text" class="mx-auto mb-2 size-8 text-muted" />
          <p class="text-sm text-muted">尚無版本記錄</p>
        </div>

        <div v-else class="divide-y divide-default">
          <!-- responsive-and-a11y-foundation §5.4 —
               < md: version row stacks (metadata above actions) so buttons get
               full rowwidth and don't collide with timestamps; >= md: inline. -->
          <div
            v-for="version in document.versions"
            :key="version.id"
            class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-4"
          >
            <div class="flex items-center gap-4">
              <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <span class="text-sm font-semibold text-default">v{{ version.versionNumber }}</span>
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-default">版本 {{ version.versionNumber }}</span>
                  <UBadge v-if="version.isCurrent" color="neutral" variant="solid" size="xs">
                    目前版本
                  </UBadge>
                </div>
                <p class="text-xs text-muted">
                  {{ formatDate(version.createdAt) }}
                  <span v-if="version.publishedAt" class="ml-2">
                    發布於 {{ formatDate(version.publishedAt) }}
                  </span>
                </p>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <DocumentsVersionSyncBadge :status="version.syncStatus" />
              <DocumentsVersionIndexBadge :status="version.indexStatus" />

              <!-- Running: disabled button with loading indicator -->
              <UButton
                v-if="version.syncStatus === 'running'"
                color="neutral"
                variant="soft"
                size="xs"
                icon="i-lucide-loader-2"
                :ui="{ leadingIcon: 'animate-spin' }"
                disabled
              >
                同步中
              </UButton>

              <!-- Pending/Failed: retry button -->
              <UButton
                v-else-if="canShowRetry(version)"
                color="neutral"
                variant="outline"
                size="xs"
                icon="i-lucide-refresh-cw"
                :loading="isRetryDisabled(version)"
                :disabled="isRetryDisabled(version)"
                @click="handleRetrySync(version)"
              >
                重試同步
              </UButton>

              <!-- Rollback: set non-current indexed version as current -->
              <UButton
                v-if="canRollback(version)"
                color="neutral"
                variant="soft"
                size="xs"
                icon="i-lucide-git-branch"
                :loading="rollbackPendingId === version.id"
                :disabled="rollbackPendingId !== null"
                @click="openRollback(version)"
              >
                切為目前版本
              </UButton>
            </div>
          </div>
        </div>
      </UCard>
    </template>

    <!-- Confirmation dialog -->
    <DocumentsLifecycleConfirmDialog
      v-if="pendingAction && document"
      v-model:open="confirmOpen"
      :action="pendingAction.kind"
      :document-title="document.title"
      :version-count="versionCount"
      :source-chunk-count="null"
      :loading="lifecycle.isPending.value"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />

    <!-- Rollback confirmation -->
    <UModal v-model:open="rollbackOpen">
      <template #content>
        <UCard v-if="rollbackTarget">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-git-branch" class="size-5 text-primary" />
              <h3 class="text-lg font-semibold text-default">切換目前版本</h3>
            </div>
          </template>

          <div class="flex flex-col gap-3">
            <p class="text-sm text-default">
              確定要將版本
              <span class="font-semibold">v{{ rollbackTarget.versionNumber }}</span>
              設為此文件的目前版本嗎？
            </p>
            <UAlert
              color="warning"
              variant="subtle"
              icon="i-lucide-alert-triangle"
              title="此操作會影響後續檢索"
              description="切換後，新的問答將以此版本為引用來源，舊版本將被標記為「已非最新版」。"
            />
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                :disabled="lifecycle.isPending.value"
                @click="cancelRollback"
              >
                取消
              </UButton>
              <UButton
                color="neutral"
                variant="solid"
                icon="i-lucide-check"
                :loading="lifecycle.isPending.value"
                @click="confirmRollback"
              >
                確認切換
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
