<script setup lang="ts">
  /**
   * Clickable citation marker that triggers citation replay.
   */
  interface Props {
    citationId: string
    index: number
  }

  defineProps<Props>()

  const emit = defineEmits<{
    click: [citationId: string]
  }>()
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded border border-default bg-accented px-1.5 py-0.5 text-xs font-medium text-default transition-colors hover:border-primary hover:bg-primary/10 hover:ring-2 hover:ring-primary/20"
    @click="emit('click', citationId)"
  >
    <UIcon name="i-lucide-file-text" class="size-3" />
    <span>引用 {{ index + 1 }}</span>
  </button>
</template>
