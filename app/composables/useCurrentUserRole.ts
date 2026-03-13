import { assertNever } from '#shared/utils/assert-never'
import {
  DEFAULT_GUEST_POLICY,
  type GuestPolicy,
  guestPolicySchema,
  type Role,
} from '#shared/types/auth'

/**
 * B16 §8.4 — Combined role × guest_policy view for UI consumption.
 *
 * Extends `useUserRole()` (session-snapshot-only) with the current
 * effective `guest_policy` so the Chat surface can decide between three
 * visual states without reimplementing the pivot logic in every consumer.
 *
 * - `full`: full chat — any Admin / Member, or Guest while policy is
 *   `same_as_member`.
 * - `browse_only`: render a banner + disabled input; user may still see
 *   cached conversations but cannot submit.
 * - `pending`: redirect target is `/account-pending`; consumers should
 *   call `navigateTo('/account-pending')` when they observe this state.
 *
 * ⚠️ UI hint only — real authorisation happens server-side via
 * `requireRole('member')`. This composable exists so the Chat page can
 * render the correct affordance *before* a disallowed submit reaches the
 * server.
 */
export type GuestVisualState = 'full' | 'browse_only' | 'pending'

interface EffectivePolicyResponse {
  data: { value: GuestPolicy }
}

export function useCurrentUserRole() {
  const { role, isAdmin, isMember, isGuest } = useUserRole()

  const {
    data: policyResponse,
    pending: policyPending,
    error: policyError,
    refresh: refreshPolicy,
  } = useFetch<EffectivePolicyResponse>('/api/guest-policy/effective', {
    key: 'guest-policy-effective',
    default: () => ({ data: { value: DEFAULT_GUEST_POLICY } }),
    // Only signed-in users should hit this; non-guest UI surfaces that
    // don't need the policy pass `immediate: false` and call `refresh`
    // on demand. Default is `immediate: true` — fine for Chat page.
  })

  /**
   * Current effective `guest_policy`. Falls back to `DEFAULT_GUEST_POLICY`
   * (same_as_member) while loading / on error so UI does not block Members
   * or Admins waiting for a policy they don't need.
   */
  const policy = computed<GuestPolicy>(() => {
    const raw = policyResponse.value?.data?.value
    const parsed = guestPolicySchema.safeParse(raw)
    return parsed.success ? parsed.data : DEFAULT_GUEST_POLICY
  })

  /**
   * Map `(role, policy)` to one of three discrete visual states.
   * Exhaustively switched on `guest_policy` so adding a new enum value
   * fails the type-check here first.
   */
  const visualState = computed<GuestVisualState>(() => {
    // Admin / Member always get the full chat; policy is irrelevant.
    if (isAdmin.value || isMember.value) return 'full'

    // Guest branch — switch on policy.
    const currentPolicy = policy.value
    switch (currentPolicy) {
      case 'same_as_member':
        return 'full'
      case 'browse_only':
        return 'browse_only'
      case 'no_access':
        return 'pending'
      default:
        return assertNever(currentPolicy, 'useCurrentUserRole.visualState')
    }
  })

  /** Whether the Chat input / submit button should be usable. */
  const canAsk = computed(() => visualState.value === 'full')

  function currentRole(): Role {
    return role.value
  }

  return {
    role,
    isAdmin,
    isMember,
    isGuest,
    policy,
    visualState,
    canAsk,
    currentRole,
    policyPending,
    policyError,
    refreshPolicy,
  }
}
