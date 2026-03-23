<script setup lang="ts">
  import { assertNever } from '#shared/utils/assert-never'
  import type { Role } from '#shared/types/auth'
  import type { AdminMemberRow } from '#shared/types/admin-members'

  /**
   * B16 §7.3 — Inline role-change actions for a member row.
   *
   * Renders the buttons that are *legal* for the target's current role.
   * Final authorisation happens server-side in
   * `server/api/admin/members/[userId].patch.ts` — this component's
   * responsibility is to (a) hide the obviously-invalid transitions and
   * (b) block the admin from demoting their own account so the common
   * case is pleasant.
   *
   * - `admin`: no inline actions (Admin promotion / demotion is env-var
   *   controlled; see `ADMIN_EMAIL_ALLOWLIST`).
   * - `member`: offer demotion to `guest`.
   * - `guest`: offer promotion to `member`.
   *
   * The button emits `change` with the desired target role; the parent
   * page opens the `ConfirmRoleChangeDialog` with that payload.
   */

  const props = defineProps<{
    row: AdminMemberRow
    currentUserId: string | null
  }>()

  const emit = defineEmits<{
    change: [value: { row: AdminMemberRow; targetRole: Role }]
  }>()

  const isSelf = computed(() => props.row.id === props.currentUserId)

  interface ActionConfig {
    label: string
    icon: string
    targetRole: Role
    color: 'neutral'
  }

  /**
   * Enumerate all actions valid for `role` using `switch + assertNever`
   * so adding a new role value fails the type-check here first.
   */
  function actionsForRole(role: Role): ActionConfig[] {
    switch (role) {
      case 'admin':
        return []
      case 'member':
        return [
          {
            label: '降為訪客',
            icon: 'i-lucide-user-minus',
            targetRole: 'guest',
            color: 'neutral',
          },
        ]
      case 'guest':
        return [
          {
            label: '升為成員',
            icon: 'i-lucide-user-plus',
            targetRole: 'member',
            color: 'neutral',
          },
        ]
      default:
        return assertNever(role, 'MemberRoleActions.actionsForRole')
    }
  }

  const actions = computed(() => actionsForRole(props.row.role))

  function selfActionHint(): string {
    return '不可對自己的 Admin 權限操作'
  }

  function adminRoleHint(): string {
    return '由伺服器設定管理'
  }

  function handleClick(target: ActionConfig) {
    emit('change', { row: props.row, targetRole: target.targetRole })
  }
</script>

<template>
  <div class="flex flex-wrap justify-end gap-1">
    <!-- Admin row: show a disabled hint button so the policy is visible -->
    <UButton
      v-if="row.role === 'admin'"
      color="neutral"
      variant="ghost"
      size="xs"
      icon="i-lucide-shield-check"
      disabled
      :aria-label="adminRoleHint()"
    >
      <span class="text-xs text-muted">{{ adminRoleHint() }}</span>
    </UButton>

    <template v-else>
      <UButton
        v-for="action in actions"
        :key="action.targetRole"
        :color="action.color"
        variant="soft"
        size="xs"
        :icon="action.icon"
        :disabled="isSelf"
        :aria-label="isSelf ? selfActionHint() : `${action.label}（${row.email ?? row.id}）`"
        @click="handleClick(action)"
      >
        {{ action.label }}
      </UButton>
    </template>
  </div>
</template>
