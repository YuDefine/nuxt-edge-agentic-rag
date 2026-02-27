<script setup lang="ts">
  /**
   * Clickable citation marker that triggers citation replay.
   * Emits hover events so MessageList can highlight the paired citation card.
   */
  interface Props {
    citationId: string
    index: number
    isHovered?: boolean
  }

  withDefaults(defineProps<Props>(), { isHovered: false })

  const emit = defineEmits<{
    click: [citationId: string]
    hover: [citationId: string | null]
  }>()
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium transition-colors"
    :class="
      isHovered
        ? 'border-primary bg-primary/10 text-default ring-2 ring-primary/20'
        : 'border-default bg-accented text-default hover:bg-muted'
    "
    @click="emit('click', citationId)"
    @mouseenter="emit('hover', citationId)"
    @mouseleave="emit('hover', null)"
  >
    <UIcon name="i-lucide-file-text" class="size-3" />
    <span>引用 {{ index + 1 }}</span>
  </button>
</template>
