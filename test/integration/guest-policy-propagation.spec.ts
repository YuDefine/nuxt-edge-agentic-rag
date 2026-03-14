import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B16 §9.4 — Guest policy propagation via KV version stamp.
 *
 * Scenario: two Worker instances (A, B) both rely on the shared KV
 * namespace to detect when the in-memory cache of `guest_policy` has
 * diverged from D1. This test simulates the two-worker race:
 *
 *   1. Instance A reads policy (same_as_member) — caches (policy=same_as_member, version=v0).
 *   2. Instance B reads policy — also caches (same_as_member, v0).
 *   3. Instance A writes `browse_only` via `setGuestPolicy`:
 *        - D1 upsert to `system_settings('guest_policy')`
 *        - KV `put` on `guest_policy:version` (monotonic ms counter → v1)
 *        - A's in-memory cache cleared.
 *   4. Instance B's next request reads KV → sees new version v1 →
 *      cache `{policy=same_as_member, version=v0}` mismatches → re-reads
 *      D1 → gets fresh `browse_only` + updates cache to (browse_only, v1).
 *
 * Implementation note: `guest-policy.ts` uses a module-level cache so
 * mocking two Worker instances means (a) importing the module twice via
 * `vi.resetModules` + `import`, (b) sharing a single fake KV / D1
 * store between both module instances so the KV version change made by
 * A is observable by B.
 */

type GuestPolicyValue = 'same_as_member' | 'browse_only' | 'no_access'

function createFakeKv() {
  const store = new Map<string, string>()
  return {
    store,
    binding: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
    },
  }
}

function createFakeD1(initial: GuestPolicyValue) {
  const rows = new Map<string, { value: GuestPolicyValue; updatedBy: string; updatedAt: string }>()
  rows.set('guest_policy', {
    value: initial,
    updatedBy: 'seed',
    updatedAt: '2026-04-19T00:00:00Z',
  })

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const row = rows.get('guest_policy')
            return row ? [{ value: row.value }] : []
          },
        }),
      }),
    }),
    insert: () => ({
      values: (patch: {
        key: string
        value: GuestPolicyValue
        updatedBy: string
        updatedAt: string
      }) => ({
        onConflictDoUpdate: async (opts: {
          set: { value: GuestPolicyValue; updatedBy: string; updatedAt: string }
        }) => {
          rows.set(patch.key, {
            value: opts.set.value,
            updatedBy: opts.set.updatedBy,
            updatedAt: opts.set.updatedAt,
          })
        },
      }),
    }),
  }

  const schema = {
    systemSettings: {
      key: { __col: 'key' },
      value: { __col: 'value' },
    },
  }

  return { rows, db, schema }
}

function createFakeEvent() {
  return { context: { cloudflare: { env: {} } } }
}

interface GuestPolicyModule {
  getGuestPolicy: (event: unknown) => Promise<GuestPolicyValue>
  setGuestPolicy: (
    event: unknown,
    input: { value: GuestPolicyValue; changedBy: string },
  ) => Promise<void>
  __resetGuestPolicyCacheForTests: () => void
}

async function loadFreshModule(
  kvStore: Map<string, string>,
  d1: { db: unknown; schema: unknown },
): Promise<GuestPolicyModule> {
  // Reset registry so re-importing `server/utils/guest-policy.ts` produces
  // a fresh module-level cache — this is how we emulate "Worker instance
  // B on a different box".
  vi.resetModules()

  // Re-register shared fakes so both instances agree on the underlying
  // KV / D1 storage layer. Cloudflare bindings are resolved through
  // `getRequiredKvBinding`; we mock it to return the shared kvStore.
  vi.doMock('#server/utils/cloudflare-bindings', () => ({
    getRequiredKvBinding: () => ({
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => {
        kvStore.set(key, value)
      },
    }),
  }))

  vi.doMock('#server/utils/knowledge-runtime', () => ({
    getKnowledgeRuntimeConfig: () => ({
      bindings: { rateLimitKv: 'KNOWLEDGE_RATE_LIMIT_KV' },
    }),
  }))

  vi.doMock('hub:db', () => d1)

  vi.doMock('drizzle-orm', () => ({
    eq: () => ({ __op: 'eq' }),
  }))

  return (await import('#server/utils/guest-policy')) as unknown as GuestPolicyModule
}

describe('guest-policy propagation across Worker instances (B16 §9.4)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it('instance B observes instance A’s write on its next request via KV version stamp', async () => {
    const kv = createFakeKv()
    const d1 = createFakeD1('same_as_member')

    // --- Instance A: first read ---
    const instanceA = await loadFreshModule(kv.store, d1)
    instanceA.__resetGuestPolicyCacheForTests()
    const aRead1 = await instanceA.getGuestPolicy(createFakeEvent())
    expect(aRead1).toBe('same_as_member')

    // --- Instance B: first read (same D1 value, also caches v=null) ---
    const instanceB = await loadFreshModule(kv.store, d1)
    instanceB.__resetGuestPolicyCacheForTests()
    const bRead1 = await instanceB.getGuestPolicy(createFakeEvent())
    expect(bRead1).toBe('same_as_member')

    // --- Instance A writes a new policy ---
    await instanceA.setGuestPolicy(createFakeEvent(), {
      value: 'browse_only',
      changedBy: 'admin-1',
    })

    // After write: D1 has the new value AND kv version stamp is present.
    expect(d1.rows.get('guest_policy')?.value).toBe('browse_only')
    expect(kv.store.has('guest_policy:version')).toBe(true)

    // --- Instance B next request: sees version drift and re-reads D1 ---
    const bRead2 = await instanceB.getGuestPolicy(createFakeEvent())
    expect(bRead2).toBe('browse_only')
  })

  it('instance A’s cache is cleared after write so its very next read is fresh', async () => {
    const kv = createFakeKv()
    const d1 = createFakeD1('same_as_member')

    const instanceA = await loadFreshModule(kv.store, d1)
    instanceA.__resetGuestPolicyCacheForTests()

    // Seed cache with initial read.
    await instanceA.getGuestPolicy(createFakeEvent())

    await instanceA.setGuestPolicy(createFakeEvent(), {
      value: 'no_access',
      changedBy: 'admin-1',
    })

    const afterWrite = await instanceA.getGuestPolicy(createFakeEvent())
    expect(afterWrite).toBe('no_access')
  })

  it('KV version bump is monotonic: successive writes produce different stamps', async () => {
    const kv = createFakeKv()
    const d1 = createFakeD1('same_as_member')

    const instanceA = await loadFreshModule(kv.store, d1)
    instanceA.__resetGuestPolicyCacheForTests()

    await instanceA.setGuestPolicy(createFakeEvent(), {
      value: 'browse_only',
      changedBy: 'admin-1',
    })
    const stamp1 = kv.store.get('guest_policy:version')

    // Await an event-loop tick so `Date.now()` advances at least 1 ms.
    await new Promise((resolve) => setTimeout(resolve, 2))

    await instanceA.setGuestPolicy(createFakeEvent(), {
      value: 'no_access',
      changedBy: 'admin-1',
    })
    const stamp2 = kv.store.get('guest_policy:version')

    expect(stamp1).toBeTruthy()
    expect(stamp2).toBeTruthy()
    expect(stamp2).not.toBe(stamp1)
  })
})
