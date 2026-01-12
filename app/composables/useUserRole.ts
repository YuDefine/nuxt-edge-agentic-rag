import { deriveAllowedAccessLevels } from '../../shared/schemas/knowledge-runtime'

export function useUserRole() {
  const { loggedIn, user } = useUserSession()

  const role = computed(() => {
    const currentUser = user.value as { role?: string | null } | null

    return currentUser?.role === 'admin' ? 'admin' : 'user'
  })

  const isAdmin = computed(() => role.value === 'admin')
  const allowedAccessLevels = computed(() =>
    deriveAllowedAccessLevels({
      channel: 'web',
      isAdmin: isAdmin.value,
      isAuthenticated: loggedIn.value,
    })
  )

  function hasRole(targetRole: string): boolean {
    return role.value === targetRole
  }

  return { role, isAdmin, allowedAccessLevels, hasRole }
}
