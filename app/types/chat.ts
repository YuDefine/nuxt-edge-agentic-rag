/**
 * Chat message types for Web UI
 */

export type MessageRole = 'user' | 'assistant'

export interface ChatCitation {
  citationId: string
  sourceChunkId: string
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  refused?: boolean
  citations?: ChatCitation[]
  createdAt: string
}

export interface ChatConversationSummary {
  id: string
  title: string
  accessLevel: string
  createdAt: string
  updatedAt: string
  userProfileId: string | null
}

export interface ChatConversationMessage {
  id: string
  role: MessageRole
  contentRedacted: string
  contentText: string | null
  citationsJson: string
  /**
   * persist-refusal-and-label-new-chat: true when the assistant turn ended
   * in a refusal (audit-block, pipeline refusal, pipeline error). Sourced
   * from `messages.refused` so reload paths can render `RefusalMessage.vue`
   * without inspecting `contentText`.
   */
  refused: boolean
  createdAt: string
}

export interface ChatConversationDetail extends ChatConversationSummary {
  messages: ChatConversationMessage[]
}

export type ChatConversationLoadResult =
  | {
      status: 'found'
      detail: ChatConversationDetail
    }
  | {
      status: 'missing'
    }
  | {
      status: 'error'
    }
