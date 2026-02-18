import { describe, expect, it } from 'vitest'

import { createConversationStore } from '#server/utils/conversation-store'

/**
 * Integration tests for governance-refinements §1.3 — every conversation
 * list / detail path MUST apply the `deleted_at IS NULL` filter. The store
 * layer is the single choke point; if we keep it honest, the route handlers
 * inherit the guarantee.
 *
 * Coverage:
 *
 * - list: soft-deleted conversations must disappear from the owner's feed
 * - detail: soft-deleted ids must 404 (modelled as `null` here), even for
 *   their original owner
 * - soft delete: idempotent — calling twice must not bump `deleted_at`
 * - ownership isolation: the filter does not accidentally leak across users
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

function createFakeDatabase(input: { conversations: ConversationRow[]; messages?: MessageRow[] }) {
  const conversations = [...input.conversations]
  const messages = [...(input.messages ?? [])]

  return {
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = []
      for (const statement of statements) {
        results.push(await statement.run())
      }
      return results
    },
    prepare(query: string) {
      // --- list (SELECT ... FROM conversations WHERE user_profile_id = ? AND deleted_at IS NULL)
      if (
        query.includes('FROM conversations') &&
        query.includes('user_profile_id = ?') &&
        query.includes('deleted_at IS NULL') &&
        query.includes('ORDER BY updated_at DESC')
      ) {
        return {
          bind(userProfileId: string, limit: number) {
            return {
              async all<T>() {
                const filtered = conversations
                  .filter(
                    (conversation) =>
                      conversation.user_profile_id === userProfileId &&
                      conversation.deleted_at === null
                  )
                  .toSorted((left, right) => right.updated_at.localeCompare(left.updated_at))
                  .slice(0, limit)
                  .map((conversation) => ({
                    id: conversation.id,
                    user_profile_id: conversation.user_profile_id,
                    access_level: conversation.access_level,
                    title: conversation.title,
                    created_at: conversation.created_at,
                    updated_at: conversation.updated_at,
                  }))

                return { results: filtered as unknown as T[] }
              },
              async first<T>() {
                throw new Error('unexpected first() on list query')
                return null as unknown as T
              },
              async run() {
                throw new Error('unexpected run() on list query')
              },
            }
          },
        }
      }

      // --- detail (SELECT ... FROM conversations WHERE id = ? AND user_profile_id = ? AND deleted_at IS NULL)
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
                  (conversation) =>
                    conversation.id === conversationId &&
                    conversation.user_profile_id === userProfileId &&
                    conversation.deleted_at === null
                )

                if (!match) {
                  return null
                }

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

      // --- messages lookup (SELECT ... FROM messages WHERE conversation_id = ?)
      if (
        query.includes('FROM messages') &&
        query.includes('conversation_id = ?') &&
        query.includes('ORDER BY created_at ASC')
      ) {
        return {
          bind(conversationId: string) {
            return {
              async all<T>() {
                const results = messages
                  .filter((message) => message.conversation_id === conversationId)
                  .toSorted((left, right) => left.created_at.localeCompare(right.created_at))
                  .map((message) => ({
                    id: message.id,
                    role: message.role,
                    content_redacted: message.content_redacted,
                    content_text: message.content_text,
                    citations_json: message.citations_json,
                    created_at: message.created_at,
                  }))

                return { results: results as unknown as T[] }
              },
              async first<T>() {
                throw new Error('unexpected first() on messages query')
                return null as unknown as T
              },
              async run() {
                throw new Error('unexpected run() on messages query')
              },
            }
          },
        }
      }

      // --- messages purge (UPDATE messages SET content_text = NULL WHERE conversation_id = ?)
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

      // --- soft delete lookup (ownership check before update)
      if (
        query.includes('FROM conversations') &&
        query.includes('WHERE id = ?') &&
        query.includes('user_profile_id = ?') &&
        query.includes('LIMIT 1') &&
        !query.includes('deleted_at IS NULL')
      ) {
        return {
          bind(conversationId: string, userProfileId: string) {
            return {
              async first<T>() {
                const match = conversations.find(
                  (conversation) =>
                    conversation.id === conversationId &&
                    conversation.user_profile_id === userProfileId
                )

                if (!match) {
                  return null
                }

                return {
                  id: match.id,
                  deleted_at: match.deleted_at,
                } as unknown as T
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

      // --- soft delete UPDATE (governance §1.4: also overwrites title
      // with the `[Deleted conversation]` placeholder so raw user input
      // cannot leak even if a buggy surface forgets the deleted_at filter).
      if (query.startsWith('UPDATE conversations SET deleted_at') && query.includes('title = ?')) {
        return {
          bind(deletedAt: string, updatedAt: string, title: string, conversationId: string) {
            return {
              async run() {
                const index = conversations.findIndex(
                  (conversation) => conversation.id === conversationId
                )

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
                throw new Error('unexpected first() on update')
                return null as unknown as T
              },
              async all<T>() {
                throw new Error('unexpected all() on update')
                return { results: [] as unknown as T[] }
              },
            }
          },
        }
      }

      // --- createForUser INSERT
      if (query.startsWith('INSERT INTO conversations')) {
        return {
          bind(
            id: string,
            userProfileId: string,
            accessLevel: string,
            title: string,
            createdAt: string,
            updatedAt: string
          ) {
            return {
              async run() {
                conversations.push({
                  id,
                  user_profile_id: userProfileId,
                  access_level: accessLevel,
                  title,
                  created_at: createdAt,
                  updated_at: updatedAt,
                  deleted_at: null,
                })

                return {}
              },
              async first<T>() {
                throw new Error('unexpected first() on insert')
                return null as unknown as T
              },
              async all<T>() {
                throw new Error('unexpected all() on insert')
                return { results: [] as unknown as T[] }
              },
            }
          },
        }
      }

      // --- isVisibleForUser probe (SELECT 1 AS exists_flag ... deleted_at IS NULL)
      if (
        query.includes('SELECT 1 AS exists_flag') &&
        query.includes('FROM conversations') &&
        query.includes('deleted_at IS NULL')
      ) {
        return {
          bind(conversationId: string, userProfileId: string) {
            return {
              async first<T>() {
                const match = conversations.find(
                  (conversation) =>
                    conversation.id === conversationId &&
                    conversation.user_profile_id === userProfileId &&
                    conversation.deleted_at === null
                )

                return match ? ({ exists_flag: 1 } as unknown as T) : null
              },
              async all<T>() {
                throw new Error('unexpected all() on exists probe')
                return { results: [] as unknown as T[] }
              },
              async run() {
                throw new Error('unexpected run() on exists probe')
              },
            }
          },
        }
      }

      throw new Error(`Unhandled query in conversation-store fake: ${query}`)
    },
  }
}

function baseConversation(overrides: Partial<ConversationRow>): ConversationRow {
  return {
    id: overrides.id ?? 'conv-x',
    user_profile_id: overrides.user_profile_id ?? 'user-1',
    access_level: overrides.access_level ?? 'internal',
    title: overrides.title ?? 'Sample conversation',
    created_at: overrides.created_at ?? '2026-04-18T09:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-04-18T09:00:00.000Z',
    deleted_at: overrides.deleted_at ?? null,
  }
}

describe('conversation store — list filter', () => {
  it('hides soft-deleted conversations from the owner', async () => {
    const database = createFakeDatabase({
      conversations: [
        baseConversation({
          id: 'conv-visible',
          user_profile_id: 'user-1',
          updated_at: '2026-04-18T10:00:00.000Z',
        }),
        baseConversation({
          id: 'conv-deleted',
          user_profile_id: 'user-1',
          updated_at: '2026-04-18T11:00:00.000Z',
          deleted_at: '2026-04-18T11:05:00.000Z',
        }),
      ],
    })
    const store = createConversationStore(database)

    const list = await store.listForUser({ userProfileId: 'user-1' })

    expect(list.map((conversation) => conversation.id)).toEqual(['conv-visible'])
  })

  it('does not leak another user\u2019s conversations even if ids collide', async () => {
    const database = createFakeDatabase({
      conversations: [
        baseConversation({ id: 'conv-a', user_profile_id: 'user-1' }),
        baseConversation({ id: 'conv-b', user_profile_id: 'user-2' }),
      ],
    })
    const store = createConversationStore(database)

    const userOneList = await store.listForUser({ userProfileId: 'user-1' })
    const userTwoList = await store.listForUser({ userProfileId: 'user-2' })

    expect(userOneList.map((conversation) => conversation.id)).toEqual(['conv-a'])
    expect(userTwoList.map((conversation) => conversation.id)).toEqual(['conv-b'])
  })
})

describe('conversation store — detail filter', () => {
  it('returns null for a soft-deleted conversation even when the owner asks', async () => {
    const database = createFakeDatabase({
      conversations: [
        baseConversation({
          id: 'conv-deleted',
          user_profile_id: 'user-1',
          deleted_at: '2026-04-18T11:00:00.000Z',
        }),
      ],
    })
    const store = createConversationStore(database)

    const detail = await store.getForUser({
      conversationId: 'conv-deleted',
      userProfileId: 'user-1',
    })

    expect(detail).toBeNull()
  })

  it('returns null when the caller does not own the conversation', async () => {
    const database = createFakeDatabase({
      conversations: [baseConversation({ id: 'conv-a', user_profile_id: 'user-1' })],
    })
    const store = createConversationStore(database)

    const detail = await store.getForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-2',
    })

    expect(detail).toBeNull()
  })

  it('returns messages alongside the visible conversation', async () => {
    const database = createFakeDatabase({
      conversations: [
        baseConversation({
          id: 'conv-a',
          user_profile_id: 'user-1',
          title: 'Chat A',
        }),
      ],
      messages: [
        {
          id: 'msg-1',
          conversation_id: 'conv-a',
          role: 'user',
          content_redacted: 'hello',
          content_text: 'hello',
          citations_json: '[]',
          created_at: '2026-04-18T10:00:00.000Z',
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-a',
          role: 'assistant',
          content_redacted: 'hi there',
          content_text: 'hi there',
          citations_json: JSON.stringify([{ documentVersionId: 'ver-1' }]),
          created_at: '2026-04-18T10:00:01.000Z',
        },
      ],
    })
    const store = createConversationStore(database)

    const detail = await store.getForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
    })

    expect(detail?.id).toBe('conv-a')
    expect(detail?.title).toBe('Chat A')
    expect(detail?.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2'])
    expect(detail?.messages[1]?.citationsJson).toContain('ver-1')
  })
})

describe('conversation store — soft delete', () => {
  it('writes deleted_at on first delete and is idempotent on subsequent calls', async () => {
    const database = createFakeDatabase({
      conversations: [baseConversation({ id: 'conv-a', user_profile_id: 'user-1' })],
    })
    const store = createConversationStore(database)

    const firstDelete = await store.softDeleteForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
      now: new Date('2026-04-18T12:00:00.000Z'),
    })

    expect(firstDelete).toEqual({
      conversationId: 'conv-a',
      deletedAt: '2026-04-18T12:00:00.000Z',
      alreadyDeleted: false,
    })

    // Subsequent delete must keep the original timestamp and flag as already
    // deleted — the API layer can turn this into a 200 / 204 without
    // double-writing.
    const secondDelete = await store.softDeleteForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
      now: new Date('2026-04-18T13:00:00.000Z'),
    })

    expect(secondDelete).toEqual({
      conversationId: 'conv-a',
      deletedAt: '2026-04-18T12:00:00.000Z',
      alreadyDeleted: true,
    })

    // After the soft delete, detail + list must both agree it is gone.
    const detail = await store.getForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-1',
    })
    const list = await store.listForUser({ userProfileId: 'user-1' })

    expect(detail).toBeNull()
    expect(list).toEqual([])
  })

  it('returns null when a non-owner tries to delete', async () => {
    const database = createFakeDatabase({
      conversations: [baseConversation({ id: 'conv-a', user_profile_id: 'user-1' })],
    })
    const store = createConversationStore(database)

    const result = await store.softDeleteForUser({
      conversationId: 'conv-a',
      userProfileId: 'user-other',
    })

    expect(result).toBeNull()
  })

  it('returns null when the conversation does not exist at all', async () => {
    const database = createFakeDatabase({
      conversations: [],
    })
    const store = createConversationStore(database)

    const result = await store.softDeleteForUser({
      conversationId: 'conv-missing',
      userProfileId: 'user-1',
    })

    expect(result).toBeNull()
  })
})

describe('conversation store — isVisibleForUser', () => {
  it('returns true for a live conversation owned by the caller', async () => {
    const database = createFakeDatabase({
      conversations: [baseConversation({ id: 'conv-a', user_profile_id: 'user-1' })],
    })
    const store = createConversationStore(database)

    await expect(
      store.isVisibleForUser({ conversationId: 'conv-a', userProfileId: 'user-1' })
    ).resolves.toBe(true)
  })

  it('returns false for a soft-deleted conversation even for its owner', async () => {
    const database = createFakeDatabase({
      conversations: [
        baseConversation({
          id: 'conv-a',
          user_profile_id: 'user-1',
          deleted_at: '2026-04-18T12:00:00.000Z',
        }),
      ],
    })
    const store = createConversationStore(database)

    await expect(
      store.isVisibleForUser({ conversationId: 'conv-a', userProfileId: 'user-1' })
    ).resolves.toBe(false)
  })

  it('returns false when the caller does not own the conversation', async () => {
    const database = createFakeDatabase({
      conversations: [baseConversation({ id: 'conv-a', user_profile_id: 'user-1' })],
    })
    const store = createConversationStore(database)

    await expect(
      store.isVisibleForUser({ conversationId: 'conv-a', userProfileId: 'user-other' })
    ).resolves.toBe(false)
  })
})

describe('conversation store — createForUser (governance §1.7)', () => {
  it('inserts a row with the supplied title and visible-by-default state', async () => {
    const database = createFakeDatabase({ conversations: [] })
    const store = createConversationStore(database)

    const result = await store.createForUser({
      userProfileId: 'user-1',
      title: 'Launch timing update',
      now: new Date('2026-04-18T09:00:00.000Z'),
      id: 'conv-explicit',
    })

    expect(result).toEqual({
      id: 'conv-explicit',
      userProfileId: 'user-1',
      accessLevel: 'internal',
      title: 'Launch timing update',
      createdAt: '2026-04-18T09:00:00.000Z',
      updatedAt: '2026-04-18T09:00:00.000Z',
    })

    // The inserted row should be visible to the owner immediately — proves
    // we are not accidentally writing `deleted_at` on create.
    await expect(
      store.isVisibleForUser({ conversationId: 'conv-explicit', userProfileId: 'user-1' })
    ).resolves.toBe(true)
  })

  it('falls back to the default title when the caller passes whitespace', async () => {
    const database = createFakeDatabase({ conversations: [] })
    const store = createConversationStore(database)

    const result = await store.createForUser({
      userProfileId: 'user-1',
      title: '   ',
      id: 'conv-empty-title',
      now: new Date('2026-04-18T09:00:00.000Z'),
    })

    expect(result.title).toBe('New conversation')
  })

  it('generates a uuid when the caller does not pass an id', async () => {
    const database = createFakeDatabase({ conversations: [] })
    const store = createConversationStore(database)

    const result = await store.createForUser({
      userProfileId: 'user-1',
      now: new Date('2026-04-18T09:00:00.000Z'),
    })

    // Basic shape check — we trust `crypto.randomUUID()` to be a uuid.
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i)
    await expect(
      store.isVisibleForUser({ conversationId: result.id, userProfileId: 'user-1' })
    ).resolves.toBe(true)
  })
})
