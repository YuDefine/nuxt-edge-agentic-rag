import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * drizzle-refactor-credentials-admin-members §4 — coverage for
 * `GET /api/auth/me/credentials` after the refactor from
 * `db.all(sql\`...\`)` raw SQL to drizzle query builder (Decision 1).
 *
 * Context: the legacy handler crashed in local-dev libsql because
 * `db.all` is not defined on the libsql driver path. This spec
 * guards the new drizzle path + the 5 response-shape scenarios
 * the page relies on, so any future regression (back to raw SQL
 * or shape drift) trips the test before review.
 *
 * Mock strategy (Decision 5): fake `hub:db` with a thenable
 * drizzle query-builder chain. `select(shape)` branches on shape
 * keys to decide which result set to return — user row vs google
 * account row vs passkey rows. No `db.all` / `sql\`\`` interception
 * because the handler no longer uses them.
 */

const VALID_SESSION = {
  user: { id: 'user-1', email: 'user@example.com' },
}

interface UserRowShape {
  email: string | null
  displayName: string | null
}

interface GoogleAccountRowShape {
  id: string
}

interface PasskeyRowShape {
  id: string
  name: string | null
  deviceType: string
  backedUp: boolean
  createdAt: Date | null
}

const mocks = vi.hoisted(() => ({
  requireUserSession: vi.fn(),
  userRows: [] as Array<UserRowShape>,
  googleRows: [] as Array<GoogleAccountRowShape>,
  passkeyRows: [] as Array<PasskeyRowShape>,
  userQueryThrows: null as Error | null,
  credentialsQueryThrows: null as Error | null,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

// Drizzle query builder chain mock. Branches on the projection shape
// passed to `select()`:
//   - `{ email, displayName }` → user row query (Stage 1)
//   - `{ id }` (google account) → google account lookup
//   - `{ id, name, deviceType, backedUp, createdAt }` → passkey list
function makeThenable<T>(rows: T, options: { throws?: Error | null } = {}) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    then: (resolve: (value: T) => void, reject: (error: Error) => void) => {
      if (options.throws) {
        reject(options.throws)
        return
      }
      resolve(rows)
    },
  }
  return chain
}

function buildHubDb() {
  const schema = {
    user: {
      id: { __col: 'id' },
      email: { __col: 'email' },
      display_name: { __col: 'display_name' },
    },
    account: {
      id: { __col: 'id' },
      userId: { __col: 'userId' },
      providerId: { __col: 'providerId' },
    },
    passkey: {
      id: { __col: 'id' },
      name: { __col: 'name' },
      userId: { __col: 'userId' },
      deviceType: { __col: 'deviceType' },
      backedUp: { __col: 'backedUp' },
      createdAt: { __col: 'createdAt' },
    },
  }

  return {
    db: {
      select: (shape: Record<string, unknown>) => {
        const keys = Object.keys(shape ?? {})
        // User row: { email, displayName }
        if (keys.includes('email') && keys.includes('displayName') && keys.length === 2) {
          if (shape.displayName !== schema.user.display_name) {
            throw new Error('Expected credentials handler to select schema.user.display_name')
          }
          return makeThenable(mocks.userRows, { throws: mocks.userQueryThrows })
        }
        // Google account: { id } alone (single field)
        if (keys.length === 1 && keys.includes('id')) {
          return makeThenable(mocks.googleRows, { throws: mocks.credentialsQueryThrows })
        }
        // Passkey list: has deviceType + backedUp
        if (keys.includes('deviceType') && keys.includes('backedUp')) {
          return makeThenable(mocks.passkeyRows, { throws: mocks.credentialsQueryThrows })
        }
        throw new Error(`Unexpected select shape in test: ${keys.join(',')}`)
      },
    },
    schema,
  }
}

vi.mock('hub:db', () => buildHubDb())

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, _value: unknown) => ({ __op: 'eq' }),
  and: (...conds: unknown[]) => ({ __op: 'and', conds }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: strings,
    __values: values,
  }),
}))

installNuxtRouteTestGlobals()

describe('GET /api/auth/me/credentials — drizzle refactor', () => {
  beforeEach(() => {
    mocks.requireUserSession.mockReset()
    mocks.userRows = []
    mocks.googleRows = []
    mocks.passkeyRows = []
    mocks.userQueryThrows = null
    mocks.credentialsQueryThrows = null

    vi.stubGlobal('requireUserSession', mocks.requireUserSession)
    mocks.requireUserSession.mockResolvedValue(VALID_SESSION)
  })

  it('returns email + displayName + hasGoogle=true + 2 passkeys on happy path', async () => {
    mocks.userRows = [{ email: 'user@example.com', displayName: '小明' }]
    mocks.googleRows = [{ id: 'acct-google' }]
    mocks.passkeyRows = [
      {
        id: 'pk-1',
        name: 'MacBook',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: new Date('2026-04-10T12:00:00.000Z'),
      },
      {
        id: 'pk-2',
        name: 'iPhone',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: new Date('2026-04-15T12:00:00.000Z'),
      },
    ]

    const { default: handler } = await import('../../server/api/auth/me/credentials.get')
    const result = (await handler(createRouteEvent())) as {
      data: {
        email: string | null
        displayName: string | null
        hasGoogle: boolean
        passkeys: Array<{
          id: string
          name: string | null
          deviceType: string
          backedUp: boolean
          createdAt: string | null
        }>
      }
    }

    expect(result.data.email).toBe('user@example.com')
    expect(result.data.displayName).toBe('小明')
    expect(result.data.hasGoogle).toBe(true)
    expect(result.data.passkeys).toHaveLength(2)
    expect(result.data.passkeys[0]).toEqual({
      id: 'pk-1',
      name: 'MacBook',
      deviceType: 'multiDevice',
      backedUp: true,
      createdAt: '2026-04-10T12:00:00.000Z',
    })
    expect(result.data.passkeys[1]!.createdAt).toBe('2026-04-15T12:00:00.000Z')
  })

  it('returns hasGoogle=false when no google account linked', async () => {
    mocks.userRows = [{ email: 'user@example.com', displayName: 'No Google' }]
    mocks.googleRows = [] // no google
    mocks.passkeyRows = []

    const { default: handler } = await import('../../server/api/auth/me/credentials.get')
    const result = (await handler(createRouteEvent())) as {
      data: { hasGoogle: boolean }
    }

    expect(result.data.hasGoogle).toBe(false)
  })

  it('returns empty passkeys array when user has no passkeys', async () => {
    mocks.userRows = [{ email: 'user@example.com', displayName: 'No Passkey' }]
    mocks.googleRows = [{ id: 'acct-google' }]
    mocks.passkeyRows = []

    const { default: handler } = await import('../../server/api/auth/me/credentials.get')
    const result = (await handler(createRouteEvent())) as {
      data: { passkeys: unknown[] }
    }

    expect(result.data.passkeys).toEqual([])
  })

  it('supports passkey-only user with null email (passkey-first signup)', async () => {
    mocks.userRows = [{ email: null, displayName: '小明' }]
    mocks.googleRows = []
    mocks.passkeyRows = [
      {
        id: 'pk-only',
        name: null,
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: new Date('2026-04-20T08:30:00.000Z'),
      },
    ]

    const { default: handler } = await import('../../server/api/auth/me/credentials.get')
    const result = (await handler(createRouteEvent())) as {
      data: {
        email: string | null
        displayName: string | null
        hasGoogle: boolean
        passkeys: Array<{ id: string; name: string | null; createdAt: string | null }>
      }
    }

    expect(result.data.email).toBeNull()
    expect(result.data.displayName).toBe('小明')
    expect(result.data.hasGoogle).toBe(false)
    expect(result.data.passkeys).toHaveLength(1)
    expect(result.data.passkeys[0]!.name).toBeNull()
  })

  it('throws 404 when session.user.id has no matching user row', async () => {
    mocks.userRows = [] // row not found
    mocks.googleRows = []
    mocks.passkeyRows = []

    const { default: handler } = await import('../../server/api/auth/me/credentials.get')
    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('throws 401 when requireUserSession resolves without user.id', async () => {
    mocks.requireUserSession.mockResolvedValue({ user: { id: null } })

    const { default: handler } = await import('../../server/api/auth/me/credentials.get')
    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('throws 500 with friendly message when user query fails unexpectedly', async () => {
    mocks.userQueryThrows = new Error('simulated driver crash')

    const { default: handler } = await import('../../server/api/auth/me/credentials.get')
    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 500,
      message: '暫時無法載入帳號資訊，請稍後再試',
    })
  })
})
