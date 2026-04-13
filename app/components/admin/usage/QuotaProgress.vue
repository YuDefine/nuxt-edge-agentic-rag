<script setup lang="ts">
  import { assertNever } from '~~/shared/utils/assert-never'

  interface Props {
    used: number
    freeQuotaPerDay: number
    remaining: number
  }

  const props = defineProps<Props>()

  const QUOTA_STATE_VALUES = ['ok', 'warning', 'exhausted'] as const
  type QuotaState = (typeof QUOTA_STATE_VALUES)[number]

  const percent = computed(() => {
    if (props.freeQuotaPerDay <= 0) return 0
    return Math.min(100, Math.round((props.used / props.freeQuotaPerDay) * 100))
  })

  const state = computed<QuotaState>(() => {
    if (props.used >= props.freeQuotaPerDay) return 'exhausted'
    if (percent.value >= 80) return 'warning'
    return 'ok'
  })

  const barColorClass = computed(() => {
    switch (state.value) {
      case 'ok':
        return 'bg-primary'
      case 'warning':
        return 'bg-warning'
      case 'exhausted':
        return 'bg-error'
      default:
        return assertNever(state.value, 'QuotaProgress.barColorClass')
    }
  })

  const hintText = computed(() => {
    switch (state.value) {
      case 'ok':
        return '每日免費額度仍在安全範圍。'
      case 'warning':
        return '今日消耗已達 80%，超過上限會開始計費。'
      case 'exhausted':
        return '今日免費額度已用罄，後續呼叫會扣費。'
      default:
        return assertNever(state.value, 'QuotaProgress.hintText')
    }
  })

  const hintColorClass = computed(() => {
    switch (state.value) {
      case 'ok':
        return 'text-muted'
      case 'warning':
        return 'text-warning'
      case 'exhausted':
        return 'text-error'
      default:
        return assertNever(state.value, 'QuotaProgress.hintColorClass')
    }
  })

  const usedLabel = computed(() => props.used.toLocaleString('en-US'))
  const remainingLabel = computed(() => props.remaining.toLocaleString('en-US'))
  const quotaLabel = computed(() => props.freeQuotaPerDay.toLocaleString('en-US'))
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col">
          <h2 class="text-base font-semibold text-default">每日免費額度（Neurons）</h2>
          <p class="mt-1 text-xs text-muted">
            Workers AI 每日 {{ quotaLabel }} 免費；超過會開始計費。
          </p>
        </div>
        <UIcon
          :name="state === 'exhausted' ? 'i-lucide-alert-octagon' : 'i-lucide-gauge'"
          class="size-5"
          :class="hintColorClass"
          aria-hidden="true"
        />
      </div>
    </template>

    <div class="flex flex-col gap-3">
      <div class="flex items-baseline justify-between">
        <span class="text-2xl font-bold text-default tabular-nums">{{ usedLabel }}</span>
        <span class="text-sm text-muted">剩餘 {{ remainingLabel }} / {{ quotaLabel }}</span>
      </div>

      <div
        class="relative h-3 w-full overflow-hidden rounded-full bg-elevated"
        role="progressbar"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`已消耗 ${percent}%`"
      >
        <div
          class="h-full rounded-full transition-all"
          :class="barColorClass"
          :style="{ width: `${percent}%` }"
        />
      </div>

      <p class="text-xs" :class="hintColorClass">{{ hintText }}</p>
    </div>
  </UCard>
</template>
