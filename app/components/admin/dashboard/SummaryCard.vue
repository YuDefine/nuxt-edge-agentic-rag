<script setup lang="ts">
  /**
   * Dashboard summary card: presents a single aggregate count.
   *
   * Keep the component intentionally dumb — the parent owns data fetching and
   * empty/loading/error states; this component only renders what it's told.
   */
  interface Props {
    description: string
    icon: string
    label: string
    value: number | string
  }

  defineProps<Props>()
</script>

<template>
  <UCard>
    <div class="flex items-start justify-between gap-3">
      <div class="flex flex-col gap-1">
        <p class="text-xs font-medium tracking-wide text-muted uppercase">{{ label }}</p>
        <p class="text-3xl font-bold text-default tabular-nums">{{ value }}</p>
        <p class="text-xs text-muted">{{ description }}</p>
      </div>
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"
        aria-hidden="true"
      >
        <UIcon :name="icon" class="size-5 text-default" />
      </div>
    </div>
  </UCard>
</template>
