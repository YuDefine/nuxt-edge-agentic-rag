<script setup lang="ts">
  import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
  import type { DocumentWithCurrentVersion } from '~~/shared/types/knowledge'
  import { assertNever } from '~~/shared/utils/assert-never'

  interface Props {
    documents: DocumentWithCurrentVersion[]
    loading?: boolean
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'action-complete': []
  }>()

  const lifecycle = useDocumentLifecycle()

  type PendingAction = {
    kind: 'delete' | 'archive' | 'unarchive'
    document: DocumentWithCurrentVersion
  }

  const pendingAction = ref<PendingAction | null>(null)
  const confirmOpen = ref(false)

  const columns: TableColumn<DocumentWithCurrentVersion>[] = [
    { accessorKey: 'title', header: '標題' },
    { accessorKey: 'categorySlug', header: '分類' },
    { accessorKey: 'accessLevel', header: '權限' },
    { accessorKey: 'status', header: '狀態' },
    { accessorKey: 'currentVersion', header: '目前版本' },
    { accessorKey: 'updatedAt', header: '更新時間' },
    { id: 'actions', header: '' },
  ]

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function hasPublishedHistory(doc: DocumentWithCurrentVersion): boolean {
    return doc.currentVersion?.publishedAt !== null && doc.currentVersion?.publishedAt !== undefined
  }

  function openConfirm(kind: PendingAction['kind'], doc: DocumentWithCurrentVersion) {
    pendingAction.value = { kind, document: doc }
    confirmOpen.value = true
  }

  function buildMenuItems(doc: DocumentWithCurrentVersion): DropdownMenuItem[][] {
    const viewItem: DropdownMenuItem = {
      label: '檢視詳情',
      icon: 'i-lucide-eye',
      to: `/admin/documents/${doc.id}`,
    }

    const stateItems: DropdownMenuItem[] = []

    switch (doc.status) {
      case 'draft':
        if (hasPublishedHistory(doc)) {
          stateItems.push({
            label: '封存',
            icon: 'i-lucide-archive',
            onSelect: () => openConfirm('archive', doc),
          })
        } else {
          stateItems.push({
            label: '刪除',
            icon: 'i-lucide-trash-2',
            color: 'error',
            onSelect: () => openConfirm('delete', doc),
          })
        }
        break
      case 'active':
        stateItems.push({
          label: '封存',
          icon: 'i-lucide-archive',
          onSelect: () => openConfirm('archive', doc),
        })
        break
      case 'archived':
        stateItems.push({
          label: '解除封存',
          icon: 'i-lucide-archive-restore',
          onSelect: () => openConfirm('unarchive', doc),
        })
        break
    }

    return [[viewItem], stateItems]
  }

  async function runLifecycleAction(kind: PendingAction['kind'], documentId: string) {
    switch (kind) {
      case 'delete':
        return lifecycle.deleteDocument(documentId)
      case 'archive':
        return lifecycle.archive(documentId)
      case 'unarchive':
        return lifecycle.unarchive(documentId)
      default:
        return assertNever(kind, 'DocumentListTable.runLifecycleAction')
    }
  }

  async function handleConfirm() {
    if (!pendingAction.value) return
    const { kind, document } = pendingAction.value

    const result = await runLifecycleAction(kind, document.id)

    if (result.ok) {
      confirmOpen.value = false
      pendingAction.value = null
      emit('action-complete')
    }
  }

  function handleCancel() {
    confirmOpen.value = false
    pendingAction.value = null
  }
</script>

<template>
  <UTable :columns="columns" :data="props.documents" :loading="props.loading">
    <template #title-cell="{ row }">
      <NuxtLink
        :to="`/admin/documents/${row.original.id}`"
        class="block transition-colors hover:underline"
      >
        <div class="font-medium text-default">{{ row.original.title }}</div>
        <div class="text-sm text-muted">{{ row.original.slug }}</div>
      </NuxtLink>
    </template>

    <template #categorySlug-cell="{ row }">
      <span class="text-sm">{{ row.original.categorySlug || '-' }}</span>
    </template>

    <template #accessLevel-cell="{ row }">
      <DocumentsAccessLevelBadge :level="row.original.accessLevel" />
    </template>

    <template #status-cell="{ row }">
      <DocumentsDocumentStatusBadge :status="row.original.status" />
    </template>

    <template #currentVersion-cell="{ row }">
      <div v-if="row.original.currentVersion" class="flex flex-col gap-1">
        <span class="text-sm font-medium">v{{ row.original.currentVersion?.versionNumber }}</span>
        <div class="flex gap-1">
          <DocumentsVersionSyncBadge
            :status="row.original.currentVersion?.syncStatus ?? 'pending'"
          />
          <DocumentsVersionIndexBadge
            :status="row.original.currentVersion?.indexStatus ?? 'pending'"
          />
        </div>
      </div>
      <span v-else class="text-sm text-muted">無版本</span>
    </template>

    <template #updatedAt-cell="{ row }">
      <span class="text-sm text-muted">{{ formatDate(row.original.updatedAt) }}</span>
    </template>

    <template #actions-cell="{ row }">
      <div class="flex justify-end">
        <UDropdownMenu :items="buildMenuItems(row.original)">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-ellipsis"
            aria-label="文件動作選單"
          />
        </UDropdownMenu>
      </div>
    </template>
  </UTable>

  <DocumentsLifecycleConfirmDialog
    v-if="pendingAction"
    v-model:open="confirmOpen"
    :action="pendingAction.kind"
    :document-title="pendingAction.document.title"
    :version-count="null"
    :source-chunk-count="null"
    :loading="lifecycle.isPending.value"
    @confirm="handleConfirm"
    @cancel="handleCancel"
  />
</template>
