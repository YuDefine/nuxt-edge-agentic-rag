import type { ChatConversationDetail, ChatConversationMessage, ChatMessage } from '~/types/chat'

const UNAVAILABLE_MESSAGE_PLACEHOLDER = '此訊息因治理規則無法顯示原文。'

export function buildChatRequestBody(
  query: string,
  conversationId?: string | null,
): {
  query: string
  conversationId?: string
} {
  if (!conversationId) {
    return { query }
  }

  return {
    query,
    conversationId,
  }
}

export function buildConversationSessionStorageKey(userId: string): string {
  return `web-chat:active-conversation:${userId}`
}

export function clearConversationSessionStorage(
  userId: string | null,
  storage: Pick<Storage, 'removeItem'> | null,
): void {
  if (!userId || !storage) {
    return
  }

  try {
    storage.removeItem(buildConversationSessionStorageKey(userId))
  } catch {
    // sessionStorage may throw in Safari private mode (QuotaExceededError) or
    // when DOM Storage is disabled. The reset still proceeded in component
    // state, so we swallow the error rather than surfacing a toast.
  }
}

export function resolvePreferredConversationId(input: {
  currentConversationId?: string | null
  storedConversationId?: string | null
  visibleConversationIds: string[]
}): string | null {
  const {
    currentConversationId = null,
    storedConversationId = null,
    visibleConversationIds,
  } = input
  const visibleIds = new Set(visibleConversationIds)

  if (currentConversationId && visibleIds.has(currentConversationId)) {
    return currentConversationId
  }

  if (storedConversationId && visibleIds.has(storedConversationId)) {
    return storedConversationId
  }

  return visibleConversationIds[0] ?? null
}

export function mapConversationDetailToChatMessages(detail: ChatConversationDetail): ChatMessage[] {
  return detail.messages.map((message) => {
    const citations = parseConversationCitations(message.citationsJson)

    return {
      id: message.id,
      role: message.role,
      content: getConversationMessageContent(message),
      ...(citations.length > 0 ? { citations } : {}),
      createdAt: message.createdAt,
    }
  })
}

function getConversationMessageContent(message: ChatConversationMessage): string {
  return message.contentText ?? UNAVAILABLE_MESSAGE_PLACEHOLDER
}

function parseConversationCitations(
  citationsJson: string,
): Array<{ citationId: string; sourceChunkId: string }> {
  try {
    const parsed = JSON.parse(citationsJson) as Array<{
      citationId?: unknown
      sourceChunkId?: unknown
    }>

    return parsed.flatMap((item) => {
      if (typeof item?.citationId !== 'string' || typeof item?.sourceChunkId !== 'string') {
        return []
      }

      return [
        {
          citationId: item.citationId,
          sourceChunkId: item.sourceChunkId,
        },
      ]
    })
  } catch {
    return []
  }
}
