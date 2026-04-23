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

export interface AppNavInput {
  isAdmin: boolean
  dashboardEnabled: boolean
  debugSurfaceEnabled: boolean
}

/**
 * Pure builder for the primary nav list. Exported so unit tests can
 * exercise the gating rules without stubbing the Nuxt runtime.
 *
 * `debugSurfaceEnabled` mirrors `server/utils/debug-surface-guard.ts` —
 * local / staging are always true, production is gated on the operator
 * flag. UI must stay in sync to avoid admins clicking into a 403.
 */
export function buildAppNavLinks(input: AppNavInput): AppNavLink[] {
  const items: AppNavLink[] = [{ label: '問答', to: '/', icon: 'i-lucide-messages-square' }]

  if (input.isAdmin) {
    items.push(
      { label: '文件管理', to: '/admin/documents', icon: 'i-lucide-file-text' },
      { label: '用量', to: '/admin/usage', icon: 'i-lucide-bar-chart-3' },
      { label: '成員管理', to: '/admin/members', icon: 'i-lucide-users' },
      {
        label: '訪客政策',
        to: '/admin/settings/guest-policy',
        icon: 'i-lucide-shield',
      },
      { label: 'Token 管理', to: '/admin/tokens', icon: 'i-lucide-key' },
      { label: '查詢日誌', to: '/admin/query-logs', icon: 'i-lucide-list' },
    )
    if (input.dashboardEnabled) {
      items.push({
        label: '管理摘要',
        to: '/admin/dashboard',
        icon: 'i-lucide-layout-dashboard',
      })
    }
    if (input.debugSurfaceEnabled) {
      items.push({
        label: 'Debug 延遲',
        to: '/admin/debug/latency',
        icon: 'i-lucide-activity',
      })
    }
  }

  return items
}

export function useAppNavigation() {
  const { isAdmin } = useUserRole()
  const runtimeConfig = useRuntimeConfig()
  const dashboardEnabled = computed(() => runtimeConfig.public?.adminDashboardEnabled ?? true)
  const debugSurfaceEnabled = computed(() => runtimeConfig.public?.debugSurfaceEnabled ?? false)

  const links = computed<AppNavLink[]>(() =>
    buildAppNavLinks({
      isAdmin: isAdmin.value,
      dashboardEnabled: dashboardEnabled.value,
      debugSurfaceEnabled: debugSurfaceEnabled.value,
    }),
  )

  return { links }
}
