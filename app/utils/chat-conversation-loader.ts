import type { ChatConversationDetail, ChatConversationLoadResult } from '~/types/chat'

interface FetchErrorLike {
  status?: number
  statusCode?: number
}

function getErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const candidate = error as FetchErrorLike

  if (typeof candidate.statusCode === 'number') {
    return candidate.statusCode
  }

  if (typeof candidate.status === 'number') {
    return candidate.status
  }

  return null
}

export async function loadChatConversationDetail(
  $csrfFetch: typeof $fetch,
  conversationId: string,
): Promise<ChatConversationLoadResult> {
  try {
    const response = await $csrfFetch<{ data: ChatConversationDetail }>(
      `/api/conversations/${conversationId}`,
    )

    return {
      status: 'found',
      detail: response.data,
    }
  } catch (error) {
    if (getErrorStatusCode(error) === 404) {
      return { status: 'missing' }
    }

    return { status: 'error' }
  }
}
