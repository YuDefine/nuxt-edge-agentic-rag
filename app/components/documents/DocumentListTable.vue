<script setup lang="ts">
  import type { DocumentWithCurrentVersion } from '~~/shared/types/knowledge'

  interface Props {
    documents: DocumentWithCurrentVersion[]
    loading?: boolean
  }

  defineProps<Props>()

  const columns = [
    { key: 'title', label: '標題' },
    { key: 'categorySlug', label: '分類' },
    { key: 'accessLevel', label: '權限' },
    { key: 'status', label: '狀態' },
    { key: 'currentVersion', label: '目前版本' },
    { key: 'updatedAt', label: '更新時間' },
    { key: 'actions', label: '' },
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

  function getRow(row: unknown): DocumentWithCurrentVersion {
    return row as DocumentWithCurrentVersion
  }
</script>

<template>
  <UTable :columns="columns as any" :rows="documents" :loading="loading">
    <template #title-cell="{ row }">
      <NuxtLink
        :to="`/admin/documents/${getRow(row).id}`"
        class="block transition-colors hover:underline"
      >
        <div class="font-medium text-default">{{ getRow(row).title }}</div>
        <div class="text-sm text-muted">{{ getRow(row).slug }}</div>
      </NuxtLink>
    </template>

    <template #categorySlug-cell="{ row }">
      <span class="text-sm">{{ getRow(row).categorySlug || '-' }}</span>
    </template>

    <template #accessLevel-cell="{ row }">
      <DocumentsAccessLevelBadge :level="getRow(row).accessLevel" />
    </template>

    <template #status-cell="{ row }">
      <DocumentsDocumentStatusBadge :status="getRow(row).status" />
    </template>

    <template #currentVersion-cell="{ row }">
      <div v-if="getRow(row).currentVersion" class="flex flex-col gap-1">
        <span class="text-sm font-medium">v{{ getRow(row).currentVersion?.versionNumber }}</span>
        <div class="flex gap-1">
          <DocumentsVersionSyncBadge
            :status="getRow(row).currentVersion?.syncStatus ?? 'pending'"
          />
          <DocumentsVersionIndexBadge
            :status="getRow(row).currentVersion?.indexStatus ?? 'pending'"
          />
        </div>
      </div>
      <span v-else class="text-sm text-muted">無版本</span>
    </template>

    <template #updatedAt-cell="{ row }">
      <span class="text-sm text-muted">{{ formatDate(getRow(row).updatedAt) }}</span>
    </template>

    <template #actions-cell="{ row }">
      <div class="flex justify-end gap-1">
        <UTooltip text="檢視文件詳情">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-eye"
            aria-label="檢視文件"
            :to="`/admin/documents/${getRow(row).id}`"
          />
        </UTooltip>
      </div>
    </template>
  </UTable>
</template>
