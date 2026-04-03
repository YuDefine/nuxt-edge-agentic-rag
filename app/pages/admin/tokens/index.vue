<script setup lang="ts">
  import type { TableColumn } from '@nuxt/ui'

  import { srOnlyHeader } from '~~/shared/utils/table'
  import { getUiPageState } from '~~/shared/utils/ui-state'

  /**
   * Admin MCP Token management page.
   *
   * Server truth: GET/POST/DELETE /api/admin/mcp-tokens — gated by
   * `requireRuntimeAdminSession`. This page is a UX hint layer; real auth
   * happens server-side. See `server/api/admin/mcp-tokens/*` for contracts.
   */
  definePageMeta({
    middleware: ['admin'],
  })

  interface TokenRow {
    createdAt: string
    expiresAt: string | null
    id: string
    lastUsedAt: string | null
    name: string
    revokedAt: string | null
    scopes: string[]
    status: 'active' | 'revoked' | 'expired'
  }

  interface ListResponse {
    data: TokenRow[]
    pagination: { page: number; pageSize: number; total: number }
  }

  const toast = useToast()
  const { $csrfFetch } = useNuxtApp()

  const { data, state, asyncStatus, error, refetch } = useQuery({
    key: ['admin', 'mcp-tokens'],
    query: () => $fetch<ListResponse>('/api/admin/mcp-tokens'),
  })

  // Map pinia-colada asyncStatus to the shared UI state vocabulary.
  const fetchStatus = computed(() => {
    const s = asyncStatus.value
    if (s === 'loading') return 'pending'
    if (state.value.status === 'error') return 'error'
    return 'success'
  })

  const tokens = computed<TokenRow[]>(() => data.value?.data ?? [])

  const pageState = computed(() =>
    getUiPageState({
      error: (error.value as { statusCode?: number } | null) ?? null,
      itemCount: tokens.value.length,
      status: fetchStatus.value,
    }),
  )

  const createOpen = ref(false)
  const revokeOpen = ref(false)
  const revokeTarget = ref<TokenRow | null>(null)
  const revokeLoading = ref(false)

  function openCreate() {
    createOpen.value = true
  }

  function handleCreated() {
    // Refresh list so newly-created token appears; the modal stays open to
    // continue showing the one-time reveal until the admin manually closes.
    refetch()
  }

  function openRevoke(row: TokenRow) {
    revokeTarget.value = row
    revokeOpen.value = true
  }

  async function confirmRevoke() {
    if (!revokeTarget.value) return
    revokeLoading.value = true
    try {
      await $csrfFetch(`/api/admin/mcp-tokens/${revokeTarget.value.id}`, { method: 'DELETE' })
      toast.add({
        title: 'Token 已撤銷',
        description: revokeTarget.value.name,
        color: 'success',
        icon: 'i-lucide-check-circle',
      })
      revokeOpen.value = false
      revokeTarget.value = null
      refetch()
    } catch (err) {
      const fetchErr = err as { data?: { statusMessage?: string } }
      toast.add({
        title: '撤銷失敗',
        description: fetchErr?.data?.statusMessage ?? '請稍後再試',
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
    } finally {
      revokeLoading.value = false
    }
  }

  function formatDate(dateString: string | null): string {
    if (!dateString) return '—'
    return new Date(dateString).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const columns: TableColumn<TokenRow>[] = [
    { accessorKey: 'name', header: '名稱' },
    { accessorKey: 'scopes', header: '權限 Scopes' },
    { accessorKey: 'status', header: '狀態' },
    { accessorKey: 'expiresAt', header: '到期時間' },
    { accessorKey: 'lastUsedAt', header: '最近使用' },
    { accessorKey: 'createdAt', header: '建立時間' },
    { id: 'actions', header: srOnlyHeader('操作') },
  ]
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-default">MCP Token 管理</h1>
        <p class="mt-1 text-sm text-muted">建立、檢視並撤銷 MCP 代理存取 token。</p>
      </div>
      <UButton color="primary" variant="solid" size="md" icon="i-lucide-plus" @click="openCreate">
        建立 Token
      </UButton>
    </div>

    <UCard>
      <template v-if="pageState === 'loading'">
        <div class="flex flex-col items-center justify-center py-16">
          <UIcon
            name="i-lucide-loader-2"
            class="mb-4 size-8 animate-spin text-muted motion-reduce:animate-none"
          />
          <p class="text-sm text-muted">載入中...</p>
        </div>
      </template>

      <template v-else-if="pageState === 'unauthorized'">
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-shield-off" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">權限不足</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            此頁面僅限管理員使用。若您認為這是錯誤，請聯絡系統管理員。
          </p>
          <UButton color="neutral" variant="outline" size="md" to="/">返回首頁</UButton>
        </div>
      </template>

      <template v-else-if="pageState === 'error'">
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-cloud-off" class="size-8 text-muted" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入 Token 列表</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">連線可能暫時中斷，請檢查網路後再試。</p>
          <UButton
            color="neutral"
            variant="outline"
            size="md"
            icon="i-lucide-refresh-cw"
            @click="refetch()"
          >
            重新載入
          </UButton>
        </div>
      </template>

      <template v-else-if="pageState === 'empty'">
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-key" class="size-8 text-default" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">尚未建立任何 Token</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            建立第一個 MCP token 後，代理即可使用它存取知識庫 API。
          </p>
          <UButton
            color="primary"
            variant="solid"
            size="md"
            icon="i-lucide-plus"
            @click="openCreate"
          >
            建立第一個 Token
          </UButton>
        </div>
      </template>

      <template v-else>
        <UTable :columns="columns" :data="tokens">
          <template #name-cell="{ row }">
            <span class="font-medium text-default">{{ row.original.name }}</span>
          </template>

          <template #scopes-cell="{ row }">
            <AdminTokensTokenScopeList :scopes="row.original.scopes" />
          </template>

          <template #status-cell="{ row }">
            <AdminTokensTokenStatusBadge :status="row.original.status" />
          </template>

          <template #expiresAt-cell="{ row }">
            <span class="text-sm text-muted">{{ formatDate(row.original.expiresAt) }}</span>
          </template>

          <template #lastUsedAt-cell="{ row }">
            <span class="text-sm text-muted">{{ formatDate(row.original.lastUsedAt) }}</span>
          </template>

          <template #createdAt-cell="{ row }">
            <span class="text-sm text-muted">{{ formatDate(row.original.createdAt) }}</span>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex justify-end">
              <UButton
                v-if="row.original.status === 'active'"
                color="error"
                variant="ghost"
                size="xs"
                icon="i-lucide-ban"
                :aria-label="`撤銷 ${row.original.name}`"
                @click="openRevoke(row.original)"
              >
                撤銷
              </UButton>
              <span v-else class="text-xs text-muted">—</span>
            </div>
          </template>
        </UTable>
      </template>
    </UCard>

    <AdminTokensTokenCreateModal v-model:open="createOpen" @created="handleCreated" />

    <AdminTokensTokenRevokeConfirm
      v-if="revokeTarget"
      v-model:open="revokeOpen"
      :token-name="revokeTarget.name"
      :loading="revokeLoading"
      @confirm="confirmRevoke"
    />
  </div>
</template>
