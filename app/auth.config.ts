import { passkeyClient } from '@better-auth/passkey/client'
import { defineClientAuth } from '@onmax/nuxt-better-auth/config'
import { adminClient } from 'better-auth/client/plugins'

/**
 * passkey-authentication / Decision 4 — Client plugin is ALWAYS loaded
 * (no side effects when the server-side plugin is absent; the client
 * methods would simply resolve to 404s from the backend).
 *
 * UI gating happens at the template level via
 * `useRuntimeConfig().public.knowledge.features.passkey` so users never
 * see a button that would fail — the plugin instance is just an
 * ambient capability, not a UI trigger.
 */
export default defineClientAuth({
  plugins: [adminClient(), passkeyClient()],
})
