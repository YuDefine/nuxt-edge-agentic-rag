<script setup lang="ts">
  import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
  import type { DocumentWithCurrentVersion } from '~~/shared/types/knowledge'
  import { assertNever } from '~~/shared/utils/assert-never'
  import { srOnlyHeader } from '~~/shared/utils/table'

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

  // responsive-and-a11y-foundation §4 — Hybrid Table Fallback Below md.
  // Desktop keeps the full UTable. On < md we hide secondary columns via
  // per-column meta.class `hidden md:table-cell`, and surface the hidden
  // metadata inside a USlideover detail drawer triggered by a per-row
  // `[開啟詳情]` button (design.md Open Question #1 candidate B).
  const detailOpen = ref(false)
  const detailRow = shallowRef<DocumentWithCurrentVersion | null>(null)
  const detailTriggerRef = ref<HTMLElement | null>(null)

  function openMobileDetail(row: DocumentWithCurrentVersion, event: MouseEvent) {
    // Remember the trigger so we can restore focus on close (a11y requirement).
    const target = event.currentTarget
    if (target instanceof HTMLElement) {
      detailTriggerRef.value = target
    }
    detailRow.value = row
    detailOpen.value = true
  }

  // Restore focus to the originating trigger when the drawer closes.
  // USlideover uses Reka UI's focus-scope which normally returns focus on
  // close; we watch the ref anyway to stay robust across future Nuxt UI
  // upgrades and to keep the contract observable from unit tests.
  watch(detailOpen, (next) => {
    if (!next) {
      const trigger = detailTriggerRef.value
      if (trigger) {
        queueMicrotask(() => trigger.focus())
      }
    }
  })

  const columns: TableColumn<DocumentWithCurrentVersion>[] = [
    // Primary columns stay visible on all viewports.
    { accessorKey: 'title', header: '標題' },
    {
      accessorKey: 'categorySlug',
      header: '分類',
      meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
    },
    {
      accessorKey: 'accessLevel',
      header: '權限',
      meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
    },
    { accessorKey: 'status', header: '狀態' },
    {
      accessorKey: 'currentVersion',
      header: '目前版本',
      meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
    },
    {
      accessorKey: 'updatedAt',
      header: '更新時間',
      meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
    },
    // mobileDetail column: button visible only on < md. Placed before
    // `actions` so it lands next to the status badge for thumb reach.
    {
      id: 'mobileDetail',
      header: srOnlyHeader('詳情'),
      meta: { class: { td: 'md:hidden', th: 'md:hidden' } },
    },
    { id: 'actions', header: srOnlyHeader('操作') },
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

    const navItems: DropdownMenuItem[] = [viewItem]

    // 封存狀態不允許新增版本，避免使用者以為上傳後就自動解除封存
    if (doc.status !== 'archived') {
      navItems.push({
        label: '上傳新版',
        icon: 'i-lucide-upload',
        to: `/admin/documents/upload?documentId=${doc.id}`,
      })
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
      default:
        return assertNever(doc.status, 'DocumentListTable.buildMenuItems')
    }

    return [navItems, stateItems]
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

    <template #mobileDetail-cell="{ row }">
      <div class="flex justify-end md:hidden">
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-chevron-right"
          trailing
          :aria-label="`開啟「${row.original.title}」詳情`"
          @click="(event: MouseEvent) => openMobileDetail(row.original, event)"
        >
          開啟詳情
        </UButton>
      </div>
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

  <!-- Hybrid Table Fallback Below md — detail drawer exposing secondary columns -->
  <USlideover
    v-model:open="detailOpen"
    :title="detailRow?.title ?? '文件詳情'"
    :ui="{ content: 'md:hidden' }"
  >
    <template #body>
      <div v-if="detailRow" class="flex flex-col gap-4">
        <div>
          <p class="text-xs font-medium text-muted">標題</p>
          <p class="mt-1 text-sm text-default">{{ detailRow.title }}</p>
          <p class="mt-0.5 text-xs text-muted">{{ detailRow.slug }}</p>
        </div>
        <div>
          <p class="text-xs font-medium text-muted">分類</p>
          <p class="mt-1 text-sm text-default">{{ detailRow.categorySlug || '-' }}</p>
        </div>
        <div>
          <p class="text-xs font-medium text-muted">權限</p>
          <DocumentsAccessLevelBadge :level="detailRow.accessLevel" class="mt-1" />
        </div>
        <div>
          <p class="text-xs font-medium text-muted">狀態</p>
          <DocumentsDocumentStatusBadge :status="detailRow.status" class="mt-1" />
        </div>
        <div v-if="detailRow.currentVersion">
          <p class="text-xs font-medium text-muted">目前版本</p>
          <div class="mt-1 flex items-center gap-2">
            <span class="text-sm font-medium text-default">
              v{{ detailRow.currentVersion.versionNumber }}
            </span>
            <DocumentsVersionSyncBadge :status="detailRow.currentVersion.syncStatus ?? 'pending'" />
            <DocumentsVersionIndexBadge
              :status="detailRow.currentVersion.indexStatus ?? 'pending'"
            />
          </div>
        </div>
        <div>
          <p class="text-xs font-medium text-muted">更新時間</p>
          <p class="mt-1 text-sm text-default">{{ formatDate(detailRow.updatedAt) }}</p>
        </div>
        <div class="pt-2">
          <UButton
            color="neutral"
            variant="outline"
            block
            icon="i-lucide-eye"
            :to="`/admin/documents/${detailRow.id}`"
          >
            檢視完整詳情
          </UButton>
        </div>
      </div>
    </template>
  </USlideover>

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
