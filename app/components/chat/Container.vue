<script setup lang="ts">
  import type { ChatMessage, ChatCitation } from '~/types/chat'

  /**
   * Main chat container integrating:
   * - Message history display
   * - Message input with submit
   * - Streaming response (simulated for MVP)
   * - Citation replay modal
   * - Error handling
   */

  interface ChatResponse {
    answer: string | null
    citations: ChatCitation[]
    refused: boolean
  }

  interface Props {
    /**
     * When true, the chat input becomes read-only and submission is
     * blocked on both the UI and handler sides.
     *
     * Wired by `app/pages/index.vue` signed-in branch via the
     * `GuestAccessGate` slot prop `canAsk`: Guest users under
     * `browse_only` policy keep access to message history but cannot
     * submit new questions.
     */
    disabled?: boolean
  }

  const props = withDefaults(defineProps<Props>(), { disabled: false })

  type ChatErrorKind = 'abort' | 'rate_limit' | 'network' | 'timeout' | 'unauthorized' | 'unknown'

  const messages = ref<ChatMessage[]>([])
  const isSubmitting = ref(false)
  const streamingContent = ref('')
  const isStreaming = ref(false)
  const streamingError = ref<string | null>(null)
  const submitError = ref<string | null>(null)
  const rateLimitRetryAt = ref<number | null>(null)
  const rateLimitCountdown = ref(0)

  // Citation modal state
  const selectedCitationId = ref<string | null>(null)
  const citationModalOpen = ref(false)

  const messagesContainer = ref<HTMLElement | null>(null)
  const messageInputRef = ref<{ focusAndClear: () => void } | null>(null)

  let activeController: AbortController | null = null
  let streamingCancelled = false
  const toast = useToast()

  function generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  function classifyError(error: unknown): ChatErrorKind {
    if (error instanceof DOMException && error.name === 'AbortError') return 'abort'
    if (error && typeof error === 'object') {
      if ('name' in error && (error as { name?: string }).name === 'AbortError') return 'abort'
      const statusCode =
        'statusCode' in error
          ? (error as { statusCode?: number }).statusCode
          : 'status' in error
            ? (error as { status?: number }).status
            : undefined
      if (statusCode === 429) return 'rate_limit'
      if (statusCode === 401) return 'unauthorized'
      if (statusCode === 504) return 'timeout'
      if (statusCode && statusCode >= 500 && statusCode < 600) return 'network'
    }
    if (error instanceof TypeError) return 'network'
    return 'unknown'
  }

  function extractRetryAfterSeconds(error: unknown): number {
    const fallback = 60
    if (!error || typeof error !== 'object') return fallback
    const container = error as {
      data?: { retryAfter?: number }
      response?: { headers?: Headers | Record<string, string | number | undefined> }
    }
    const payloadValue = container.data?.retryAfter
    if (typeof payloadValue === 'number' && Number.isFinite(payloadValue) && payloadValue > 0) {
      return Math.ceil(payloadValue)
    }
    const headers = container.response?.headers
    if (headers) {
      const raw =
        typeof (headers as Headers).get === 'function'
          ? (headers as Headers).get('retry-after')
          : (headers as Record<string, string | number | undefined>)['retry-after']
      const parsed = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
      if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed)
    }
    return fallback
  }

  function describeError(kind: ChatErrorKind, retryAfter: number): string {
    switch (kind) {
      case 'abort':
        return '已中斷回答'
      case 'rate_limit':
        return `請求過於頻繁，請於 ${retryAfter} 秒後重試`
      case 'unauthorized':
        return '登入已過期，請重新登入'
      case 'timeout':
        return '伺服器回應逾時，請稍後再試'
      case 'network':
        return '連線不穩或系統忙碌，請稍後再試'
      case 'unknown':
      default:
        return '發生錯誤，請稍後再試'
    }
  }

  function startRateLimitCountdown(retryAfter: number) {
    rateLimitRetryAt.value = Date.now() + retryAfter * 1000
    rateLimitCountdown.value = retryAfter
  }

  useIntervalFn(
    () => {
      if (rateLimitRetryAt.value === null) return
      const remainingMs = rateLimitRetryAt.value - Date.now()
      if (remainingMs <= 0) {
        rateLimitRetryAt.value = null
        rateLimitCountdown.value = 0
        return
      }
      rateLimitCountdown.value = Math.ceil(remainingMs / 1000)
    },
    1000,
    { immediate: true },
  )

  function handleStop() {
    if (!activeController) return
    streamingCancelled = true
    activeController.abort()
  }

  async function handleSubmit(query: string) {
    if (props.disabled) return
    if (isSubmitting.value || isStreaming.value) return
    if (rateLimitRetryAt.value !== null && Date.now() < rateLimitRetryAt.value) {
      toast.add({
        color: 'warning',
        icon: 'i-lucide-clock',
        title: `請於 ${rateLimitCountdown.value} 秒後重試`,
      })
      return
    }

    submitError.value = null

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: query,
      createdAt: new Date().toISOString(),
    }
    messages.value.push(userMessage)

    isSubmitting.value = true
    isStreaming.value = true
    streamingContent.value = ''
    streamingError.value = null
    streamingCancelled = false

    const controller = new AbortController()
    activeController = controller

    const { $csrfFetch } = useNuxtApp()

    try {
      const response = await $csrfFetch<{ data: ChatResponse }>('/api/chat', {
        method: 'POST',
        body: { query },
        signal: controller.signal,
      })

      const fullContent = response.data.answer ?? ''
      if (fullContent) {
        await simulateStreaming(fullContent)
      }

      const assistantMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: response.data.answer ?? '抱歉，我無法回答這個問題。',
        refused: response.data.refused,
        citations: response.data.refused ? undefined : response.data.citations,
        createdAt: new Date().toISOString(),
      }
      messages.value.push(assistantMessage)
    } catch (error) {
      const kind = classifyError(error)
      const retryAfter = kind === 'rate_limit' ? extractRetryAfterSeconds(error) : 0
      const errorMessage = describeError(kind, retryAfter)

      if (kind === 'rate_limit') {
        startRateLimitCountdown(retryAfter)
        toast.add({
          color: 'warning',
          icon: 'i-lucide-clock',
          title: errorMessage,
        })
      } else if (kind === 'abort') {
        toast.add({ color: 'neutral', icon: 'i-lucide-square', title: errorMessage })
      }

      if (kind === 'abort') {
        streamingError.value = null
        submitError.value = null
      } else {
        streamingError.value = errorMessage
        submitError.value = errorMessage
        const errorAssistantMessage: ChatMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: errorMessage,
          refused: true,
          createdAt: new Date().toISOString(),
        }
        messages.value.push(errorAssistantMessage)
      }
    } finally {
      isSubmitting.value = false
      isStreaming.value = false
      streamingContent.value = ''
      activeController = null
      streamingCancelled = false
      scrollToBottom()
    }
  }

  async function simulateStreaming(content: string) {
    const chunks = content.match(/.{1,10}/g) ?? [content]
    for (const chunk of chunks) {
      if (streamingCancelled) {
        throw new DOMException('aborted', 'AbortError')
      }
      streamingContent.value += chunk
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
  }

  function handleRetryFocus() {
    messageInputRef.value?.focusAndClear()
  }

  function handleSuggestionSubmit(query: string) {
    handleSubmit(query)
  }

  function handleCitationClick(citationId: string) {
    selectedCitationId.value = citationId
    citationModalOpen.value = true
  }

  function scrollToBottom() {
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      }
    })
  }

  // Scroll to bottom when messages change
  watch(
    () => messages.value.length,
    () => scrollToBottom(),
  )
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Messages area -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto p-4">
      <ChatMessageList
        :messages="messages"
        @citation-click="handleCitationClick"
        @submit-suggestion="handleSuggestionSubmit"
        @retry-focus="handleRetryFocus"
      />

      <!-- Streaming message -->
      <div v-if="isStreaming" class="mt-4">
        <LazyChatStreamingMessage
          :content="streamingContent"
          :is-streaming="true"
          :error="streamingError"
        />
      </div>
    </div>

    <!-- Error alert with retry action -->
    <div v-if="submitError && !isStreaming" class="px-4 pb-2">
      <UAlert color="error" variant="subtle" icon="i-lucide-alert-circle">
        <template #title>{{ submitError }}</template>
        <template #description>
          <span class="text-sm">如問題持續發生，請聯繫管理員。</span>
        </template>
        <template #actions>
          <UButton
            color="error"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            aria-label="關閉錯誤提示"
            @click="submitError = null"
          />
        </template>
      </UAlert>
    </div>

    <!-- Rate limit notice -->
    <div v-if="rateLimitCountdown > 0" class="px-4 pb-2">
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-clock"
        :title="`請求過於頻繁，請於 ${rateLimitCountdown} 秒後再試`"
      />
    </div>

    <!-- Input area -->
    <div class="border-t border-default p-4">
      <ChatMessageInput
        ref="messageInputRef"
        :disabled="props.disabled || isSubmitting || rateLimitCountdown > 0"
        :loading="isStreaming"
        :placeholder="
          props.disabled
            ? '訪客僅可瀏覽，無法提問'
            : rateLimitCountdown > 0
              ? `請於 ${rateLimitCountdown} 秒後再試`
              : '輸入您的問題...'
        "
        @submit="handleSubmit"
        @stop="handleStop"
      />
    </div>

    <!-- Citation replay modal -->
    <LazyChatCitationReplayModal
      v-model:open="citationModalOpen"
      :citation-id="selectedCitationId"
    />
  </div>
</template>
