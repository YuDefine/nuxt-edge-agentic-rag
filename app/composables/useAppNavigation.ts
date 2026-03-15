/**
 * Canonical primary-navigation link list for the app shell.
 *
 * Both `app/layouts/default.vue` and `app/layouts/chat.vue` render the
 * same primary nav (top-bar on `>= md`, drawer on `< md`). Keeping the
 * `links` array in a single composable prevents the two layouts from
 * drifting — a bug that shipped in v0.18.0 where chat layout silently
 * lost `/admin/tokens` / `/admin/query-logs` / `/admin/dashboard` /
 * `/admin/debug/latency` after B16 §8.1 added Members / Guest Policy
 * entries to default layout only.
 */
export interface AppNavLink {
  label: string
  to: string
  icon: string
}

export function useAppNavigation() {
  const { isAdmin } = useUserRole()
  const runtimeConfig = useRuntimeConfig()
  const dashboardEnabled = computed(() => runtimeConfig.public?.adminDashboardEnabled ?? true)

  const links = computed<AppNavLink[]>(() => {
    const items: AppNavLink[] = [{ label: '問答', to: '/', icon: 'i-lucide-messages-square' }]

    if (isAdmin.value) {
      items.push(
        { label: '文件管理', to: '/admin/documents', icon: 'i-lucide-file-text' },
        { label: '成員管理', to: '/admin/members', icon: 'i-lucide-users' },
        {
          label: '訪客政策',
          to: '/admin/settings/guest-policy',
          icon: 'i-lucide-shield',
        },
        { label: 'Token 管理', to: '/admin/tokens', icon: 'i-lucide-key' },
        { label: '查詢日誌', to: '/admin/query-logs', icon: 'i-lucide-list' },
      )
      if (dashboardEnabled.value) {
        items.push({
          label: '管理摘要',
          to: '/admin/dashboard',
          icon: 'i-lucide-layout-dashboard',
        })
      }
      items.push({
        label: 'Debug 延遲',
        to: '/admin/debug/latency',
        icon: 'i-lucide-activity',
      })
    }

    return items
  })

  return { links }
}
