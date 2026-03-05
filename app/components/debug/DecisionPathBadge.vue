<script setup lang="ts">
  /**
   * observability-and-debug §2.1 — badge for `query_logs.decision_path`.
   *
   * - Renders null as "未測量" (not measured) — NEVER as 'unknown' / ''
   *   (see `shared/types/observability.ts` null contract).
   * - Uses `switch + assertDecisionPathNever` via `describeDecisionPath`, so
   *   adding a new path value triggers a compile error at this callsite.
   */
  import type { DecisionPath } from '~~/shared/types/observability'
  import { describeDecisionPath } from '~/utils/debug-labels'

  interface Props {
    value: DecisionPath | null
  }

  const props = defineProps<Props>()

  const meta = computed(() => describeDecisionPath(props.value))
</script>

<template>
  <UBadge :color="meta.color" variant="subtle" size="sm">
    {{ meta.label }}
  </UBadge>
</template>
