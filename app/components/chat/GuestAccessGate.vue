<script setup lang="ts">
  import { assertNever } from '#shared/utils/assert-never'
  import type { GuestVisualState } from '~/composables/useCurrentUserRole'

  /**
   * B16 §8.2 — Chat / Web entry gate based on `role × guest_policy`.
   *
   * Renders one of three branches:
   *
   *  - `full`: default slot, unmodified chat experience
   *  - `browse_only`: banner above the slot; parent is responsible for
   *    honouring `canAsk === false` to disable the input. The gate
   *    exposes `canAsk` via the `state` slot prop so parents using the
   *    default slot can bind `:disabled` without re-calling the
   *    composable.
   *  - `pending`: redirects to `/account-pending` on mount; nothing is
   *    rendered in place.
   */

  const { visualState, canAsk, policy } = useCurrentUserRole()

  // no_access → redirect on mount. Using onMounted keeps SSR stable (the
  // server still renders the empty chat markup until client hydration).
  onMounted(() => {
    if (visualState.value === 'pending') {
      navigateTo('/account-pending')
    }
  })

  // If the composable produces a new pending state after mount (policy
  // flipped while the tab was open), redirect reactively too.
  watch(visualState, (next) => {
    if (next === 'pending') {
      navigateTo('/account-pending')
    }
  })

  function visualStateLabel(state: GuestVisualState): string {
    switch (state) {
      case 'full':
        return '完整存取'
      case 'browse_only':
        return '僅可瀏覽'
      case 'pending':
        return '待審核'
      default:
        return assertNever(state, 'GuestAccessGate.visualStateLabel')
    }
  }
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- browse_only: banner above default slot, input must be disabled by parent -->
    <div
      v-if="visualState === 'browse_only'"
      role="status"
      aria-live="polite"
      class="flex items-start gap-2 border-b border-warning bg-warning/10 px-3 py-2 md:items-center md:px-4 md:py-3"
      :aria-label="`訪客存取狀態：${visualStateLabel(visualState)}`"
    >
      <UIcon
        name="i-lucide-eye"
        class="mt-0.5 size-4 shrink-0 text-warning md:mt-0 md:size-5"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-default md:text-base">訪客僅可瀏覽，無法提問</p>
        <p class="mt-0.5 text-xs text-muted md:text-sm">
          目前訪客政策設為「僅可瀏覽」，如需提問請聯絡管理員申請成員身分。
        </p>
      </div>
    </div>

    <!-- full: default slot only; browse_only: slot rendered but parent should respect canAsk -->
    <div v-if="visualState !== 'pending'" class="flex min-h-0 flex-1 flex-col">
      <slot :can-ask="canAsk" :policy="policy" :visual-state="visualState" />
    </div>

    <!-- pending: placeholder while navigateTo runs; avoids flashing empty chat -->
    <div
      v-else
      class="flex flex-1 items-center justify-center px-4 py-12 text-center"
      data-testid="guest-gate-pending"
    >
      <div class="flex flex-col items-center gap-3">
        <UIcon
          name="i-lucide-loader-2"
          class="size-6 animate-spin text-muted motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p class="text-sm text-muted">正在導向待審核頁…</p>
      </div>
    </div>
  </div>
</template>
