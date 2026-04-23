<script setup lang="ts">
  import type { TableColumn } from '@nuxt/ui'

  import { formatDateTime } from '~/utils/format-datetime'
  import { assertNever } from '#shared/utils/assert-never'
  import { PAGE_SIZE_MAX } from '#shared/schemas/pagination'
  import type { AdminMemberRow } from '#shared/types/admin-members'
  import { roleLabel, type Role } from '#shared/types/auth'
  import { srOnlyHeader } from '#shared/utils/table'
  import { getUiPageState } from '#shared/utils/ui-state'

  /**
   * B16 §7.2 — Admin member list page.
   *
   * Server truth: GET /api/admin/members requires admin session.
   * This page is UX — server middleware (`admin`) redirects non-admins.
   */
  definePageMeta({
    middleware: ['admin'],
  })

  interface ListResponse {
    data: AdminMemberRow[]
    pagination: { page: number; pageSize: number; total: number }
  }

  const { user } = useUserSession()
  const currentUserId = computed<string | null>(() => user.value?.id ?? null)

  const page = ref(1)
  const pageSize = ref(Math.min(20, PAGE_SIZE_MAX))
  const roleFilter = ref<Role | 'all'>('all')

  const queryKey = computed(() => [
    'admin',
    'members',
    page.value,
    pageSize.value,
    roleFilter.value,
  ])

  const { data, state, asyncStatus, error, refetch } = useQuery({
    key: queryKey,
    query: () =>
      $fetch<ListResponse>('/api/admin/members', {
        query: {
          page: page.value,
          pageSize: pageSize.value,
          ...(roleFilter.value === 'all' ? {} : { role: roleFilter.value }),
        },
      }),
  })

  const fetchStatus = computed(() => {
    const s = asyncStatus.value
    if (s === 'loading') return 'pending'
    if (state.value.status === 'error') return 'error'
    return 'success'
  })

  const members = computed<AdminMemberRow[]>(() => data.value?.data ?? [])
  const pagination = computed(() => data.value?.pagination ?? null)

  const pageState = computed(() =>
    getUiPageState({
      error: (error.value as { statusCode?: number } | null) ?? null,
      itemCount: members.value.length,
      status: fetchStatus.value,
    }),
  )

  function roleBadgeColor(role: Role): 'neutral' {
    switch (role) {
      case 'admin':
      case 'member':
      case 'guest':
        return 'neutral'
      default:
        return assertNever(role, 'adminMembersIndex.roleBadgeColor')
    }
  }

  const formatDate = formatDateTime

  // passkey-authentication §13.2 — Column layout reshuffled so the
  // primary identifier is `displayName` (the immutable nickname) rather
  // than `email`. Email becomes a secondary column which may render
  // "—" for passkey-only users.
  const columns: TableColumn<AdminMemberRow>[] = [
    { accessorKey: 'displayName', header: '暱稱' },
    {
      accessorKey: 'email',
      header: 'Email',
      meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
    },
    { accessorKey: 'role', header: '角色' },
    {
      id: 'credentialTypes',
      header: '登入方式',
      meta: { class: { td: 'hidden sm:table-cell', th: 'hidden sm:table-cell' } },
    },
    {
      accessorKey: 'registeredAt',
      header: '註冊時間',
      meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
    },
    {
      accessorKey: 'lastActivityAt',
      header: '最後活動',
      meta: { class: { td: 'hidden lg:table-cell', th: 'hidden lg:table-cell' } },
    },
    {
      id: 'actions',
      header: srOnlyHeader('操作'),
    },
  ]

  function credentialLabel(type: 'google' | 'passkey'): string {
    switch (type) {
      case 'google':
        return 'Google'
      case 'passkey':
        return 'Passkey'
      default:
        return assertNever(type, 'adminMembersIndex.credentialLabel')
    }
  }

  function credentialIcon(type: 'google' | 'passkey'): string {
    switch (type) {
      case 'google':
        return 'i-simple-icons-google'
      case 'passkey':
        return 'i-lucide-fingerprint'
      default:
        return assertNever(type, 'adminMembersIndex.credentialIcon')
    }
  }

  const roleFilterOptions = [
    { label: '全部', value: 'all' as const },
    { label: '管理員', value: 'admin' as const },
    { label: '成員', value: 'member' as const },
    { label: '訪客', value: 'guest' as const },
  ]

  // Role change dialog state.
  const dialogOpen = ref(false)
  const dialogMember = shallowRef<AdminMemberRow | null>(null)
  const dialogTargetRole = ref<Role | null>(null)

  function handleRequestChange(payload: { row: AdminMemberRow; targetRole: Role }) {
    dialogMember.value = payload.row
    dialogTargetRole.value = payload.targetRole
    dialogOpen.value = true
  }

  function handleUpdated() {
    refetch()
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-default">成員管理</h1>
        <p class="mt-1 text-sm text-muted">
          檢視所有登入過的使用者，並升降成員 / 訪客角色。管理員由伺服器設定管理。
        </p>
      </div>
      <div class="flex flex-col gap-2 md:flex-row md:items-center">
        <USelect
          v-model="roleFilter"
          :items="roleFilterOptions"
          size="md"
          color="neutral"
          variant="outline"
          class="w-full md:w-40"
          aria-label="角色篩選"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="md"
          icon="i-lucide-refresh-cw"
          class="md:ml-2"
          @click="refetch()"
        >
          重新載入
        </UButton>
      </div>
    </div>

    <UCard>
      <template v-if="pageState === 'loading'">
        <div class="flex flex-col items-center justify-center py-16">
          <UIcon
            name="i-lucide-loader-2"
            class="mb-4 size-8 animate-spin text-muted motion-reduce:animate-none"
          />
          <p class="text-sm text-muted">載入中…</p>
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
          <h3 class="mb-2 text-lg font-semibold text-default">無法載入成員列表</h3>
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
            <UIcon name="i-lucide-users" class="size-8 text-default" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-default">尚無符合條件的成員</h3>
          <p class="mb-6 max-w-sm text-sm text-muted">
            目前沒有符合當前篩選條件的使用者。可嘗試切換為「全部」。
          </p>
          <UButton
            color="neutral"
            variant="outline"
            size="md"
            icon="i-lucide-filter-x"
            @click="roleFilter = 'all'"
          >
            清除篩選
          </UButton>
        </div>
      </template>

      <template v-else>
        <UTable :columns="columns" :data="members">
          <template #displayName-cell="{ row }">
            <div class="flex items-center gap-3">
              <UAvatar
                :src="row.original.image ?? undefined"
                :alt="row.original.displayName ?? row.original.name ?? row.original.email ?? ''"
                size="sm"
              />
              <span class="text-sm font-medium break-all text-default">
                {{ row.original.displayName ?? row.original.name ?? '—' }}
              </span>
            </div>
          </template>

          <template #email-cell="{ row }">
            <span v-if="row.original.email" class="text-sm break-all text-default">
              {{ row.original.email }}
            </span>
            <span v-else class="text-sm text-muted" aria-label="沒有 email">—</span>
          </template>

          <template #role-cell="{ row }">
            <UBadge :color="roleBadgeColor(row.original.role)" variant="subtle" size="md">
              {{ roleLabel(row.original.role) }}
            </UBadge>
          </template>

          <template #credentialTypes-cell="{ row }">
            <div class="flex flex-wrap gap-1">
              <UBadge
                v-for="credType in row.original.credentialTypes"
                :key="credType"
                color="neutral"
                variant="subtle"
                size="sm"
                :icon="credentialIcon(credType)"
              >
                {{ credentialLabel(credType) }}
              </UBadge>
              <span
                v-if="row.original.credentialTypes.length === 0"
                class="text-xs text-muted"
                aria-label="尚未綁定任何憑證"
              >
                —
              </span>
            </div>
          </template>

          <template #registeredAt-cell="{ row }">
            <span class="text-sm text-muted">{{ formatDate(row.original.registeredAt) }}</span>
          </template>

          <template #lastActivityAt-cell="{ row }">
            <span class="text-sm text-muted">{{ formatDate(row.original.lastActivityAt) }}</span>
          </template>

          <template #actions-cell="{ row }">
            <AdminMembersMemberRoleActions
              :row="row.original"
              :current-user-id="currentUserId"
              @change="handleRequestChange"
            />
          </template>
        </UTable>

        <div
          v-if="pagination && pagination.total > pageSize"
          class="flex flex-col items-center justify-between gap-2 border-t border-default p-3 md:flex-row"
        >
          <p class="text-xs text-muted">共 {{ pagination.total }} 位，第 {{ page }} 頁</p>
          <LazyUPagination
            v-model:page="page"
            :total="pagination.total"
            :items-per-page="pageSize"
          />
        </div>
      </template>
    </UCard>

    <AdminMembersConfirmRoleChangeDialog
      v-model:open="dialogOpen"
      :member="dialogMember"
      :target-role="dialogTargetRole"
      @updated="handleUpdated"
    />
  </div>
</template>
