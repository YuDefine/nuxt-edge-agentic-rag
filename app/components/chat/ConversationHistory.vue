<script setup lang="ts">
  /**
   * Conversation history list component.
   * In v1.0.0 MVP, conversations are not persisted - this shows the current session only.
   * Future versions will integrate with the conversations table.
   */
  interface Props {
    currentSessionId?: string
  }

  defineProps<Props>()
</script>

<template>
  <div class="flex flex-col gap-2 p-4">
    <h2 class="text-sm font-medium text-muted">對話記錄</h2>

    <div class="flex flex-col gap-1">
      <div
        class="cursor-pointer rounded-lg border border-primary bg-primary-50 p-3 dark:bg-primary-950"
      >
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-message-square" class="size-4 text-primary" />
          <span class="text-sm font-medium text-default">目前對話</span>
        </div>
      </div>
    </div>

    <p class="mt-2 text-xs text-muted">v1.0 僅支援當前對話。歷史記錄將在未來版本提供。</p>
  </div>
</template>
