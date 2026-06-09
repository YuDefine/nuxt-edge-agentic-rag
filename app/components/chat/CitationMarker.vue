<script setup lang="ts">
  /**
   * Clickable citation marker that triggers citation replay.
   */
  interface Props {
    citationId: string
    documentTitle?: string
    index: number
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    click: [citationId: string]
  }>()

  const label = computed(() => {
    if (props.documentTitle) {
      return props.documentTitle.length > 20
        ? `${props.documentTitle.slice(0, 20)}…`
        : props.documentTitle
    }
    return `引用 ${props.index + 1}`
  })
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded border border-default bg-accented px-1.5 py-0.5 text-xs font-medium text-default transition-colors hover:border-primary hover:bg-primary/10 hover:ring-2 hover:ring-primary/20"
    :title="documentTitle || `引用 ${index + 1}`"
    @click="emit('click', citationId)"
  >
    <UIcon name="i-lucide-file-text" class="size-3 shrink-0" />
    <span class="truncate">{{ label }}</span>
  </button>
</template>
