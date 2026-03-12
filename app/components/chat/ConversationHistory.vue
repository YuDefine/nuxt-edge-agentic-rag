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
  <!-- responsive-and-a11y-foundation §5.3 — drawer-ready internal layout.
       Uses min-h-0 + overflow-y-auto so the component works when Phase B
       wires it into a `< md` USlideover (drawer content can scroll). Also
       keeps the same layout when rendered as a sidebar `>= lg`. -->
  <div class="flex h-full min-h-0 flex-col p-4">
    <h2 class="mb-3 text-xs font-semibold tracking-wider text-dimmed uppercase">對話記錄</h2>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="rounded-lg border-2 border-default bg-accented p-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-message-square" class="size-4 text-default" />
          <span class="text-sm font-medium text-default">目前對話</span>
        </div>
      </div>
    </div>

    <p class="mt-4 text-xs text-dimmed">歷史記錄將在未來版本提供</p>
  </div>
</template>
