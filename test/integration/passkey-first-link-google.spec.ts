import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

import { createKvBindingFake } from '../acceptance/helpers/bindings'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  dbBatch: vi.fn(),
  dbPrepare: vi.fn(),
  deleteCookie: vi.fn(),
  fetch: vi.fn(),
  getCookie: vi.fn(),
  getValidatedQuery: vi.fn(),
  hubDbInsertProfile: vi.fn(),
  hubDbSelect: vi.fn(),
  hubDbUpdate: vi.fn(),
  loggerError: vi.fn(),
  loggerSet: vi.fn(),
  recordRoleChange: vi.fn(),
  requireUserSession: vi.fn(),
  sendRedirect: vi.fn(),
  useRuntimeConfig: vi.fn(),
}))

const schemaFake = {
  user: {
    __tbl: 'user',
    id: { __col: 'id' },
    email: { __col: 'email' },
    role: { __col: 'role' },
  },
  account: { __tbl: 'account' },
  userProfiles: {
    __tbl: 'user_profiles',
    id: { __col: 'id' },
    emailNormalized: { __col: 'email_normalized' },
    roleSnapshot: { __col: 'role_snapshot' },
    adminSource: { __col: 'admin_source' },
  },
  memberRoleChanges: { __tbl: 'member_role_changes' },
  // fix-user-profile-id-drift (TD-044) `syncUserProfile` migrate path 走到時，
  // `tx.update(schema.X).set(...).where(eq(schema.X.userProfileId, staleId))`
  // 會 access 這四張 child table 上的 column descriptor。本 spec 的 fixture 不
  // 主動觸發 migrate path（id 相同），但保險起見補完整 stub 避免日後 fixture
  // 漂移時撞 `Cannot read properties of undefined (reading 'userProfileId')`。
  // 對應 TD-052。
  conversations: {
    __tbl: 'conversations',
    userProfileId: { __col: 'user_profile_id' },
  },
  queryLogs: {
    __tbl: 'query_logs',
    userProfileId: { __col: 'user_profile_id' },
  },
  messages: {
    __tbl: 'messages',
    userProfileId: { __col: 'user_profile_id' },
  },
  documents: {
    __tbl: 'documents',
    createdByUserId: { __col: 'created_by_user_id' },
  },
}

function normalizeTimestampValue(value: unknown) {
  return value instanceof Date ? value.getTime() : value
}

function isAccountInsertRow(row: unknown): row is MockAccountRow & {
  createdAt: Date | number
  updatedAt: Date | number
} {
  if (!row || typeof row !== 'object') {
    return false
  }

  return (
    'accountId' in row &&
    'providerId' in row &&
    'userId' in row &&
    'createdAt' in row &&
    'updatedAt' in row
  )
}

function buildHubDb() {
  function createInsertValuesHandler(table: { __tbl?: string }, row: unknown) {
    const execute = async () => {
      if (table.__tbl === 'account' || isAccountInsertRow(row)) {
        const account = row
        await mocks.hubDbInsertProfile({
          __kind: 'account',
          accessToken: account.accessToken,
          accountId: account.accountId,
          createdAt: normalizeTimestampValue(account.createdAt),
          id: account.id,
          idToken: account.idToken,
          providerId: account.providerId,
          refreshToken: account.refreshToken,
          scope: account.scope,
          updatedAt: normalizeTimestampValue(account.updatedAt),
          userId: account.userId,
        })
        return
      }

      if (table.__tbl === 'user_profiles') {
        await mocks.hubDbInsertProfile(row)
      }
    }

    const query = {
      async onConflictDoUpdate() {
        await execute()
      },
      then(onFulfilled: (value: void) => unknown, onRejected?: (reason: unknown) => unknown) {
        return execute().then(onFulfilled, onRejected)
      },
    }

    return query
  }

  return {
    db: {
      $client: {
        batch: (...args: unknown[]) => mocks.dbBatch(...args),
        prepare: (...args: unknown[]) => mocks.dbPrepare(...args),
      },
      select: () => ({
        from: (table: { __tbl?: string }) => ({
          where: () => ({
            limit: async () => mocks.hubDbSelect(table.__tbl),
          }),
        }),
      }),
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback(buildHubDb().db)
      },
      update: (table: { __tbl?: string }) => ({
        set: (patch: Record<string, unknown>) => ({
          where: async (condition?: { left?: { __col?: string }; right?: unknown }) => {
            await mocks.hubDbUpdate({
              condition,
              patch: Object.fromEntries(
                Object.entries(patch).map(([key, value]) => [key, normalizeTimestampValue(value)]),
              ),
              table: table.__tbl,
            })
          },
        }),
      }),
      insert: (table: { __tbl?: string }) => ({
        values: (row: unknown) => createInsertValuesHandler(table, row),
      }),
    },
    schema: schemaFake,
  }
}

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: mocks.loggerError,
    set: mocks.loggerSet,
  }),
}))

vi.mock('hub:db', () => buildHubDb())

vi.mock('../../server/utils/member-role-changes', () => ({
  ROLE_CHANGE_DB_DIRECT_ACTOR: 'db-direct',
  ROLE_CHANGE_SYSTEM_ACTOR: 'system',
  recordRoleChange: mocks.recordRoleChange,
}))

vi.mock('drizzle-orm', () => ({
  eq: (left: unknown, right: unknown) => ({ __op: 'eq', left, right }),
  sql: (...args: unknown[]) => ({ __sql: args }),
}))

installNuxtRouteTestGlobals()

type D1Call = {
  method: 'first' | 'run'
  query: string
  values: unknown[]
}

type MockUserRow = {
  id: string
  email: string | null
  image: string | null
  role: string
  updatedAt?: number | null
}

type MockAccountRow = {
  id: string
  accountId: string
  providerId: string
  userId: string
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  scope: string | null
  createdAt: number
  updatedAt: number
}

type MockAuditRow = {
  id: string
  userId: string
  fromRole: string
  toRole: string
  changedBy: string
  reason?: string | null
}

type MockUserProfileRow = {
  id: string
  emailNormalized: string
  roleSnapshot: string
  adminSource: string
}

type MockDbState = {
  accounts: MockAccountRow[]
  audits: MockAuditRow[]
  profiles: Map<string, MockUserProfileRow>
  sessionRefreshUserId: string | null
  users: Map<string, MockUserRow>
}

function sqliteTypeOf(value: unknown): 'integer' | 'null' | 'real' | 'text' {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'real'
  }
  return 'text'
}

function installD1Mock(options?: {
  accounts?: MockAccountRow[]
  failFirstQueries?: Array<RegExp | string>
  users?: MockUserRow[]
}) {
  const calls: D1Call[] = []
  const firstResponders: Array<{
    match: RegExp | string
    resolve: (call: D1Call) => unknown
  }> = []
  const state: MockDbState = {
    accounts: (options?.accounts ?? []).map((account) => ({ ...account })),
    audits: [],
    profiles: new Map(),
    sessionRefreshUserId: null,
    users: new Map(
      (
        options?.users ?? [
          {
            email: null,
            id: 'user-passkey-only',
            image: null,
            role: 'guest',
            updatedAt: null,
          },
        ]
      ).map((user) => [user.id, { ...user }]),
    ),
  }

  const hubDb = buildHubDb()

  mocks.dbPrepare.mockImplementation((query: string) => ({
    bind(...values: unknown[]) {
      return {
        async first() {
          const call = { method: 'first' as const, query, values }
          calls.push(call)
          const shouldFail = options?.failFirstQueries?.some((candidate) =>
            typeof candidate === 'string' ? query.includes(candidate) : candidate.test(query),
          )
          if (shouldFail) {
            throw new Error(`simulated D1 first() failure for query: ${query}`)
          }
          const responder = firstResponders.find((candidate) =>
            typeof candidate.match === 'string'
              ? query.includes(candidate.match)
              : candidate.match.test(query),
          )

          if (query.includes('SELECT id FROM "user" WHERE email = ? AND id != ? LIMIT 1')) {
            const [email, userId] = values as [string, string]
            const collision = [...state.users.values()].find(
              (user) => user.email === email && user.id !== userId,
            )

            return collision ? { id: collision.id } : null
          }

          if (
            query.includes(
              'SELECT userId FROM account WHERE providerId = ? AND accountId = ? AND userId != ? LIMIT 1',
            )
          ) {
            const [providerId, accountId, userId] = values as [string, string, string]
            const collision = state.accounts.find(
              (account) =>
                account.providerId === providerId &&
                account.accountId === accountId &&
                account.userId !== userId,
            )

            return collision ? { userId: collision.userId } : null
          }

          if (
            query.includes(
              "SELECT typeof(createdAt) AS createdAtType FROM account WHERE userId = ? AND providerId = 'google'",
            )
          ) {
            const [userId] = values as [string]
            const account = state.accounts.find(
              (row) => row.userId === userId && row.providerId === 'google',
            )

            return { createdAtType: sqliteTypeOf(account?.createdAt) }
          }

          return responder ? responder.resolve(call) : null
        },
        async run() {
          const call = { method: 'run' as const, query, values }
          calls.push(call)

          if (
            query.includes('UPDATE "user" SET email = ?, image = ?, updatedAt = ? WHERE id = ?')
          ) {
            const [email, image, updatedAt, userId] = values as [
              string,
              string | null,
              number,
              string,
            ]
            const existing = state.users.get(userId)
            if (existing) {
              existing.email = email
              existing.image = image
              existing.updatedAt = updatedAt
            }
          }

          if (
            query.includes(
              'INSERT INTO account (id, accountId, providerId, userId, accessToken, refreshToken, idToken, scope, createdAt, updatedAt)',
            )
          ) {
            const [
              id,
              accountId,
              providerId,
              userId,
              accessToken,
              refreshToken,
              idToken,
              scope,
              createdAt,
              updatedAt,
            ] = values as [
              string,
              string,
              string,
              string,
              string | null,
              string | null,
              string | null,
              string | null,
              number,
              number,
            ]

            state.accounts.push({
              accessToken,
              accountId,
              createdAt,
              id,
              idToken,
              providerId,
              refreshToken,
              scope,
              updatedAt,
              userId,
            })
          }

          return { success: true }
        },
      }
    },
  }))
  mocks.dbBatch.mockImplementation(async (statements: Array<{ run(): Promise<unknown> }>) => {
    await Promise.all(statements.map((statement) => statement.run()))
    return { success: true }
  })
  mocks.hubDbSelect.mockImplementation(async (table?: string) => {
    // auth.config.ts hook 對兩張表 select：
    //   - `user`: `select({ id | email | role }).from(user).where(eq(id, X))`
    //   - `user_profiles`（fix-user-profile-id-drift / TD-044 syncUserProfile）：
    //     `select({ id }).from(userProfiles).where(eq(emailNormalized, X))`
    //
    // mock 依 table 路由：
    //   - table === 'user' → state.users
    //   - table === 'user_profiles' → state.profiles
    //   - undefined / 其他 → fallback state.users（向後相容既有 caller）
    const userId = state.sessionRefreshUserId
    if (!userId) return []

    if (table === 'user_profiles') {
      const profile = state.profiles.get(userId)
      if (!profile) return []
      return [{ id: profile.id }]
    }

    const existing = state.users.get(userId)
    if (!existing) return []
    return [{ id: userId, email: existing.email, role: existing.role }]
  })
  mocks.hubDbUpdate.mockImplementation(
    async (input: {
      condition?: { left?: { __col?: string }; right?: unknown }
      patch: Record<string, unknown>
      table?: string
    }) => {
      // fix-user-profile-id-drift (TD-044) `syncUserProfile` 走「id 相同 →
      // UPDATE roleSnapshot / adminSource」branch 時，會打到 user_profiles
      // 表。原 mock 只處理 user table；補 user_profiles upsert 路徑讓 test
      // 能看到 reconciled profile。對應 TD-052。
      if (input.table === 'user_profiles') {
        const profileId =
          input.condition?.left?.__col === 'id' && typeof input.condition.right === 'string'
            ? input.condition.right
            : null
        if (!profileId) return
        const existingProfile = state.profiles.get(profileId) ?? {
          id: profileId,
          emailNormalized: '',
          roleSnapshot: '',
          adminSource: '',
        }
        const updated: MockUserProfileRow = {
          ...existingProfile,
          ...(typeof input.patch.roleSnapshot === 'string'
            ? { roleSnapshot: input.patch.roleSnapshot }
            : {}),
          ...(typeof input.patch.adminSource === 'string'
            ? { adminSource: input.patch.adminSource }
            : {}),
          ...(typeof input.patch.emailNormalized === 'string'
            ? { emailNormalized: input.patch.emailNormalized }
            : {}),
        }
        state.profiles.set(profileId, updated)
        return
      }

      if (input.table && input.table !== 'user') return

      const conditionUserId =
        input.condition?.left?.__col === 'id' && typeof input.condition.right === 'string'
          ? input.condition.right
          : null
      const userId =
        conditionUserId ??
        state.sessionRefreshUserId ??
        (state.users.size === 1 ? [...state.users.keys()][0] : null)
      if (!userId) return

      const existing = state.users.get(userId)
      if (!existing) return

      if (typeof input.patch.role === 'string') {
        existing.role = input.patch.role
      }

      if (typeof input.patch.email === 'string') {
        existing.email = input.patch.email
      }

      if ('image' in input.patch) {
        existing.image = (input.patch.image as string | null | undefined) ?? null
      }

      if (typeof input.patch.updatedAt === 'number') {
        existing.updatedAt = input.patch.updatedAt
      }

      if (typeof input.patch.email === 'string' && typeof input.patch.updatedAt === 'number') {
        calls.push({
          method: 'run',
          query: 'UPDATE "user" SET email = ?, image = ?, updatedAt = ? WHERE id = ?',
          values: [
            input.patch.email,
            (input.patch.image as string | null | undefined) ?? null,
            input.patch.updatedAt,
            userId,
          ],
        })
      }
    },
  )
  mocks.hubDbInsertProfile.mockImplementation(
    async (row: MockUserProfileRow & { __kind?: string }) => {
      if (row.__kind === 'account') {
        const account = row as unknown as MockAccountRow
        calls.push({
          method: 'run',
          query:
            'INSERT INTO account (id, accountId, providerId, userId, accessToken, refreshToken, idToken, scope, createdAt, updatedAt)',
          values: [
            account.id,
            account.accountId,
            account.providerId,
            account.userId,
            account.accessToken,
            account.refreshToken,
            account.idToken,
            account.scope,
            account.createdAt,
            account.updatedAt,
          ],
        })
        state.accounts.push({
          accessToken: account.accessToken,
          accountId: account.accountId,
          createdAt: account.createdAt,
          id: account.id,
          idToken: account.idToken,
          providerId: account.providerId,
          refreshToken: account.refreshToken,
          scope: account.scope,
          updatedAt: account.updatedAt,
          userId: account.userId,
        })
        return
      }

      state.profiles.set(row.id, { ...row })
    },
  )
  mocks.recordRoleChange.mockImplementation(
    async (_hubDb: unknown, audit: Omit<MockAuditRow, 'id'>) => {
      const row = {
        ...audit,
        id: `audit-${state.audits.length + 1}`,
      }
      state.audits.push(row)
      return { id: row.id }
    },
  )

  return {
    addFirstResponder(match: RegExp | string, resolve: (call: D1Call) => unknown) {
      firstResponders.push({ match, resolve })
    },
    calls,
    async queryFirst<T>(query: string, ...values: unknown[]) {
      return mocks
        .dbPrepare(query)
        .bind(...values)
        .first() as Promise<T>
    },
    async runSessionRefresh(userId: string, allowlistRaw: string) {
      state.sessionRefreshUserId = userId

      const { default: createAuthConfig } = (await import('../../server/auth.config')) as {
        default: (ctx: {
          db: unknown
          runtimeConfig: { knowledge?: unknown; oauth?: unknown }
        }) => {
          databaseHooks: {
            session: {
              create: {
                before: (session: { userId: string }) => Promise<void>
              }
            }
          }
        }
      }

      const config = createAuthConfig({
        db: {},
        runtimeConfig: {
          knowledge: {
            adminEmailAllowlist: allowlistRaw,
            environment: 'production',
          },
          oauth: {},
        },
      })

      try {
        await config.databaseHooks.session.create.before({ userId })
      } finally {
        state.sessionRefreshUserId = null
      }
    },
    hubDb,
    state,
  }
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS = {
  keys: [] as Array<Record<string, unknown>>,
}
let googleSigningPrivateKey: CryptoKey

async function buildIdToken(
  payload: Record<string, unknown>,
  options: { expiresInSeconds?: number; issuedAt?: number } = {},
): Promise<string> {
  const now = options.issuedAt ?? Math.floor(Date.now() / 1000)

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-google-key', typ: 'JWT' })
    .setIssuer(typeof payload.iss === 'string' ? payload.iss : 'https://accounts.google.com')
    .setAudience(
      Array.isArray(payload.aud) || typeof payload.aud === 'string'
        ? payload.aud
        : 'google-client-id',
    )
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? 300))
    .sign(googleSigningPrivateKey)
}

function installGoogleOauthFetchMock(input: {
  body?: Record<string, unknown>
  ok: boolean
  status: number
}) {
  mocks.fetch.mockImplementation(async (request: Request | string | URL) => {
    const url =
      typeof request === 'string'
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url

    if (url === GOOGLE_TOKEN_URL) {
      return {
        ok: input.ok,
        status: input.status,
        headers: new Headers(),
        async json() {
          return input.body ?? {}
        },
      }
    }

    if (url === GOOGLE_JWKS_URL) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'cache-control': 'public, max-age=3600' }),
        async json() {
          return GOOGLE_JWKS
        },
      }
    }

    throw new Error(`unexpected fetch url: ${url}`)
  })
}

describe('GET /api/auth/account/link-google-for-passkey-first/callback', () => {
  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)

    GOOGLE_JWKS.keys = [
      {
        ...publicJwk,
        alg: 'RS256',
        kid: 'test-google-key',
        use: 'sig',
      },
    ]
    googleSigningPrivateKey = privateKey
  })

  beforeEach(() => {
    vi.resetModules()
    mocks.dbBatch.mockReset()
    mocks.dbPrepare.mockReset()
    mocks.deleteCookie.mockReset()
    mocks.fetch.mockReset()
    mocks.getCookie.mockReset()
    mocks.getValidatedQuery.mockReset()
    mocks.hubDbInsertProfile.mockReset()
    mocks.hubDbSelect.mockReset()
    mocks.hubDbUpdate.mockReset()
    mocks.loggerError.mockReset()
    mocks.loggerSet.mockReset()
    mocks.recordRoleChange.mockReset()
    mocks.requireUserSession.mockReset()
    mocks.sendRedirect.mockReset()
    mocks.useRuntimeConfig.mockReset()

    vi.stubGlobal('deleteCookie', mocks.deleteCookie)
    vi.stubGlobal('fetch', mocks.fetch)
    vi.stubGlobal('getCookie', mocks.getCookie)
    vi.stubGlobal('getValidatedQuery', mocks.getValidatedQuery)
    vi.stubGlobal('requireUserSession', mocks.requireUserSession)
    vi.stubGlobal('sendRedirect', mocks.sendRedirect)
    vi.stubGlobal('useRuntimeConfig', mocks.useRuntimeConfig)

    mocks.requireUserSession.mockResolvedValue({
      user: {
        id: 'user-passkey-only',
        email: null,
      },
    })
    mocks.getValidatedQuery.mockResolvedValue({
      code: 'google-auth-code',
      state: 'oauth-state-token',
    })
    mocks.getCookie.mockReturnValue('oauth-state-token')
    mocks.sendRedirect.mockImplementation(
      (_event: unknown, location: string, statusCode = 302) => ({
        location,
        statusCode,
      }),
    )
    mocks.useRuntimeConfig.mockReturnValue({
      knowledge: {
        bindings: {
          rateLimitKv: 'KV',
        },
      },
      oauth: {
        google: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
        },
      },
    })
  })

  it('happy path：寫入 user/account 後 redirect 回 settings success query', async () => {
    const db = installD1Mock()

    const kv = createKvBindingFake({
      initialValues: {
        'oauth-link-state:oauth-state-token': JSON.stringify({
          createdAt: '2026-04-23T10:00:00.000Z',
          nonce: 'oauth-state-token',
          redirectOrigin: 'https://agentic.example.com',
          userId: 'user-passkey-only',
        }),
      },
    })
    installGoogleOauthFetchMock({
      ok: true,
      status: 200,
      body: {
        access_token: 'google-access-token',
        refresh_token: 'google-refresh-token',
        scope: 'openid email profile',
        id_token: await buildIdToken({
          aud: 'google-client-id',
          email: 'linked@example.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          picture: 'https://example.com/avatar.png',
          sub: 'google-subject-id',
        }),
      },
    })

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/callback.get')
    const result = await handler(event)

    expect(mocks.fetch).toHaveBeenCalledWith(
      GOOGLE_TOKEN_URL,
      expect.objectContaining({
        body: expect.any(URLSearchParams),
        method: 'POST',
      }),
    )

    const tokenRequest = mocks.fetch.mock.calls[0]?.[1] as {
      body: URLSearchParams
    }
    expect(tokenRequest.body.get('client_id')).toBe('google-client-id')
    expect(tokenRequest.body.get('client_secret')).toBe('google-client-secret')
    expect(tokenRequest.body.get('redirect_uri')).toBe(
      'https://agentic.example.com/api/auth/account/link-google-for-passkey-first/callback',
    )
    expect(tokenRequest.body.get('code')).toBe('google-auth-code')
    expect(tokenRequest.body.get('grant_type')).toBe('authorization_code')

    expect(db.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'first',
          query: expect.stringContaining(
            'SELECT id FROM "user" WHERE email = ? AND id != ? LIMIT 1',
          ),
          values: ['linked@example.com', 'user-passkey-only'],
        }),
        expect.objectContaining({
          method: 'run',
          query: expect.stringContaining(
            'UPDATE "user" SET email = ?, image = ?, updatedAt = ? WHERE id = ?',
          ),
          values: [
            'linked@example.com',
            'https://example.com/avatar.png',
            expect.any(Number),
            'user-passkey-only',
          ],
        }),
        expect.objectContaining({
          method: 'run',
          query: expect.stringContaining(
            'INSERT INTO account (id, accountId, providerId, userId, accessToken, refreshToken, idToken, scope, createdAt, updatedAt)',
          ),
          values: [
            expect.any(String),
            'google-subject-id',
            'google',
            'user-passkey-only',
            null,
            null,
            null,
            null,
            expect.any(Number),
            expect.any(Number),
          ],
        }),
      ]),
    )

    const accountInsert = db.calls.find((call) =>
      call.query.includes(
        'INSERT INTO account (id, accountId, providerId, userId, accessToken, refreshToken, idToken, scope, createdAt, updatedAt)',
      ),
    )
    expect(typeof accountInsert?.values[8]).toBe('number')
    expect(typeof accountInsert?.values[9]).toBe('number')

    expect(kv.snapshot()['oauth-link-state:oauth-state-token']).toBe('')
    expect(mocks.deleteCookie).toHaveBeenCalledWith(
      event,
      '__Host-oauth-link-state',
      expect.objectContaining({ path: '/' }),
    )
    expect(result).toMatchObject({
      location: '/account/settings?linked=google',
      statusCode: 302,
    })
  })

  it('timestamp affinity：綁定成功後 account.createdAt 仍以 INTEGER 寫入', async () => {
    const db = installD1Mock()

    const kv = createKvBindingFake({
      initialValues: {
        'oauth-link-state:oauth-state-token': JSON.stringify({
          createdAt: '2026-04-23T10:00:00.000Z',
          nonce: 'oauth-state-token',
          redirectOrigin: 'https://agentic.example.com',
          userId: 'user-passkey-only',
        }),
      },
    })
    installGoogleOauthFetchMock({
      ok: true,
      status: 200,
      body: {
        access_token: 'google-access-token',
        id_token: await buildIdToken({
          aud: 'google-client-id',
          email: 'linked@example.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: 'google-subject-id',
        }),
      },
    })

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/callback.get')
    await handler(event)

    await expect(
      db.queryFirst<{ createdAtType: string }>(
        "SELECT typeof(createdAt) AS createdAtType FROM account WHERE userId = ? AND providerId = 'google'",
        'user-passkey-only',
      ),
    ).resolves.toEqual({ createdAtType: 'integer' })
  })

  it('email collision：redirect 回 settings linkError=EMAIL_ALREADY_LINKED，且不寫 DB', async () => {
    const db = installD1Mock({
      users: [
        {
          email: null,
          id: 'user-passkey-only',
          image: null,
          role: 'guest',
          updatedAt: null,
        },
        {
          email: 'collision@example.com',
          id: 'another-user',
          image: null,
          role: 'member',
          updatedAt: null,
        },
      ],
    })

    const kv = createKvBindingFake({
      initialValues: {
        'oauth-link-state:oauth-state-token': JSON.stringify({
          createdAt: '2026-04-23T10:00:00.000Z',
          nonce: 'oauth-state-token',
          redirectOrigin: 'https://agentic.example.com',
          userId: 'user-passkey-only',
        }),
      },
    })
    installGoogleOauthFetchMock({
      ok: true,
      status: 200,
      body: {
        access_token: 'google-access-token',
        id_token: await buildIdToken({
          aud: 'google-client-id',
          email: 'collision@example.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: 'google-subject-id',
        }),
      },
    })

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/callback.get')
    const result = await handler(event)

    expect(result).toMatchObject({
      location: '/account/settings?linkError=EMAIL_ALREADY_LINKED',
      statusCode: 302,
    })
    expect(
      db.calls.filter((call) => call.query.includes('UPDATE "user" SET email = ?')),
    ).toHaveLength(0)
    expect(db.calls.filter((call) => call.query.includes('INSERT INTO account'))).toHaveLength(0)
  })

  it('google subject collision：既有 account 已綁到其他 user 時拒絕綁定', async () => {
    const db = installD1Mock({
      accounts: [
        {
          accessToken: null,
          accountId: 'google-subject-id',
          createdAt: Date.now(),
          id: 'account-google-existing',
          idToken: null,
          providerId: 'google',
          refreshToken: null,
          scope: null,
          updatedAt: Date.now(),
          userId: 'another-user',
        },
      ],
    })

    const kv = createKvBindingFake({
      initialValues: {
        'oauth-link-state:oauth-state-token': JSON.stringify({
          createdAt: '2026-04-23T10:00:00.000Z',
          nonce: 'oauth-state-token',
          redirectOrigin: 'https://agentic.example.com',
          userId: 'user-passkey-only',
        }),
      },
    })
    installGoogleOauthFetchMock({
      ok: true,
      status: 200,
      body: {
        access_token: 'google-access-token',
        id_token: await buildIdToken({
          aud: 'google-client-id',
          email: 'linked@example.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: 'google-subject-id',
        }),
      },
    })

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/callback.get')
    const result = await handler(event)

    expect(result).toMatchObject({
      location: '/account/settings?linkError=EMAIL_ALREADY_LINKED',
      statusCode: 302,
    })
    expect(db.calls.filter((call) => call.query.includes('INSERT INTO account'))).toHaveLength(0)
  })

  it('collision query 失敗：寫 log 並回 DB_WRITE_FAILED', async () => {
    installD1Mock({
      failFirstQueries: ['SELECT id FROM "user" WHERE email = ? AND id != ? LIMIT 1'],
    })

    const kv = createKvBindingFake({
      initialValues: {
        'oauth-link-state:oauth-state-token': JSON.stringify({
          createdAt: '2026-04-23T10:00:00.000Z',
          nonce: 'oauth-state-token',
          redirectOrigin: 'https://agentic.example.com',
          userId: 'user-passkey-only',
        }),
      },
    })
    installGoogleOauthFetchMock({
      ok: true,
      status: 200,
      body: {
        access_token: 'google-access-token',
        id_token: await buildIdToken({
          aud: 'google-client-id',
          email: 'linked@example.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: 'google-subject-id',
        }),
      },
    })

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/callback.get')

    await expect(handler(event)).resolves.toMatchObject({
      location: '/account/settings?linkError=DB_WRITE_FAILED',
      statusCode: 302,
    })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'check-link-collisions' }),
    )
  })

  it('allowlist reconciliation：綁定 allowlist email 後，下次 session refresh 升 admin 並寫 audit', async () => {
    const db = installD1Mock()

    const kv = createKvBindingFake({
      initialValues: {
        'oauth-link-state:oauth-state-token': JSON.stringify({
          createdAt: '2026-04-23T10:00:00.000Z',
          nonce: 'oauth-state-token',
          redirectOrigin: 'https://agentic.example.com',
          userId: 'user-passkey-only',
        }),
      },
    })
    installGoogleOauthFetchMock({
      ok: true,
      status: 200,
      body: {
        access_token: 'google-access-token',
        id_token: await buildIdToken({
          aud: 'google-client-id',
          email: 'linked-admin@example.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          picture: 'https://example.com/admin.png',
          sub: 'google-admin-subject-id',
        }),
      },
    })

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/callback.get')

    await expect(handler(event)).resolves.toMatchObject({
      location: '/account/settings?linked=google',
      statusCode: 302,
    })
    expect(db.state.users.get('user-passkey-only')).toMatchObject({
      email: 'linked-admin@example.com',
      role: 'guest',
    })

    await db.runSessionRefresh('user-passkey-only', 'linked-admin@example.com')

    expect(db.state.users.get('user-passkey-only')).toMatchObject({
      email: 'linked-admin@example.com',
      image: 'https://example.com/admin.png',
      role: 'admin',
    })
    expect(db.state.audits).toEqual([
      expect.objectContaining({
        changedBy: 'system',
        fromRole: 'guest',
        reason: 'allowlist-seed',
        toRole: 'admin',
        userId: 'user-passkey-only',
      }),
    ])
    expect(db.state.profiles.get('user-passkey-only')).toMatchObject({
      adminSource: 'allowlist',
      emailNormalized: 'linked-admin@example.com',
      roleSnapshot: 'admin',
    })
  })

  it('state 驗證失敗：cookie mismatch 直接 redirect STATE_MISMATCH', async () => {
    installD1Mock()
    mocks.getCookie.mockReturnValue('different-state-token')

    const kv = createKvBindingFake({
      initialValues: {
        'oauth-link-state:oauth-state-token': JSON.stringify({
          createdAt: '2026-04-23T10:00:00.000Z',
          nonce: 'oauth-state-token',
          redirectOrigin: 'https://agentic.example.com',
          userId: 'user-passkey-only',
        }),
      },
    })

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/callback.get')
    const result = await handler(event)

    expect(result).toMatchObject({
      location: '/account/settings?linkError=STATE_MISMATCH',
      statusCode: 302,
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('state 驗證失敗：KV 過期與 userId mismatch 都會回對應 query code', async () => {
    installD1Mock()

    const kv = createKvBindingFake()

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/callback.get')

    await expect(handler(event)).resolves.toMatchObject({
      location: '/account/settings?linkError=STATE_EXPIRED',
      statusCode: 302,
    })

    await kv.put(
      'oauth-link-state:oauth-state-token',
      JSON.stringify({
        createdAt: '2026-04-23T10:00:00.000Z',
        nonce: 'oauth-state-token',
        redirectOrigin: 'https://agentic.example.com',
        userId: 'different-user',
      }),
    )

    await expect(handler(event)).resolves.toMatchObject({
      location: '/account/settings?linkError=SESSION_MISMATCH',
      statusCode: 302,
    })
  })

  it('Google token / id_token 失敗分支會回對應 query code', async () => {
    installD1Mock()

    const kv = createKvBindingFake({
      initialValues: {
        'oauth-link-state:oauth-state-token': JSON.stringify({
          createdAt: '2026-04-23T10:00:00.000Z',
          nonce: 'oauth-state-token',
          redirectOrigin: 'https://agentic.example.com',
          userId: 'user-passkey-only',
        }),
      },
    })

    const event = createRouteEvent({
      context: {
        cloudflare: {
          env: {
            KV: kv,
          },
        },
      },
    })

    const { default: handler } =
      await import('../../server/api/auth/account/link-google-for-passkey-first/callback.get')

    installGoogleOauthFetchMock({
      ok: false,
      status: 502,
      body: {},
    })
    await expect(handler(event)).resolves.toMatchObject({
      location: '/account/settings?linkError=GOOGLE_TOKEN_EXCHANGE',
      statusCode: 302,
    })

    kv.putCalls.length = 0
    await kv.put(
      'oauth-link-state:oauth-state-token',
      JSON.stringify({
        createdAt: '2026-04-23T10:00:00.000Z',
        nonce: 'oauth-state-token',
        redirectOrigin: 'https://agentic.example.com',
        userId: 'user-passkey-only',
      }),
    )
    installGoogleOauthFetchMock({
      ok: true,
      status: 200,
      body: {
        access_token: 'google-access-token',
        id_token: await buildIdToken({
          aud: 'wrong-client-id',
          email: 'linked@example.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: 'google-subject-id',
        }),
      },
    })
    await expect(handler(event)).resolves.toMatchObject({
      location: '/account/settings?linkError=GOOGLE_ID_TOKEN_INVALID',
      statusCode: 302,
    })

    await kv.put(
      'oauth-link-state:oauth-state-token',
      JSON.stringify({
        createdAt: '2026-04-23T10:00:00.000Z',
        nonce: 'oauth-state-token',
        redirectOrigin: 'https://agentic.example.com',
        userId: 'user-passkey-only',
      }),
    )
    installGoogleOauthFetchMock({
      ok: true,
      status: 200,
      body: {
        access_token: 'google-access-token',
        id_token: await buildIdToken({
          aud: 'google-client-id',
          email: 'linked@example.com',
          email_verified: false,
          iss: 'https://accounts.google.com',
          sub: 'google-subject-id',
        }),
      },
    })
    await expect(handler(event)).resolves.toMatchObject({
      location: '/account/settings?linkError=EMAIL_NOT_VERIFIED',
      statusCode: 302,
    })

    await kv.put(
      'oauth-link-state:oauth-state-token',
      JSON.stringify({
        createdAt: '2026-04-23T10:00:00.000Z',
        nonce: 'oauth-state-token',
        redirectOrigin: 'https://agentic.example.com',
        userId: 'user-passkey-only',
      }),
    )
    installGoogleOauthFetchMock({
      ok: true,
      status: 200,
      body: {
        access_token: 'google-access-token',
        id_token: await buildIdToken(
          {
            aud: 'google-client-id',
            email: 'linked@example.com',
            email_verified: true,
            iss: 'https://accounts.google.com',
            sub: 'google-subject-id',
          },
          { expiresInSeconds: -60 },
        ),
      },
    })

    await expect(handler(event)).resolves.toMatchObject({
      location: '/account/settings?linkError=GOOGLE_ID_TOKEN_INVALID',
      statusCode: 302,
    })
  })
})
