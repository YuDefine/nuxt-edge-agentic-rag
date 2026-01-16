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
