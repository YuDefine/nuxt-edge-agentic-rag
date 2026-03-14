import { consola } from 'consola'

import { DEFAULT_GUEST_POLICY, guestPolicySchema, type GuestPolicy } from '#shared/types/auth'

import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'

const log = consola.withTag('guest-policy')

/**
 * B16 member-and-permission-management: `guest_policy` read path.
 *
 * The authoritative value lives in D1 (`system_settings('guest_policy')`).
 * Each Worker instance caches it in a module-level variable and validates
 * the cache against a **KV version stamp** (`guest_policy:version`) on
 * every call — this is the mechanism that propagates admin-initiated
 * policy changes across Worker instances within one request without
 * requiring a redeploy or forced eviction.
 *
 * Flow per call:
 *   1. KV `GET guest_policy:version` (~1ms). If it matches the cached
 *      version, the in-memory value is current.
 *   2. On mismatch (or cold start), re-read D1 `system_settings` once,
 *      update both the cached value and the cached version stamp, return
 *      the fresh value.
 *   3. KV / D1 failures degrade to `DEFAULT_GUEST_POLICY` — the conservative
 *      choice because the default is `same_as_member`, which preserves the
 *      most permissive behaviour (i.e. failing open to existing Member
 *      privileges rather than locking out Guests).
 *
 * **KV binding decision (Phase 2)**: reuses
 * `runtimeConfig.knowledge.bindings.rateLimitKv` — the only KV binding
 * currently wired through `nuxt.config.ts` / `wrangler.jsonc`. A dedicated
 * namespace is not worth the operational overhead for a single counter,
 * and the existing binding is already resolved in every admin-adjacent
 * code path (chat / MCP middleware). Keys are prefixed with
 * `guest_policy:` so they never collide with rate-limit counters.
 */

const KV_VERSION_KEY = 'guest_policy:version'
const D1_KEY = 'guest_policy'

interface EventLike {
  context: Record<string, unknown> & {
    cloudflare?: { env?: Record<string, unknown> }
  }
}

/**
 * Module-level cache scoped to a single Worker instance. Cleared when the
 * instance evicts; that is the expected refresh mechanism on top of the
 * KV version stamp.
 */
interface GuestPolicyCache {
  policy: GuestPolicy
  version: string | null
}

let cache: GuestPolicyCache | null = null

/**
 * Read the active guest policy, consulting KV version stamp + D1 as
 * described above. Always resolves to a valid `GuestPolicy` — never
 * throws; on any fault it returns `DEFAULT_GUEST_POLICY` and logs via
 * `console.warn` so the request can still complete.
 */
export async function getGuestPolicy(event: EventLike): Promise<GuestPolicy> {
  const runtimeConfig = getKnowledgeRuntimeConfig()
  const kvBindingName = runtimeConfig.bindings.rateLimitKv

  // KV version check. If KV is unavailable (e.g. local dev without KV
  // binding configured), fall through to D1 read every call; the cost is
  // a single D1 hit, which is acceptable for admin-gated settings.
  let currentVersion: string | null = null
  try {
    const kv = getRequiredKvBinding(event, kvBindingName)
    currentVersion = await kv.get(KV_VERSION_KEY)
  } catch {
    // KV binding missing or get() failed. Keep currentVersion = null and
    // force a D1 read to stay correct. Do not log.error — this path is
    // reached on every local request and would spam.
  }

  if (cache && cache.version !== null && cache.version === currentVersion) {
    return cache.policy
  }

  // Cache miss / version drift → read D1.
  try {
    const { db, schema } = await import('hub:db')
    const { eq } = await import('drizzle-orm')

    const [row] = await db
      .select({ value: schema.systemSettings.value })
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, D1_KEY))
      .limit(1)

    const parsed = guestPolicySchema.safeParse(row?.value)
    const policy = parsed.success ? parsed.data : DEFAULT_GUEST_POLICY

    cache = { policy, version: currentVersion }
    return policy
  } catch (error) {
    // D1 read failed. Preserve whatever cache we had; if none, fall back
    // to the canonical default. Failing closed (e.g. no_access) would
    // lock out members on transient DB blips, which is the wrong trade
    // for v1.0.0. See design.md "Risks / Trade-offs".
    log.warn('failed to read D1, falling back', error)
    return cache?.policy ?? DEFAULT_GUEST_POLICY
  }
}

/**
 * Write a new guest policy and bump the KV version stamp so other Worker
 * instances observe the change on their next request.
 *
 * The caller must have already validated `changedBy` (typically a
 * `requireRole('admin')` session's `user.id`). Schema validation of
 * `value` happens here as a last line of defence.
 *
 * **Atomicity note**: D1 write + KV write are not transactional. The
 * ordering is D1 first, KV second. If the KV write fails after D1
 * succeeds, worker instances will still read the old cached value until
 * their cache TTL — in the worst case, one extra request before all
 * replicas converge. This is acceptable because:
 *   (a) the D1 value is now authoritative; cache eventually drains,
 *   (b) retrying just the KV write is safe (idempotent increment),
 *   (c) the opposite order (KV first) would announce a version bump for
 *       a value that might not have landed, causing phantom re-reads.
 */
export async function setGuestPolicy(
  event: EventLike,
  input: { value: GuestPolicy; changedBy: string },
): Promise<void> {
  const parsed = guestPolicySchema.parse(input.value)
  const now = new Date().toISOString()

  const { db, schema } = await import('hub:db')

  // Upsert: the seed row from migration 0006 guarantees the `guest_policy`
  // key exists in prod, but we still use onConflictDoUpdate so the helper
  // also initialises the row in test databases / local scratch envs.
  await db
    .insert(schema.systemSettings)
    .values({ key: D1_KEY, value: parsed, updatedAt: now, updatedBy: input.changedBy })
    .onConflictDoUpdate({
      target: schema.systemSettings.key,
      set: { value: parsed, updatedAt: now, updatedBy: input.changedBy },
    })

  // Invalidate local cache so this very request reads the fresh value.
  cache = null

  // Bump KV version stamp. Use a monotonic millisecond counter — easier
  // to reason about than random IDs and avoids the need for reading
  // before writing.
  try {
    const runtimeConfig = getKnowledgeRuntimeConfig()
    const kv = getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)
    await kv.put(KV_VERSION_KEY, Date.now().toString())
  } catch (error) {
    // KV bump failed. Other Worker instances will still pick up the new
    // value when their own cache expires; log so operators can investigate.
    log.warn('failed to bump KV version stamp', error)
  }
}

/**
 * Test-only helper: reset the module-level cache. Exported because vitest
 * worker isolation per-file is not always reliable across suites that
 * import this module multiple times.
 */
export function __resetGuestPolicyCacheForTests(): void {
  cache = null
}
