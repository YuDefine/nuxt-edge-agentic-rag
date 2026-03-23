<script setup lang="ts">
  import type { ChatMessage, MessageRole } from '~/types/chat'
  import { assertNever } from '~~/shared/utils/assert-never'

  interface Props {
    messages: ChatMessage[]
  }

  defineProps<Props>()

  const emit = defineEmits<{
    citationClick: [citationId: string]
    submitSuggestion: [query: string]
    retryFocus: []
  }>()

  // 示例問題，讓使用者快速開始
  const suggestionQueries = ['公司請假流程是什麼？', '如何申請報帳？', '專案管理的最佳實踐有哪些？']

  function getMessageRoleConfig(role: MessageRole): {
    alignment: 'left' | 'right'
    bgClass: string
    label: string
  } {
    switch (role) {
      case 'user':
        return {
          alignment: 'right',
          bgClass: 'bg-accented',
          label: '您',
        }
      case 'assistant':
        return {
          alignment: 'left',
          bgClass: 'bg-muted',
          label: '助理',
        }
      default:
        return assertNever(role, 'getMessageRoleConfig')
    }
  }

  function handleSuggestionClick(query: string) {
    emit('submitSuggestion', query)
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
      <LazyChatRefusalMessage
        v-if="isRefusalMessage(message)"
        :content="message.content"
        :created-at="message.createdAt"
        class="max-w-[85%] sm:max-w-2xl"
        @retry-focus="emit('retryFocus')"
      />

      <!-- Regular messages (user or successful assistant) -->
      <!-- responsive-and-a11y-foundation §5.2 —
           < md: tighter padding (px-3 py-2) so bubble keeps breathing room in
           narrow viewports; >= md: restore original px-4 py-3.
           Max-width stays 85% on mobile and 2xl on sm+. -->
      <div
        v-else
        class="max-w-[85%] rounded-lg border border-default px-3 py-2 sm:max-w-2xl md:px-4 md:py-3"
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

        <!-- responsive-and-a11y-foundation §5.2 —
             Citation markers become a horizontal scroll strip < md so they
             never push the bubble past viewport; wraps normally >= md. -->
        <div
          v-if="hasCitations(message)"
          class="mt-2 flex gap-1 overflow-x-auto whitespace-nowrap md:flex-wrap md:overflow-visible md:whitespace-normal"
        >
          <LazyChatCitationMarker
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

    <!-- Empty state with onboarding -->
    <div v-if="messages.length === 0" class="flex h-full flex-col items-center justify-center py-8">
      <div class="w-full max-w-md space-y-6 text-center">
        <!-- Welcome -->
        <div>
          <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <UIcon name="i-lucide-sparkles" class="size-8 text-default" />
          </div>
          <h2 class="text-xl font-semibold text-default">開始探索知識庫</h2>
          <p class="mt-2 text-sm text-muted">
            輸入問題或點擊下方示例，我會從知識庫中找到最相關的答案。
          </p>
        </div>

        <!-- Suggestion queries -->
        <div class="space-y-2">
          <p class="text-xs font-medium text-dimmed">試試這些問題</p>
          <div class="flex flex-col gap-2">
            <button
              v-for="query in suggestionQueries"
              :key="query"
              type="button"
              class="w-full rounded-lg border border-default bg-elevated px-4 py-3 text-left text-sm text-default transition-colors hover:bg-accented"
              @click="handleSuggestionClick(query)"
            >
              <span class="flex items-center gap-2">
                <UIcon name="i-lucide-message-circle" class="size-4 text-muted" />
                {{ query }}
              </span>
            </button>
          </div>
        </div>

        <!-- Tips -->
        <p class="text-xs text-dimmed">回答會標註引用來源，點擊可查看原文</p>
      </div>
    </div>
  </div>
</template>
