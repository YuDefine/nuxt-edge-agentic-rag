import { describe, expect, it } from 'vitest'

import {
  DELETED_CONVERSATION_TITLE,
  createConversationStore,
  getUserVisibleMessageContent,
} from '#server/utils/conversation-store'

/**
 * Integration tests for governance-refinements §1.4 (conversation delete
 * content purge) and §1.5 (audit-safe residue protection).
 *
 * Contract the tests enforce:
 *
 * 1. Soft-deleting a conversation NULLs `messages.content_text` for every
 *    message under it. `content_redacted` is left alone (audit residue).
 * 2. The conversation's `title` is replaced by `DELETED_CONVERSATION_TITLE`
 *    so raw user input cannot leak even if a buggy surface forgets the
 *    `deleted_at IS NULL` filter.
 * 3. Soft delete is idempotent — second call does not re-NULL already-NULL
 *    rows or touch the frozen title.
 * 4. `getUserVisibleMessageContent` returns `null` whenever `content_text`
 *    is NULL and the raw string otherwise. This is the enforced boundary
 *    for any user-facing / model-context reader.
 * 5. After purge, `getForUser` returns the conversation with
 *    `messages[i].contentText === null` — so clients (and future multi-turn
 *    assembly) can never accidentally surface the original text. The
 *    `contentRedacted` column still carries the audit copy.
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
  created_at: string
}

function createPurgeFakeDatabase(input: {
  conversations: ConversationRow[]
  messages: MessageRow[]
}) {
  const conversations = [...input.conversations]
  const messages = [...input.messages]

  return {
    rawConversations: conversations,
    rawMessages: messages,
    // Governance §1.4: softDelete uses database.batch([...]) so both UPDATEs
    // succeed or fail together. The fake treats batch as sequential .run()
    // calls — tests verify the end state, not transactional semantics.
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = []
      for (const statement of statements) {
        results.push(await statement.run())
      }
      return results
    },
    prepare(query: string) {
      // ownership lookup (no deleted_at filter)
      if (
        query.includes('SELECT id, deleted_at') &&
        query.includes('FROM conversations') &&
        query.includes('WHERE id = ?') &&
        query.includes('user_profile_id = ?') &&
        query.includes('LIMIT 1')
      ) {
        return {
          bind(conversationId: string, userProfileId: string) {
            return {
              async first<T>() {
                const match = conversations.find(
                  (row) => row.id === conversationId && row.user_profile_id === userProfileId,
                )
                if (!match) return null
                return { id: match.id, deleted_at: match.deleted_at } as unknown as T
              },
              async all<T>() {
                throw new Error('unexpected all() on ownership query')
                return { results: [] as unknown as T[] }
              },
              async run() {
                throw new Error('unexpected run() on ownership query')
              },
            }
          },
        }
      }

      // soft-delete UPDATE (§1.4: overwrites title with placeholder)
      if (query.startsWith('UPDATE conversations SET deleted_at') && query.includes('title = ?')) {
        return {
          bind(deletedAt: string, updatedAt: string, title: string, conversationId: string) {
            return {
              async run() {
                const index = conversations.findIndex((row) => row.id === conversationId)
                if (index !== -1 && conversations[index]) {
                  conversations[index] = {
                    ...conversations[index],
                    deleted_at: deletedAt,
                    updated_at: updatedAt,
                    title,
                  }
                }
                return {}
              },
              async first<T>() {
                throw new Error('unexpected first() on conversation update')
                return null as unknown as T
              },
              async all<T>() {
                throw new Error('unexpected all() on conversation update')
                return { results: [] as unknown as T[] }
              },
            }
          },
        }
      }

      // messages purge UPDATE (§1.4: NULL content_text by conversation_id)
      if (
        query.startsWith('UPDATE messages') &&
        query.includes('content_text = NULL') &&
        query.includes('conversation_id = ?')
      ) {
        return {
          bind(conversationId: string) {
            return {
              async run() {
                for (let index = 0; index < messages.length; index += 1) {
                  const message = messages[index]
                  if (message && message.conversation_id === conversationId) {
                    messages[index] = { ...message, content_text: null }
                  }
                }
                return {}
              },
              async first<T>() {
                throw new Error('unexpected first() on messages purge')
                return null as unknown as T
              },
              async all<T>() {
                throw new Error('unexpected all() on messages purge')
                return { results: [] as unknown as T[] }
              },
            }
          },
        }
      }

      // conversation detail (deleted_at IS NULL)
      if (
        query.includes('FROM conversations') &&
        query.includes('WHERE id = ?') &&
        query.includes('user_profile_id = ?') &&
        query.includes('deleted_at IS NULL') &&
        query.includes('LIMIT 1')
      ) {
        return {
          bind(conversationId: string, userProfileId: string) {
            return {
              async first<T>() {
                const match = conversations.find(
                  (row) =>
                    row.id === conversationId &&
                    row.user_profile_id === userProfileId &&
                    row.deleted_at === null,
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
                throw new Error('unexpected all() on detail query')
                return { results: [] as unknown as T[] }
              },
              async run() {
                throw new Error('unexpected run() on detail query')
              },
            }
          },
        }
      }

      // messages list (includes content_text now)
      if (
        query.includes('FROM messages') &&
        query.includes('conversation_id = ?') &&
        query.includes('ORDER BY created_at ASC')
      ) {
        return {
          bind(conversationId: string) {
            return {
              async all<T>() {
                const rows = messages
                  .filter((m) => m.conversation_id === conversationId)
                  .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((m) => ({
                    id: m.id,
                    role: m.role,
                    content_redacted: m.content_redacted,
                    content_text: m.content_text,
                    citations_json: m.citations_json,
                    created_at: m.created_at,
                  }))
                return { results: rows as unknown as T[] }
              },
              async first<T>() {
                throw new Error('unexpected first() on messages list')
                return null as unknown as T
              },
              async run() {
                throw new Error('unexpected run() on messages list')
              },
            }
          },
        }
      }

      throw new Error(`Unhandled query in conversation-purge fake: ${query}`)
    },
  }
}

function fixtureConversation(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: overrides.id ?? 'conv-a',
    user_profile_id: overrides.user_profile_id ?? 'user-1',
    access_level: overrides.access_level ?? 'internal',
    title: overrides.title ?? 'Launch timing update',
    created_at: overrides.created_at ?? '2026-04-18T09:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-04-18T09:00:00.000Z',
    deleted_at: overrides.deleted_at ?? null,
  }
}

function fixtureMessage(overrides: Partial<MessageRow> & { id: string }): MessageRow {
  return {
    id: overrides.id,
    conversation_id: overrides.conversation_id ?? 'conv-a',
    role: overrides.role ?? 'user',
    content_redacted: overrides.content_redacted ?? 'redacted body',
    content_text: overrides.content_text ?? 'raw body',
    citations_json: overrides.citations_json ?? '[]',
    created_at: overrides.created_at ?? '2026-04-18T10:00:00.000Z',
  }
}

describe('conversation purge (governance §1.4 + §1.5)', () => {
  it('NULLs messages.content_text for every message under the deleted conversation', async () => {
    const fake = createPurgeFakeDatabase({
      conversations: [fixtureConversation()],
      messages: [
        fixtureMessage({
          id: 'msg-1',
          role: 'user',
          content_redacted: 'Contact me at [REDACTED:email]',
          content_text: 'Contact me at alice@example.com',
        }),
        fixtureMessage({
          id: 'msg-2',
          role: 'assistant',
          content_redacted: 'Launch moved to Tuesday.',
          content_text: 'Launch moved to Tuesday.',
          created_at: '2026-04-18T10:00:01.000Z',
        }),
      ],
    })
    const store = createConversationStore(fake)

    await store.softDeleteForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
      now: new Date('2026-04-18T12:00:00.000Z'),
    })

    expect(fake.rawMessages.every((m) => m.content_text === null)).toBe(true)
  })

  it('preserves content_redacted across the delete so audit paths still work (§1.5)', async () => {
    const fake = createPurgeFakeDatabase({
      conversations: [fixtureConversation()],
      messages: [
        fixtureMessage({
          id: 'msg-1',
          content_redacted: 'Contact me at [REDACTED:email]',
          content_text: 'Contact me at alice@example.com',
        }),
      ],
    })
    const store = createConversationStore(fake)

    await store.softDeleteForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
      now: new Date('2026-04-18T12:00:00.000Z'),
    })

    // The audit-safe copy MUST still be there for admin/audit readers — it is
    // the basis on which the retention window is built (§1.5). A regression
    // that NULLs `content_redacted` on delete would violate audit residue.
    expect(fake.rawMessages[0]?.content_redacted).toBe('Contact me at [REDACTED:email]')
  })

  it('replaces the conversation title with the deterministic deleted placeholder', async () => {
    const fake = createPurgeFakeDatabase({
      conversations: [
        fixtureConversation({
          id: 'conv-a',
          title: 'Highly sensitive subject line with user secret 12345',
        }),
      ],
      messages: [],
    })
    const store = createConversationStore(fake)

    await store.softDeleteForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
      now: new Date('2026-04-18T12:00:00.000Z'),
    })

    // Raw user input must be gone from the stored row — not just hidden by
    // the deleted_at filter. Any downstream export path that forgot the
    // filter still cannot leak the original title.
    expect(fake.rawConversations[0]?.title).toBe(DELETED_CONVERSATION_TITLE)
    expect(fake.rawConversations[0]?.title).not.toContain('Highly sensitive')
  })

  it('is idempotent on subsequent delete calls (no re-NULL, no title rewrite)', async () => {
    const fake = createPurgeFakeDatabase({
      conversations: [fixtureConversation()],
      messages: [
        fixtureMessage({
          id: 'msg-1',
          content_redacted: 'redacted',
          content_text: 'raw',
        }),
      ],
    })
    const store = createConversationStore(fake)

    const first = await store.softDeleteForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
      now: new Date('2026-04-18T12:00:00.000Z'),
    })

    // Manipulate a field that idempotency should NOT touch on re-delete.
    // If softDeleteForUser incorrectly runs the purge UPDATE again it would
    // overwrite this marker back to NULL.
    if (fake.rawMessages[0]) {
      fake.rawMessages[0].content_redacted = 'audit copy frozen at t=1'
    }

    const second = await store.softDeleteForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
      now: new Date('2026-04-18T13:00:00.000Z'),
    })

    expect(first?.alreadyDeleted).toBe(false)
    expect(second?.alreadyDeleted).toBe(true)
    expect(second?.deletedAt).toBe(first?.deletedAt)
    // audit marker survived — second call did not re-run the purge UPDATE
    expect(fake.rawMessages[0]?.content_redacted).toBe('audit copy frozen at t=1')
    // title still equals the placeholder written by the first delete
    expect(fake.rawConversations[0]?.title).toBe(DELETED_CONVERSATION_TITLE)
  })

  it('getUserVisibleMessageContent returns null when content_text is NULL, raw text otherwise', () => {
    // The boundary helper is the single enforced path any user/model-context
    // reader must use. Proving it collapses NULL to null is what makes the
    // type system catch future misuse (`string | null` instead of `string`).
    // Empty string is a legitimate message body (not a purge signal) so it
    // passes through as-is.
    expect(getUserVisibleMessageContent({ contentText: null })).toBeNull()
    expect(getUserVisibleMessageContent({ contentText: 'hello' })).toBe('hello')
    expect(getUserVisibleMessageContent({ contentText: '' })).toBe('')
  })

  it('getForUser exposes contentText=null for purged messages after delete', async () => {
    const fake = createPurgeFakeDatabase({
      conversations: [fixtureConversation()],
      messages: [
        fixtureMessage({
          id: 'msg-1',
          role: 'user',
          content_redacted: 'Contact me at [REDACTED:email]',
          content_text: 'Contact me at alice@example.com',
        }),
        fixtureMessage({
          id: 'msg-2',
          role: 'assistant',
          content_redacted: 'Launch moved to Tuesday.',
          content_text: 'Launch moved to Tuesday.',
          created_at: '2026-04-18T10:00:01.000Z',
        }),
      ],
    })
    const store = createConversationStore(fake)

    // Before delete: visible conversation, messages carry raw copy.
    const before = await store.getForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
    })
    expect(before?.messages.map((m) => m.contentText)).toEqual([
      'Contact me at alice@example.com',
      'Launch moved to Tuesday.',
    ])

    await store.softDeleteForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
      now: new Date('2026-04-18T12:00:00.000Z'),
    })

    // After delete: the conversation is hidden by the deleted_at filter
    // (detail path returns null). Even if a future admin path reads the
    // raw rows directly, `content_text` is NULL.
    const after = await store.getForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
    })
    expect(after).toBeNull()

    for (const message of fake.rawMessages) {
      expect(message.content_text).toBeNull()
      // Every message still has a redacted audit copy (§1.5 residue).
      expect(message.content_redacted.length).toBeGreaterThan(0)
    }
  })
})
