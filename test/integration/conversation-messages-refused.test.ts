import { describe, expect, it } from 'vitest'

import { createConversationStore } from '#server/utils/conversation-store'

/**
 * Capability under test: conversation-lifecycle-governance — Persisted
 * Refusal Flag On Messages, and web-chat-ui — Restored Refusal UI On
 * Conversation Reload (API contract slice).
 *
 * The conversation store SELECT MUST include the `messages.refused`
 * column and surface it as a boolean on `ConversationMessageSummary`.
 * Reload paths in `app/utils/chat-conversation-state.ts` rely on this
 * boolean to render `RefusalMessage.vue` without inspecting `contentText`.
 */

interface ConversationRow {
  id: string
  user_profile_id: string | null
  access_level: string
  title: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content_redacted: string
  content_text: string | null
  citations_json: string
  refused: number
  refusal_reason: string | null
  created_at: string
}

function createFakeDatabase(input: { conversations: ConversationRow[]; messages: MessageRow[] }) {
  const { conversations, messages } = input

  return {
    async batch() {
      return [] as unknown[]
    },
    prepare(query: string) {
      if (query.includes('FROM conversations') && query.includes('WHERE id = ?')) {
        return {
          bind(conversationId: string, userProfileId: string) {
            return {
              async first<T>() {
                const match = conversations.find(
                  (c) =>
                    c.id === conversationId &&
                    c.user_profile_id === userProfileId &&
                    c.deleted_at === null,
                )
                if (!match) return null
                return {
                  id: match.id,
                  user_profile_id: match.user_profile_id,
                  access_level: match.access_level,
                  title: match.title,
                  created_at: match.created_at,
                  updated_at: match.updated_at,
                } as unknown as T
              },
              async all<T>() {
                return { results: [] as unknown as T[] }
              },
              async run() {
                return undefined
              },
            }
          },
        }
      }

      if (query.includes('FROM messages') && query.includes('conversation_id = ?')) {
        // Be strict: reload-path SELECT MUST include `refused` AND the
        // `refusal_reason` column so reason-specific RefusalMessage copy
        // can render on reload.
        if (!query.includes('refused')) {
          throw new Error('messages SELECT must include the refused column')
        }
        if (!query.includes('refusal_reason')) {
          throw new Error('messages SELECT must include the refusal_reason column')
        }
        return {
          bind(conversationId: string) {
            return {
              async all<T>() {
                const results = messages
                  .filter((m) => m.conversation_id === conversationId)
                  .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
                return { results: results as unknown as T[] }
              },
              async first<T>() {
                return null as unknown as T
              },
              async run() {
                return undefined
              },
            }
          },
        }
      }

      throw new Error(`unexpected query: ${query}`)
    },
  }
}

describe('conversation store — exposes messages.refused on reload', () => {
  it('returns refused: true for refusal assistant rows and refused: false for accepted rows', async () => {
    const conversation: ConversationRow = {
      id: 'conv-1',
      user_profile_id: 'user-1',
      access_level: 'internal',
      title: 'mixed conversation',
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T10:05:00.000Z',
      deleted_at: null,
    }

    const userMsg: MessageRow = {
      id: 'msg-user',
      conversation_id: 'conv-1',
      role: 'user',
      content_redacted: 'why X',
      content_text: 'why X',
      citations_json: '[]',
      refused: 0,
      refusal_reason: null,
      created_at: '2026-04-25T10:00:00.000Z',
    }
    const refusalMsg: MessageRow = {
      id: 'msg-refusal',
      conversation_id: 'conv-1',
      role: 'assistant',
      content_redacted: '抱歉，我無法回答這個問題。',
      content_text: '抱歉，我無法回答這個問題。',
      citations_json: '[]',
      refused: 1,
      refusal_reason: 'restricted_scope',
      created_at: '2026-04-25T10:00:01.000Z',
    }
    const acceptedMsg: MessageRow = {
      id: 'msg-accepted',
      conversation_id: 'conv-1',
      role: 'assistant',
      content_redacted: 'Y because Z.',
      content_text: 'Y because Z.',
      citations_json: '[{"documentVersionId":"ver-z"}]',
      refused: 0,
      refusal_reason: null,
      created_at: '2026-04-25T10:05:00.000Z',
    }

    const store = createConversationStore(
      createFakeDatabase({
        conversations: [conversation],
        messages: [userMsg, refusalMsg, acceptedMsg],
      }) as Parameters<typeof createConversationStore>[0],
    )

    const detail = await store.getForUser({
      conversationId: 'conv-1',
      userProfileId: 'user-1',
    })

    expect(detail).not.toBeNull()
    expect(detail!.messages).toHaveLength(3)

    const byId = new Map(detail!.messages.map((m) => [m.id, m]))
    expect(byId.get('msg-user')?.refused).toBe(false)
    expect(byId.get('msg-user')?.refusalReason).toBeNull()
    expect(byId.get('msg-refusal')?.refused).toBe(true)
    expect(byId.get('msg-refusal')?.refusalReason).toBe('restricted_scope')
    expect(byId.get('msg-accepted')?.refused).toBe(false)
    expect(byId.get('msg-accepted')?.refusalReason).toBeNull()
  })

  it('coerces null/undefined refused (legacy rows) to false', async () => {
    const legacyMessage = {
      id: 'msg-legacy',
      conversation_id: 'conv-1',
      role: 'assistant' as const,
      content_redacted: 'pre-migration body',
      content_text: 'pre-migration body',
      citations_json: '[]',
      // refused / refusal_reason absent: simulates a row written before
      // migrations 0013 / 0014.
      refused: 0,
      refusal_reason: null,
      created_at: '2026-04-20T00:00:00.000Z',
    }

    const conversation: ConversationRow = {
      id: 'conv-1',
      user_profile_id: 'user-1',
      access_level: 'internal',
      title: 'legacy',
      created_at: '2026-04-20T00:00:00.000Z',
      updated_at: '2026-04-20T00:01:00.000Z',
      deleted_at: null,
    }

    const store = createConversationStore(
      createFakeDatabase({
        conversations: [conversation],
        messages: [legacyMessage],
      }) as Parameters<typeof createConversationStore>[0],
    )

    const detail = await store.getForUser({
      conversationId: 'conv-1',
      userProfileId: 'user-1',
    })

    expect(detail!.messages[0]?.refused).toBe(false)
  })
})
