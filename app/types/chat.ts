/**
 * Chat message types for Web UI
 */

import type { RefusalReason } from '#shared/types/observability'

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
  /**
   * persist-refusal-and-label-new-chat: specific reason for the refusal
   * turn. Sourced from the live SSE `refusal` event reason (see
   * `app/utils/chat-stream.ts`) or from `messages.refusal_reason` on
   * conversation reload. `null` / `undefined` for user, accepted, and
   * unknown-reason rows; `RefusalMessage.vue` falls back to generic copy
   * when missing.
   */
  refusalReason?: RefusalReason | null
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
  /**
   * persist-refusal-and-label-new-chat: specific RefusalReason for the
   * refusal turn. Sourced from `messages.refusal_reason`. `null` for user,
   * system, and accepted-assistant rows.
   */
  refusalReason: RefusalReason | null
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
