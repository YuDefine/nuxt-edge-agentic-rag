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
    class="inline-flex items-center gap-1 rounded bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary-200 dark:bg-primary-900 dark:hover:bg-primary-800"
    @click="emit('click', citationId)"
  >
    <UIcon name="i-lucide-file-text" class="size-3" />
    <span>引用 {{ index + 1 }}</span>
  </button>
</template>
