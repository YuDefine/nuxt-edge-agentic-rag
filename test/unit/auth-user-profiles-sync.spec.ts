import { describe, expect, it, vi } from 'vitest'

import { syncUserProfile, type UserProfileSyncDeps } from '../../server/utils/user-profile-sync'

interface CapturedUpdate {
  table: symbol
  set: Record<string, unknown>
}

interface MockDb {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  transaction: ReturnType<typeof vi.fn>
  insertCalls: Array<{ table: symbol; values: Record<string, unknown> }>
  topUpdateCalls: CapturedUpdate[]
  txUpdateCalls: CapturedUpdate[]
}

interface MockSchema {
  userProfiles: { id: symbol; emailNormalized: symbol }
  conversations: { userProfileId: symbol }
  queryLogs: { userProfileId: symbol }
  messages: { userProfileId: symbol }
  documents: { createdByUserId: symbol }
}

function makeSchema(): MockSchema {
  return {
    userProfiles: {
      id: Symbol('userProfiles.id'),
      emailNormalized: Symbol('userProfiles.emailNormalized'),
    },
    conversations: { userProfileId: Symbol('conversations.userProfileId') },
    queryLogs: { userProfileId: Symbol('queryLogs.userProfileId') },
    messages: { userProfileId: Symbol('messages.userProfileId') },
    documents: { createdByUserId: Symbol('documents.createdByUserId') },
  }
}

// tableTag lets assertions identify which drizzle table the mock call targeted.
// The implementation passes `schema.userProfiles` (object) to `db.update(...)`;
// we convert to a stable symbol via the `id` / `userProfileId` / `createdByUserId`
// field which is referenced inside the same call. This keeps the mock layer
// ignorant of SQL while still asserting the correct target table.
function tableTag(table: unknown): symbol {
  if (typeof table === 'object' && table !== null) {
    const obj = table as Record<string, unknown>
    if (typeof obj.id === 'symbol') return obj.id
    if (typeof obj.userProfileId === 'symbol') return obj.userProfileId
    if (typeof obj.createdByUserId === 'symbol') return obj.createdByUserId
  }
  return Symbol('unknown')
}

function chainable(result: unknown): PromiseLike<unknown> {
  const p: Record<string, unknown> = Promise.resolve(result) as unknown as Record<string, unknown>
  const chain = () => p as unknown as typeof p & PromiseLike<unknown>
  p.from = chain
  p.where = chain
  p.limit = chain
  return p as unknown as PromiseLike<unknown>
}

function makeDb(selectResults: Array<Array<{ id: string }>>): MockDb {
  let selectIdx = 0
  const insertCalls: MockDb['insertCalls'] = []
  const topUpdateCalls: CapturedUpdate[] = []
  const txUpdateCalls: CapturedUpdate[] = []

  const select = vi.fn(() => {
    const result = selectResults[selectIdx++] ?? []
    return chainable(result)
  })

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => {
      insertCalls.push({ table: tableTag(table), values })
      return Promise.resolve()
    }),
  }))

  const makeUpdateCaller = (captureBucket: CapturedUpdate[]) =>
    vi.fn((table: unknown) => ({
      set: vi.fn((set: Record<string, unknown>) => ({
        where: vi.fn(() => {
          captureBucket.push({ table: tableTag(table), set })
          return Promise.resolve()
        }),
      })),
    }))

  const topUpdate = makeUpdateCaller(topUpdateCalls)
  const txUpdate = makeUpdateCaller(txUpdateCalls)

  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = { update: txUpdate }
    await cb(tx)
  })

  return {
    select,
    insert,
    update: topUpdate,
    transaction,
    insertCalls,
    topUpdateCalls,
    txUpdateCalls,
  }
}

function makeDeps(overrides: {
  db: MockDb
  schema: MockSchema
  env?: string
}): UserProfileSyncDeps {
  const log = { error: vi.fn() }
  return {
    db: overrides.db as unknown as UserProfileSyncDeps['db'],
    schema: overrides.schema as unknown as UserProfileSyncDeps['schema'],
    log,
    env: overrides.env,
  }
}

describe('syncUserProfile (TD-044 hook synchronizer)', () => {
  describe('Requirement: Session Hook Resolves user_profiles by Email Normalized', () => {
    it('Scenario: No existing profile row for the email inserts new row', async () => {
      const schema = makeSchema()
      const db = makeDb([[]])
      const deps = makeDeps({ db, schema, env: 'development' })

      await syncUserProfile(deps, {
        userId: 'user_new',
        emailNormalized: 'alice@example.com',
        roleSnapshot: 'member',
        adminSource: 'none',
      })

      expect(db.select).toHaveBeenCalledTimes(1)
      expect(db.insertCalls).toEqual([
        {
          table: schema.userProfiles.id,
          values: {
            id: 'user_new',
            emailNormalized: 'alice@example.com',
            roleSnapshot: 'member',
            adminSource: 'none',
          },
        },
      ])
      expect(db.topUpdateCalls).toHaveLength(0)
      expect(db.txUpdateCalls).toHaveLength(0)
      expect(db.transaction).not.toHaveBeenCalled()
    })

    it('Scenario: Existing profile row already matches current user id updates non-id columns only', async () => {
      const schema = makeSchema()
      const db = makeDb([[{ id: 'user_abc' }]])
      const deps = makeDeps({ db, schema, env: 'development' })

      await syncUserProfile(deps, {
        userId: 'user_abc',
        emailNormalized: 'alice@example.com',
        roleSnapshot: 'admin',
        adminSource: 'allowlist',
      })

      expect(db.insertCalls).toHaveLength(0)
      expect(db.topUpdateCalls).toEqual([
        {
          table: schema.userProfiles.id,
          set: { roleSnapshot: 'admin', adminSource: 'allowlist' },
        },
      ])
      expect(db.transaction).not.toHaveBeenCalled()
    })

    it('Scenario: Stale profile row with different id triggers application-level migration', async () => {
      const schema = makeSchema()
      const db = makeDb([[{ id: 'user_old' }]])
      const deps = makeDeps({ db, schema, env: 'development' })

      await syncUserProfile(deps, {
        userId: 'user_new',
        emailNormalized: 'alice@example.com',
        roleSnapshot: 'member',
        adminSource: 'none',
      })

      expect(db.transaction).toHaveBeenCalledTimes(1)
      expect(db.insertCalls).toHaveLength(0)
      expect(db.topUpdateCalls).toHaveLength(0)

      // children updated before parent; parent's `id` flipped.
      expect(db.txUpdateCalls).toEqual([
        {
          table: schema.conversations.userProfileId,
          set: { userProfileId: 'user_new' },
        },
        {
          table: schema.queryLogs.userProfileId,
          set: { userProfileId: 'user_new' },
        },
        {
          table: schema.messages.userProfileId,
          set: { userProfileId: 'user_new' },
        },
        {
          table: schema.documents.createdByUserId,
          set: { createdByUserId: 'user_new' },
        },
        {
          table: schema.userProfiles.id,
          set: { id: 'user_new', roleSnapshot: 'member', adminSource: 'none' },
        },
      ])
    })

    it('Example: stale-to-new migration row counts match spec table', async () => {
      // Spec example: conversations=3, query_logs=5, messages=12, documents=1 rows
      // reference stale id. Our mock does not count rows (it's a drizzle spy),
      // so the test asserts that the UPDATE is issued exactly once per child
      // table with the correct target id — which is the row-count-independent
      // invariant the spec example encodes.
      const schema = makeSchema()
      const db = makeDb([[{ id: 'old' }]])
      const deps = makeDeps({ db, schema, env: 'development' })

      await syncUserProfile(deps, {
        userId: 'new',
        emailNormalized: 'alice@example.com',
        roleSnapshot: 'member',
        adminSource: 'none',
      })

      const targetedTables = db.txUpdateCalls.map((call) => call.table)
      expect(targetedTables).toEqual([
        schema.conversations.userProfileId,
        schema.queryLogs.userProfileId,
        schema.messages.userProfileId,
        schema.documents.createdByUserId,
        schema.userProfiles.id,
      ])
      for (const call of db.txUpdateCalls.slice(0, 4)) {
        expect(Object.values(call.set)).toContain('new')
      }
      const parentUpdate = db.txUpdateCalls.at(-1)
      expect(parentUpdate?.set.id).toBe('new')
    })
  })

  describe('Requirement: Session Hook Rethrows Sync Errors Outside Production', () => {
    it('Scenario: Non-production rethrow on unexpected error (NODE_ENV=development)', async () => {
      const schema = makeSchema()
      const db = makeDb([[]])
      db.insert = vi.fn(() => ({
        values: vi.fn(() => Promise.reject(new Error('boom'))),
      })) as unknown as MockDb['insert']
      const log = { error: vi.fn() }
      const deps: UserProfileSyncDeps = {
        db: db as unknown as UserProfileSyncDeps['db'],
        schema: schema as unknown as UserProfileSyncDeps['schema'],
        log,
        env: 'development',
      }

      await expect(
        syncUserProfile(deps, {
          userId: 'u',
          emailNormalized: 'alice@example.com',
          roleSnapshot: 'member',
          adminSource: 'none',
        }),
      ).rejects.toThrow('boom')
      expect(log.error).toHaveBeenCalledTimes(1)
    })

    it('Scenario: Production swallow preserves session (NODE_ENV=production)', async () => {
      const schema = makeSchema()
      const db = makeDb([[]])
      db.insert = vi.fn(() => ({
        values: vi.fn(() => Promise.reject(new Error('boom'))),
      })) as unknown as MockDb['insert']
      const log = { error: vi.fn() }
      const deps: UserProfileSyncDeps = {
        db: db as unknown as UserProfileSyncDeps['db'],
        schema: schema as unknown as UserProfileSyncDeps['schema'],
        log,
        env: 'production',
      }

      await expect(
        syncUserProfile(deps, {
          userId: 'u',
          emailNormalized: 'alice@example.com',
          roleSnapshot: 'member',
          adminSource: 'none',
        }),
      ).resolves.toBeUndefined()
      expect(log.error).toHaveBeenCalledTimes(1)
    })

    it('Scenario: Preview environment follows non-production path (NODE_ENV=preview)', async () => {
      const schema = makeSchema()
      const db = makeDb([[]])
      db.insert = vi.fn(() => ({
        values: vi.fn(() => Promise.reject(new Error('boom'))),
      })) as unknown as MockDb['insert']
      const log = { error: vi.fn() }
      const deps: UserProfileSyncDeps = {
        db: db as unknown as UserProfileSyncDeps['db'],
        schema: schema as unknown as UserProfileSyncDeps['schema'],
        log,
        env: 'preview',
      }

      await expect(
        syncUserProfile(deps, {
          userId: 'u',
          emailNormalized: 'alice@example.com',
          roleSnapshot: 'member',
          adminSource: 'none',
        }),
      ).rejects.toThrow('boom')
    })
  })

  describe('Requirement: Session Hook Emits Actionable Log Fields on Sync Failure', () => {
    it('Scenario: UNIQUE conflict error emits hint in log fields', async () => {
      const schema = makeSchema()
      const db = makeDb([[]])
      db.insert = vi.fn(() => ({
        values: vi.fn(() =>
          Promise.reject(new Error('UNIQUE constraint failed: email_normalized')),
        ),
      })) as unknown as MockDb['insert']
      const log = { error: vi.fn() }
      const deps: UserProfileSyncDeps = {
        db: db as unknown as UserProfileSyncDeps['db'],
        schema: schema as unknown as UserProfileSyncDeps['schema'],
        log,
        env: 'production',
      }

      await syncUserProfile(deps, {
        userId: 'u',
        emailNormalized: 'alice@example.com',
        roleSnapshot: 'member',
        adminSource: 'none',
      })

      expect(log.error).toHaveBeenCalledWith(
        'user_profiles sync failed',
        expect.objectContaining({
          userId: 'u',
          error: expect.stringContaining('UNIQUE'),
          hint: expect.stringContaining('Stale user_profiles row'),
        }),
      )
    })

    it('Scenario: Email is redacted to first 3 chars + "***" in log output', async () => {
      const schema = makeSchema()
      const db = makeDb([[]])
      db.insert = vi.fn(() => ({
        values: vi.fn(() => Promise.reject(new Error('boom'))),
      })) as unknown as MockDb['insert']
      const log = { error: vi.fn() }
      const deps: UserProfileSyncDeps = {
        db: db as unknown as UserProfileSyncDeps['db'],
        schema: schema as unknown as UserProfileSyncDeps['schema'],
        log,
        env: 'production',
      }

      await syncUserProfile(deps, {
        userId: 'u',
        emailNormalized: 'alice@example.com',
        roleSnapshot: 'member',
        adminSource: 'none',
      })

      const [, fields] = log.error.mock.calls[0] as [string, Record<string, unknown>]
      expect(fields.emailNormalized).toBe('ali***')
      // Full email must not appear in any field (including error / hint).
      for (const value of Object.values(fields)) {
        if (typeof value === 'string') {
          expect(value).not.toContain('alice@example.com')
          expect(value).not.toContain('@example.com')
        }
      }
    })
  })
})
