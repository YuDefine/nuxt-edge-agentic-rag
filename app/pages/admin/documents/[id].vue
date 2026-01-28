<script setup lang="ts">
  import type { DocumentWithAllVersions } from '~~/server/utils/document-list-store'

  /**
   * Admin document detail page - requires admin role.
   * Server truth: GET /api/admin/documents/[id] requires admin session
   */
  definePageMeta({
    middleware: ['admin'],
  })

  const route = useRoute()
  const documentId = computed(() => route.params.id as string)

  const { data, status, error, refresh } = await useFetch<{ data: DocumentWithAllVersions }>(
    () => `/api/admin/documents/${documentId.value}`
  )

  const document = computed(() => data.value?.data ?? null)
  const isLoading = computed(() => status.value === 'pending')
  const hasError = computed(() => status.value === 'error')

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
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
      <!-- Document info -->
      <div>
        <h1 class="text-2xl font-bold text-default">{{ document.title }}</h1>
        <p class="mt-1 text-sm text-muted">{{ document.slug }}</p>
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

        <div class="grid gap-4 sm:grid-cols-2">
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
            <p class="text-xs font-medium text-muted">歸檔時間</p>
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
              to="/admin/documents/upload"
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
          <div
            v-for="version in document.versions"
            :key="version.id"
            class="flex items-center justify-between py-4 first:pt-0 last:pb-0"
          >
            <div class="flex items-center gap-4">
              <div class="flex size-10 items-center justify-center rounded-full bg-muted">
                <span class="text-sm font-semibold text-default">v{{ version.versionNumber }}</span>
              </div>
              <div>
                <div class="flex items-center gap-2">
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

            <div class="flex items-center gap-2">
              <DocumentsVersionSyncBadge :status="version.syncStatus" />
              <DocumentsVersionIndexBadge :status="version.indexStatus" />
            </div>
          </div>
        </div>
      </UCard>
    </template>
  </div>
</template>
