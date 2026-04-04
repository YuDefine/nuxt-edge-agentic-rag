<script setup lang="ts">
  /**
   * observability-and-debug §2.2 — displays retrieval_score, judge_score,
   * refusal_reason. NULL values surface as "未測量" — NEVER fabricated.
   */
  import type { RefusalReason } from '~~/shared/types/observability'
  import { describeRefusalReason, formatScore } from '~/utils/debug-labels'

  interface Props {
    retrievalScore: number | null
    judgeScore: number | null
    refusalReason: RefusalReason | null
  }

  const props = defineProps<Props>()

  const retrievalText = computed(() => formatScore(props.retrievalScore))
  const judgeText = computed(() => formatScore(props.judgeScore))
  const refusalMeta = computed(() => describeRefusalReason(props.refusalReason))
</script>

<template>
  <UCard>
    <template #header>
      <h3 class="text-base font-semibold text-default">評分與拒答原因</h3>
    </template>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <!-- Retrieval score -->
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">檢索分數</span>
        <span
          v-if="retrievalScore === null"
          class="text-sm text-muted"
          data-testid="retrieval-score-unmeasured"
        >
          未測量
        </span>
        <span v-else class="text-lg font-semibold text-default" data-testid="retrieval-score">
          {{ retrievalText }}
        </span>
      </div>

      <!-- Judge score -->
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">評審分數</span>
        <span
          v-if="judgeScore === null"
          class="text-sm text-muted"
          data-testid="judge-score-unmeasured"
        >
          未測量
        </span>
        <span v-else class="text-lg font-semibold text-default" data-testid="judge-score">
          {{ judgeText }}
        </span>
      </div>

      <!-- Refusal reason -->
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted uppercase">拒答原因</span>
        <UBadge :color="refusalMeta.color" variant="subtle" size="sm" class="self-start">
          {{ refusalMeta.label }}
        </UBadge>
      </div>
    </div>
  </UCard>
</template>
