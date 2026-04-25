/**
 * NuxtHub local-dev KV bridge helpers (TD-042).
 *
 * Background
 * ----------
 * In production / staging, Nitro's Cloudflare adapter populates
 * `event.context.cloudflare.env` with platform bindings — most importantly
 * the `KV` namespace declared in `wrangler.jsonc`. `getRequiredKvBinding`
 * reads the namespace from there to back rate-limit stores in MCP and the
 * web chat handler.
 *
 * NuxtHub local-dev however does NOT inject `event.context.cloudflare.env`
 * for KV — `hubKV()` / `kv` is exposed as a virtual unstorage instance
 * backed by the local `fs-lite` driver (`.data/kv/`). The result is that
 * any handler passing through `getRequiredKvBinding(event, 'KV')` throws
 * 503 in local dev, taking down the rate-limit middleware and blocking
 * `pnpm eval` baseline runs.
 *
 * Strategy
 * --------
 * In **local environment only**, hook Nitro's `request` event and inject a
 * `KV`-shaped namespace into `event.context.cloudflare.env`. The namespace
 * adapts the unstorage instance to the Cloudflare Workers KV surface
 * `KvBindingLike` expects (`get(key)` returning `string | null`,
 * `put(key, value, { expirationTtl? })`). fs-lite has no native TTL, so
 * the wrapper persists `{ value, expiresAt }` envelopes and lazily evicts
 * expired entries on read.
 *
 * Production / staging Workers runtime is untouched — the plugin's
 * environment guard short-circuits and Cloudflare's real `KV` binding
 * remains in place.
 */

import type { KvBindingLike } from '#server/utils/cloudflare-bindings'

interface UnstorageLike {
  getItem(key: string, opts?: Record<string, unknown>): Promise<unknown>
  setItem(key: string, value: unknown, opts?: Record<string, unknown>): Promise<void>
  removeItem?(key: string, opts?: Record<string, unknown>): Promise<void>
}

interface PersistedKvEntry {
  expiresAt: number | null
  value: string
}

function isPersistedEntry(value: unknown): value is PersistedKvEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PersistedKvEntry).value === 'string' &&
    'expiresAt' in (value as Record<string, unknown>)
  )
}

/**
 * Adapt a NuxtHub unstorage instance (e.g. `kv` from `@nuxthub/kv`) to the
 * Cloudflare Workers KV namespace surface used by `getRequiredKvBinding`.
 */
export function wrapHubKvAsNamespace(storage: UnstorageLike): KvBindingLike {
  return {
    async delete(key: string): Promise<void> {
      if (typeof storage.removeItem === 'function') {
        try {
          await storage.removeItem(key)
        } catch {
          // Best-effort delete — match Cloudflare KV behaviour where missing
          // keys do not throw.
        }
      }
    },
    async get(key: string): Promise<string | null> {
      const stored = await storage.getItem(key)

      if (stored === null || stored === undefined) {
        return null
      }

      if (isPersistedEntry(stored)) {
        if (stored.expiresAt !== null && stored.expiresAt <= Date.now()) {
          // Best-effort eviction — ignore failure (read path must stay fast).
          if (typeof storage.removeItem === 'function') {
            try {
              await storage.removeItem(key)
            } catch {
              // Swallow — the next get will retry eviction.
            }
          }
          return null
        }
        return stored.value
      }

      // Backwards-compat: a raw string was stored (e.g. by code that
      // bypassed the wrapper). Treat it as a non-expiring value.
      if (typeof stored === 'string') {
        return stored
      }

      return null
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      const ttlSeconds = options?.expirationTtl
      const expiresAt =
        typeof ttlSeconds === 'number' && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null

      const entry: PersistedKvEntry = { expiresAt, value }
      await storage.setItem(key, entry)
    },
  }
}

interface BridgeOptions {
  environment: string
  kvFactory: () => UnstorageLike
}

interface MutableEvent {
  context: Record<string, unknown> & {
    cloudflare?: {
      env?: Record<string, unknown>
    }
  }
}

/**
 * Pure helper used by both the Nitro plugin and unit tests. When the
 * effective environment is `local`, ensures `event.context.cloudflare.env`
 * exposes a `KV` namespace backed by the supplied unstorage factory.
 *
 * - Non-local environments are a no-op (Workers runtime injects `KV`).
 * - Existing `KV` bindings on the event are preserved (e.g. real bindings
 *   coming from `wrangler dev`).
 */
export function bridgeLocalKvOnEvent(event: MutableEvent, options: BridgeOptions): void {
  if (options.environment !== 'local') {
    return
  }

  const cloudflare = (event.context.cloudflare ??= {} as { env?: Record<string, unknown> })
  cloudflare.env ??= {} as Record<string, unknown>

  if (cloudflare.env.KV !== undefined && cloudflare.env.KV !== null) {
    return
  }

  cloudflare.env.KV = wrapHubKvAsNamespace(options.kvFactory())
}

export type { BridgeOptions, MutableEvent, UnstorageLike }
