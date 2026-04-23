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
