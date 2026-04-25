import { kv } from '@nuxthub/kv'

import {
  bridgeLocalKvOnEvent,
  type MutableEvent,
  type UnstorageLike,
} from '#server/utils/local-kv-bridge'

/**
 * Nitro plugin: wires the local-dev KV bridge into the `request` hook so
 * NuxtHub's local `fs-lite` KV is exposed as `event.context.cloudflare.env.KV`.
 *
 * Production / staging Workers runtime is untouched — the environment
 * guard short-circuits and Cloudflare's real `KV` binding remains in place.
 *
 * See `server/utils/local-kv-bridge.ts` for the bridge logic and its
 * accompanying unit tests.
 */
export default defineNitroPlugin((nitroApp) => {
  if (process.env.NUXT_KNOWLEDGE_ENVIRONMENT !== 'local') {
    return
  }

  // Module-load cost is acceptable: this plugin is only registered when
  // the build target is local dev, and the unstorage instance itself is
  // cheap to construct (it's just a fs-lite driver pointing at `.data/kv`).
  const kvFactory = (): UnstorageLike => kv as unknown as UnstorageLike

  nitroApp.hooks.hook('request', (event) => {
    bridgeLocalKvOnEvent(event as MutableEvent, {
      environment: 'local',
      kvFactory,
    })
  })
})
