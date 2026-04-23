import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createConversationStore } from '../../server/utils/conversation-store'
import { getD1Database } from '../../server/utils/database'

interface FakeLibsqlResult {
  lastInsertRowid?: bigint | number | null
  rows?: Record<string, unknown>[]
  rowsAffected?: number
}

interface FakeLibsqlClient {
  batch: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
}

const fakeHubDb = {
  db: { $client: null as FakeLibsqlClient | null },
  schema: {},
}

vi.mock('hub:db', () => fakeHubDb)

describe('getD1Database', () => {
  let client: FakeLibsqlClient

  beforeEach(() => {
    client = {
      execute: vi.fn(async (statement: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof statement === 'string' ? statement : statement.sql
        const args = typeof statement === 'string' ? [] : (statement.args ?? [])

        if (sql.includes('FROM conversations') && sql.includes('deleted_at IS NULL')) {
          return {
            rows: [
              {
                id: 'conv-1',
                user_profile_id: args[0] ?? 'user-1',
                access_level: 'internal',
                title: '已保存對話',
                created_at: '2026-04-23T00:00:00.000Z',
                updated_at: '2026-04-23T01:00:00.000Z',
              },
            ],
            rowsAffected: 0,
          } satisfies FakeLibsqlResult
        }

        if (sql.includes('SELECT id, deleted_at')) {
          return {
            rows: [
              {
                id: args[0] ?? 'conv-1',
                deleted_at: null,
              },
            ],
            rowsAffected: 0,
          } satisfies FakeLibsqlResult
        }

        return {
          rows: [],
          rowsAffected: 0,
        } satisfies FakeLibsqlResult
      }),
      batch: vi.fn(async (statements: Array<{ sql: string; args?: unknown[] }>) => {
        return statements.map(() => ({
          rows: [],
          rowsAffected: 1,
        })) satisfies FakeLibsqlResult[]
      }),
    }

    fakeHubDb.db.$client = client
  })

  it('adapts patched hub:db libsql client so conversation list can still use D1-style prepare/bind/all', async () => {
    const database = await getD1Database()
    const store = createConversationStore(database)

    await expect(
      store.listForUser({
        userProfileId: 'user-1',
        limit: 10,
      }),
    ).resolves.toEqual([
      {
        id: 'conv-1',
        title: '已保存對話',
        accessLevel: 'internal',
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T01:00:00.000Z',
        userProfileId: 'user-1',
      },
    ])
  })

  it('adapts libsql batch writes so conversation soft-delete still works in local dev', async () => {
    const database = await getD1Database()
    const store = createConversationStore(database)

    await expect(
      store.softDeleteForUser({
        conversationId: 'conv-1',
        userProfileId: 'user-1',
        now: new Date('2026-04-23T02:00:00.000Z'),
      }),
    ).resolves.toEqual({
      conversationId: 'conv-1',
      deletedAt: '2026-04-23T02:00:00.000Z',
      alreadyDeleted: false,
    })

    expect(client.batch).toHaveBeenCalledTimes(1)
    expect(client.batch).toHaveBeenCalledWith([
      {
        sql: 'UPDATE conversations SET deleted_at = ?, updated_at = ?, title = ? WHERE id = ?',
        args: [
          '2026-04-23T02:00:00.000Z',
          '2026-04-23T02:00:00.000Z',
          '[Deleted conversation]',
          'conv-1',
        ],
      },
      {
        sql: 'UPDATE messages SET content_text = NULL WHERE conversation_id = ?',
        args: ['conv-1'],
      },
    ])
  })
})
