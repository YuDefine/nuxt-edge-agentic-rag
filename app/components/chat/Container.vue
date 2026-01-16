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

  const messages = ref<ChatMessage[]>([])
  const isSubmitting = ref(false)
  const streamingContent = ref('')
  const isStreaming = ref(false)
  const streamingError = ref<string | null>(null)
  const submitError = ref<string | null>(null)

  // Citation modal state
  const selectedCitationId = ref<string | null>(null)
  const citationModalOpen = ref(false)

  const messagesContainer = ref<HTMLElement | null>(null)

  function generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  async function handleSubmit(query: string) {
    if (isSubmitting.value || isStreaming.value) return

    submitError.value = null

    // Add user message
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: query,
      createdAt: new Date().toISOString(),
    }
    messages.value.push(userMessage)

    // Start streaming state
    isSubmitting.value = true
    isStreaming.value = true
    streamingContent.value = ''
    streamingError.value = null

    try {
      const response = await $fetch<{ data: ChatResponse }>('/api/chat', {
        method: 'POST',
        body: { query },
      })

      // Simulate streaming effect for better UX
      const fullContent = response.data.answer ?? ''
      if (fullContent) {
        await simulateStreaming(fullContent)
      }

      // Add assistant message
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
      const errorMessage = getErrorMessage(error)
      streamingError.value = errorMessage
      submitError.value = errorMessage

      // Add error message as assistant refusal
      const errorAssistantMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: errorMessage,
        refused: true,
        createdAt: new Date().toISOString(),
      }
      messages.value.push(errorAssistantMessage)
    } finally {
      isSubmitting.value = false
      isStreaming.value = false
      streamingContent.value = ''
      scrollToBottom()
    }
  }

  async function simulateStreaming(content: string) {
    // Simulate token-by-token streaming for better UX
    const chunks = content.match(/.{1,10}/g) ?? [content]
    for (const chunk of chunks) {
      streamingContent.value += chunk
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
  }

  function getErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const statusCode = (error as { statusCode: number }).statusCode
      if (statusCode === 429) {
        return '請求過於頻繁，請稍後再試'
      }
      if (statusCode === 401) {
        return '請先登入後再提問'
      }
    }
    if (error instanceof Error) {
      return error.message
    }
    return '發生未知錯誤，請稍後再試'
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
    () => scrollToBottom()
  )
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Messages area -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto p-4">
      <ChatMessageList :messages="messages" @citation-click="handleCitationClick" />

      <!-- Streaming message -->
      <div v-if="isStreaming" class="mt-4">
        <ChatStreamingMessage
          :content="streamingContent"
          :is-streaming="true"
          :error="streamingError"
        />
      </div>
    </div>

    <!-- Error alert -->
    <div v-if="submitError && !isStreaming" class="px-4">
      <UAlert
        color="error"
        variant="subtle"
        :title="submitError"
        :close-button="{ icon: 'i-lucide-x', color: 'error', variant: 'link' }"
        @close="submitError = null"
      />
    </div>

    <!-- Input area -->
    <div class="border-t border-neutral-200 p-4 dark:border-neutral-800">
      <ChatMessageInput
        :disabled="isSubmitting"
        :loading="isStreaming"
        placeholder="輸入您的問題..."
        @submit="handleSubmit"
      />
    </div>

    <!-- Citation replay modal -->
    <ChatCitationReplayModal v-model:open="citationModalOpen" :citation-id="selectedCitationId" />
  </div>
</template>
