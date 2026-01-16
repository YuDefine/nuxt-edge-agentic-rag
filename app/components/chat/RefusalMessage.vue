<script setup lang="ts">
  /**
   * Dedicated refusal message component with distinct styling.
   * Used when the assistant refuses to answer a question.
   * Must be visually distinct from successful answers - no citations shown.
   */
  interface Props {
    content: string
    createdAt: string
  }

  defineProps<Props>()
</script>

<template>
  <div class="rounded-lg border-2 border-warning bg-warning-50 px-4 py-3 dark:bg-warning-950">
    <div class="mb-2 flex items-center gap-2">
      <UIcon name="i-lucide-shield-alert" class="size-4 text-warning" />
      <span class="text-xs font-medium text-muted">助理</span>
      <UBadge color="warning" variant="subtle" size="xs"> 無法回答 </UBadge>
    </div>

    <div class="text-sm whitespace-pre-wrap text-default">
      {{ content }}
    </div>

    <div class="mt-3 rounded bg-warning-100 p-2 dark:bg-warning-900">
      <p class="text-xs text-muted">此問題因安全或內容政策原因無法回答。請嘗試重新表述您的問題。</p>
    </div>

    <div class="mt-2 text-xs text-muted">
      {{ new Date(createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }}
    </div>
  </div>
</template>
