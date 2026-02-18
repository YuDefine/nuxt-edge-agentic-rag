import { describe, expect, it } from 'vitest'

import {
  createConversationStaleResolver,
  parseCitedDocumentVersionIds,
} from '#server/utils/conversation-stale-resolver'

/**
 * Integration tests for governance-refinements §1.1 `stale conversation
 * resolver`. The resolver only talks to D1 via `prepare/bind/first/all`, so
 * we back it with an in-memory fake D1 database that mimics the two queries
 * the resolver issues:
 *
 * 1. `SELECT ... FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1`
 * 2. `SELECT id, is_current FROM document_versions WHERE id IN (...)`
 *
 * This keeps the suite portable (no hub:db plumbing) while still exercising
 * the real SQL-bound resolver code.
 */

interface MessageRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  created_at: string
  citations_json: string | null
}

interface VersionRow {
  id: string
  is_current: number
}

function createFakeDatabase(input: { messages: MessageRow[]; versions: VersionRow[] }) {
  return {
    prepare(query: string) {
      const isLatestAssistantQuery =
        query.includes('FROM messages') && query.includes("role = 'assistant'")
      const isVersionLookupQuery =
        query.includes('FROM document_versions') && query.includes('WHERE id IN')

      if (isLatestAssistantQuery) {
        return {
          bind(conversationId: string) {
            return {
              async first<T>(): Promise<T | null> {
                const match = input.messages
                  .filter(
                    (message) =>
                      message.conversation_id === conversationId && message.role === 'assistant'
                  )
                  .toSorted((left, right) => right.created_at.localeCompare(left.created_at))[0]

                if (!match) {
                  return null
                }

                return {
                  id: match.id,
                  created_at: match.created_at,
                  citations_json: match.citations_json,
                } as unknown as T
              },
              async all<T>() {
                throw new Error('unexpected all() call on latest-assistant query')
                // type assertion below to keep TS happy even though we throw
                return { results: [] as unknown as T[] }
              },
            }
          },
        }
      }

      if (isVersionLookupQuery) {
        return {
          bind(...ids: unknown[]) {
            const stringIds = new Set(ids.filter((id): id is string => typeof id === 'string'))

            return {
              async all<T>() {
                const results = input.versions.filter((version) => stringIds.has(version.id))

                return { results: results as unknown as T[] }
              },
              async first<T>(): Promise<T | null> {
                throw new Error('unexpected first() call on version lookup')
              },
            }
          },
        }
      }

      throw new Error(`Unexpected query in fake database: ${query}`)
    },
  }
}

describe('parseCitedDocumentVersionIds', () => {
  it('returns an empty array for null / empty / malformed citations_json', () => {
    expect(parseCitedDocumentVersionIds(null)).toEqual([])
    expect(parseCitedDocumentVersionIds('')).toEqual([])
    expect(parseCitedDocumentVersionIds('{not json')).toEqual([])
    expect(parseCitedDocumentVersionIds('"a string payload"')).toEqual([])
    expect(parseCitedDocumentVersionIds('{}')).toEqual([])
  })

  it('extracts documentVersionId from the `citation_records`-shaped payload', () => {
    const json = JSON.stringify([
      { documentVersionId: 'ver-1', sourceChunkId: 'chunk-1' },
      { documentVersionId: 'ver-2', sourceChunkId: 'chunk-2' },
    ])

    expect(parseCitedDocumentVersionIds(json)).toEqual(['ver-1', 'ver-2'])
  })

  it('accepts the compact string-array shape as well', () => {
    expect(parseCitedDocumentVersionIds(JSON.stringify(['ver-a', 'ver-b']))).toEqual([
      'ver-a',
      'ver-b',
    ])
  })

  it('deduplicates repeated document_version_id entries', () => {
    const json = JSON.stringify([
      { documentVersionId: 'ver-1' },
      { documentVersionId: 'ver-1' },
      'ver-1',
      { documentVersionId: 'ver-2' },
    ])

    expect(parseCitedDocumentVersionIds(json)).toEqual(['ver-1', 'ver-2'])
  })
})

describe('createConversationStaleResolver', () => {
  it('reports not-stale when the conversation has no assistant history yet', async () => {
    const database = createFakeDatabase({
      messages: [
        {
          id: 'msg-user-1',
          conversation_id: 'conv-1',
          role: 'user',
          created_at: '2026-04-18T10:00:00.000Z',
          citations_json: '[]',
        },
      ],
      versions: [{ id: 'ver-1', is_current: 1 }],
    })
    const resolver = createConversationStaleResolver(database)

    const result = await resolver.resolveStaleness({ conversationId: 'conv-1' })

    expect(result).toEqual({
      conversationId: 'conv-1',
      hasAssistantHistory: false,
      isStale: false,
      staleDocumentVersionIds: [],
      latestAssistantMessage: null,
    })
  })

  it('reports not-stale when the latest assistant message has no citations (e.g. a refusal)', async () => {
    const database = createFakeDatabase({
      messages: [
        {
          id: 'msg-assistant-1',
          conversation_id: 'conv-1',
          role: 'assistant',
          created_at: '2026-04-18T10:00:00.000Z',
          citations_json: '[]',
        },
      ],
      versions: [],
    })
    const resolver = createConversationStaleResolver(database)

    const result = await resolver.resolveStaleness({ conversationId: 'conv-1' })

    expect(result.hasAssistantHistory).toBe(true)
    expect(result.isStale).toBe(false)
    expect(result.staleDocumentVersionIds).toEqual([])
    expect(result.latestAssistantMessage?.citedDocumentVersionIds).toEqual([])
  })

  it('reports not-stale when every cited document_version_id is still is_current=1', async () => {
    const database = createFakeDatabase({
      messages: [
        {
          id: 'msg-assistant-1',
          conversation_id: 'conv-1',
          role: 'assistant',
          created_at: '2026-04-18T10:00:00.000Z',
          citations_json: JSON.stringify([
            { documentVersionId: 'ver-current-1' },
            { documentVersionId: 'ver-current-2' },
          ]),
        },
      ],
      versions: [
        { id: 'ver-current-1', is_current: 1 },
        { id: 'ver-current-2', is_current: 1 },
      ],
    })
    const resolver = createConversationStaleResolver(database)

    const result = await resolver.resolveStaleness({ conversationId: 'conv-1' })

    expect(result.isStale).toBe(false)
    expect(result.staleDocumentVersionIds).toEqual([])
    expect(result.latestAssistantMessage?.citedDocumentVersionIds).toEqual([
      'ver-current-1',
      'ver-current-2',
    ])
  })

  it('reports stale when ANY cited document_version_id is no longer is_current', async () => {
    // Simulates the acceptance runbook §2.3 scenario: Doc A was cited, admin
    // published Doc A', so the original `ver-1` flips to is_current=0.
    const database = createFakeDatabase({
      messages: [
        {
          id: 'msg-assistant-1',
          conversation_id: 'conv-1',
          role: 'assistant',
          created_at: '2026-04-18T10:00:00.000Z',
          citations_json: JSON.stringify([{ documentVersionId: 'ver-1' }]),
        },
      ],
      versions: [
        { id: 'ver-1', is_current: 0 },
        { id: 'ver-2', is_current: 1 },
      ],
    })
    const resolver = createConversationStaleResolver(database)

    const result = await resolver.resolveStaleness({ conversationId: 'conv-1' })

    expect(result.isStale).toBe(true)
    expect(result.staleDocumentVersionIds).toEqual(['ver-1'])
  })

  it('treats an unknown / deleted document_version_id as stale', async () => {
    const database = createFakeDatabase({
      messages: [
        {
          id: 'msg-assistant-1',
          conversation_id: 'conv-1',
          role: 'assistant',
          created_at: '2026-04-18T10:00:00.000Z',
          citations_json: JSON.stringify([
            { documentVersionId: 'ver-still-current' },
            { documentVersionId: 'ver-missing' },
          ]),
        },
      ],
      versions: [
        // `ver-missing` is intentionally absent
        { id: 'ver-still-current', is_current: 1 },
      ],
    })
    const resolver = createConversationStaleResolver(database)

    const result = await resolver.resolveStaleness({ conversationId: 'conv-1' })

    expect(result.isStale).toBe(true)
    expect(result.staleDocumentVersionIds).toEqual(['ver-missing'])
  })

  it('only considers the newest assistant message, ignoring earlier ones', async () => {
    const database = createFakeDatabase({
      messages: [
        {
          // Older assistant reply — cited a now-retired version.
          id: 'msg-assistant-old',
          conversation_id: 'conv-1',
          role: 'assistant',
          created_at: '2026-04-18T09:00:00.000Z',
          citations_json: JSON.stringify([{ documentVersionId: 'ver-old' }]),
        },
        {
          // Newest assistant reply — cites current version.
          id: 'msg-assistant-new',
          conversation_id: 'conv-1',
          role: 'assistant',
          created_at: '2026-04-18T10:00:00.000Z',
          citations_json: JSON.stringify([{ documentVersionId: 'ver-new' }]),
        },
      ],
      versions: [
        { id: 'ver-old', is_current: 0 },
        { id: 'ver-new', is_current: 1 },
      ],
    })
    const resolver = createConversationStaleResolver(database)

    const result = await resolver.resolveStaleness({ conversationId: 'conv-1' })

    expect(result.isStale).toBe(false)
    expect(result.latestAssistantMessage?.id).toBe('msg-assistant-new')
  })
})
