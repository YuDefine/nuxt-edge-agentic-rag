<script setup lang="ts">
  import type { ChatMessage, MessageRole } from '~/types/chat'
  import { assertNever } from '~/utils/assert-never'

  interface Props {
    messages: ChatMessage[]
  }

  defineProps<Props>()

  const emit = defineEmits<{
    citationClick: [citationId: string]
  }>()

  function getMessageRoleConfig(role: MessageRole): {
    alignment: 'left' | 'right'
    bgClass: string
    label: string
  } {
    switch (role) {
      case 'user':
        return {
          alignment: 'right',
          bgClass: 'bg-primary-50 dark:bg-primary-950',
          label: '您',
        }
      case 'assistant':
        return {
          alignment: 'left',
          bgClass: 'bg-neutral-50 dark:bg-neutral-900',
          label: '助理',
        }
      default:
        return assertNever(role, 'getMessageRoleConfig')
    }
  }

  function isRefusalMessage(message: ChatMessage): boolean {
    return message.role === 'assistant' && message.refused === true
  }

  function hasCitations(message: ChatMessage): boolean {
    return (
      message.role === 'assistant' &&
      !message.refused &&
      Array.isArray(message.citations) &&
      message.citations.length > 0
    )
  }

  function handleCitationClick(citationId: string) {
    emit('citationClick', citationId)
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-for="message in messages"
      :key="message.id"
      class="flex"
      :class="{
        'justify-end': getMessageRoleConfig(message.role).alignment === 'right',
        'justify-start': getMessageRoleConfig(message.role).alignment === 'left',
      }"
    >
      <!-- Refusal messages use dedicated component -->
      <ChatRefusalMessage
        v-if="isRefusalMessage(message)"
        :content="message.content"
        :created-at="message.createdAt"
        class="max-w-[80%]"
      />

      <!-- Regular messages (user or successful assistant) -->
      <div
        v-else
        class="max-w-[80%] rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800"
        :class="getMessageRoleConfig(message.role).bgClass"
      >
        <div class="mb-1 flex items-center gap-2">
          <span class="text-xs font-medium text-muted">
            {{ getMessageRoleConfig(message.role).label }}
          </span>
        </div>

        <div class="text-sm whitespace-pre-wrap text-default">
          {{ message.content }}
        </div>

        <div v-if="hasCitations(message)" class="mt-2 flex flex-wrap gap-1">
          <ChatCitationMarker
            v-for="(citation, index) in message.citations"
            :key="citation.citationId"
            :citation-id="citation.citationId"
            :index="index"
            @click="handleCitationClick"
          />
        </div>

        <div class="mt-2 text-xs text-muted">
          {{
            new Date(message.createdAt).toLocaleTimeString('zh-TW', {
              hour: '2-digit',
              minute: '2-digit',
            })
          }}
        </div>
      </div>
    </div>

    <div
      v-if="messages.length === 0"
      class="flex flex-col items-center justify-center py-12 text-center"
    >
      <UIcon name="i-lucide-message-square" class="mb-4 size-12 text-muted" />
      <p class="text-sm text-muted">尚無訊息。開始提問吧！</p>
    </div>
  </div>
</template>
