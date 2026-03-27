<script setup lang="ts">
  type StreamingState = 'idle' | 'waiting' | 'streaming' | 'complete' | 'error'

  interface Props {
    content: string
    isStreaming: boolean
    error?: string | null
  }

  const props = withDefaults(defineProps<Props>(), {
    error: null,
  })

  const messageContainer = ref<HTMLElement | null>(null)

  function determineStreamingState(message: {
    content: string
    isStreaming: boolean
    hasError: boolean
  }): StreamingState {
    if (message.hasError) {
      return 'error'
    }
    if (message.isStreaming && message.content.length === 0) {
      return 'waiting'
    }
    if (message.isStreaming && message.content.length > 0) {
      return 'streaming'
    }
    if (!message.isStreaming && message.content.length > 0) {
      return 'complete'
    }
    return 'idle'
  }

  const streamingState = computed<StreamingState>(() =>
    determineStreamingState({
      content: props.content,
      isStreaming: props.isStreaming,
      hasError: !!props.error,
    }),
  )

  const showLoader = computed(() => streamingState.value === 'waiting')

  const showContent = computed(
    () =>
      streamingState.value === 'streaming' ||
      streamingState.value === 'complete' ||
      streamingState.value === 'error',
  )

  const showCursor = computed(() => streamingState.value === 'streaming')

  // Auto-scroll to bottom when content updates during streaming
  watch(
    () => props.content,
    () => {
      if (props.isStreaming && messageContainer.value) {
        nextTick(() => {
          messageContainer.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
        })
      }
    },
  )
</script>

<template>
  <div ref="messageContainer" class="rounded-lg border border-default bg-muted px-4 py-3">
    <div class="mb-1 flex items-center gap-2">
      <span class="text-xs font-medium text-muted">助理</span>
      <UBadge v-if="streamingState === 'streaming'" color="neutral" variant="subtle" size="xs">
        回答中
      </UBadge>
    </div>

    <!-- Waiting state: show loader -->
    <div v-if="showLoader" class="flex items-center gap-2 py-2">
      <UIcon
        name="i-lucide-loader-2"
        class="size-4 animate-spin text-muted motion-reduce:animate-none"
      />
      <span class="text-sm text-muted">正在思考...</span>
    </div>

    <!-- Content display -->
    <div v-if="showContent" class="text-sm whitespace-pre-wrap text-default">
      {{ content
      }}<span v-if="showCursor" class="inline-block h-4 w-0.5 animate-pulse bg-inverted" />
    </div>

    <!-- Error state -->
    <UAlert
      v-if="streamingState === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-alert-circle"
      :title="error || '回答過程發生錯誤，請重試'"
      class="mt-2"
    />
  </div>
</template>
