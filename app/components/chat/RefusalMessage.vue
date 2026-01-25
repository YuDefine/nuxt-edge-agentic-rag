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
  <div class="rounded-lg border border-default bg-muted px-4 py-3">
    <div class="mb-2 flex items-center gap-2">
      <UIcon name="i-lucide-circle-slash" class="size-4 text-muted" />
      <span class="text-xs font-medium text-muted">助理</span>
      <UBadge color="neutral" variant="subtle" size="xs">無法回答</UBadge>
    </div>

    <div class="text-sm whitespace-pre-wrap text-default">
      {{ content }}
    </div>

    <div class="mt-3 rounded-md bg-accented p-3">
      <p class="text-xs text-muted">
        <UIcon name="i-lucide-lightbulb" class="mr-1 inline size-3" />
        請嘗試用不同方式重新描述您的問題，或詢問其他相關主題。
      </p>
    </div>

    <div class="mt-2 text-xs text-dimmed">
      {{ new Date(createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }}
    </div>
  </div>
</template>
